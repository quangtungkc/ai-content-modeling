import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { assertStrictModelingReady, buildStrictSceneExpectedState, CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS, sourceModelingSpecSchema } from "@/modules/modeling/strict-source-modeling";
import { getCharacterIdentityPack } from "@/modules/channels/identity-pack";
import type { FinalVideoObservation, SourceValidationContext } from "@/modules/source-validation/multi-stage";
import { CodexReasoner } from "./reasoner";
import { ensureCodexStorage } from "./storage";
import { buildSceneExpectedState, canAutoResumeAfterFlowRuntimeRepair, chooseRecoveryStrategy, classifyFailure, createErrorSignature, extractRecoveryTargetIds, findIncompleteFinalAuditPrerequisite, nextContinuousRecoveryStrategy, nextPendingAction, recoveryActionFor, recoveryStrategies, redactSecrets, retryCountForSignature, shouldKeepRunningUntilFinal, validateExpectedActual } from "./policy";
import { CODEX_STAGES, type CodexAction, type CodexEventType, type CodexStage, type CodexStageSnapshot, type ExpectedState, type ReportCodexEventInput, type ValidationOutput } from "./types";
import { validateQuality } from "./quality-validator";
import { access } from "node:fs/promises";
import { hashFinalVideo, POST_ASSEMBLY_QA_VALIDATOR_VERSION, prismaQaRunPersistence } from "@/modules/post-assembly-qa/repository";
import { PostAssemblyQaOrchestrator } from "@/modules/post-assembly-qa/orchestrator";
import { registerOriginalOutput } from "@/modules/output-versioning/service";
import { LocalJobQueue } from "@/lib/jobs/queue";

const labels: Record<CodexStage, string> = {
  ANALYSIS: "Phân tích Source Video",
  MODELING: "Tạo Modeling Idea",
  PROJECT: "Tạo Content Project và phân cảnh",
  ASSETS: "Tạo và kiểm tra ảnh bằng Google Flow",
  SCENES: "Tạo và kiểm tra video từng phân cảnh",
  FINAL_ASSEMBLY: "Ghép và xuất video hoàn chỉnh",
  FINAL_AUDIT: "Final Audit",
  POST_RUN_REVIEW: "Post-Run Improvement Review",
};
const automationKey = (stage: CodexStage) => stage === "FINAL_ASSEMBLY" ? "final-video" : stage.toLowerCase().replaceAll("_", "-");
const executableActions = new Set<CodexAction["name"]>([
  "runAnalysisStage", "runModelingStage", "runProjectDevelopmentStage", "runAssetStage", "validateAssets", "regenerateAsset",
  "runSceneGenerationStage", "validateScenes", "regenerateScene", "runFinalAssembly", "runFinalAudit", "runPostRunReview",
]);

type CreateJobInput = {
  sourceVideoId: string;
  idempotencyKey: string;
  settings: { artStyle: string; aspectRatio: "9:16" | "16:9" | "1:1" | "4:5"; postText?: string; hashtags?: string; language?: string; targetCountry?: string };
};

type StoredStage = { stage: string; status: string; retryCount: number; maxRetries: number; expectedState: unknown; actualState: unknown; validationResult: string | null; lastStrategy: string | null };

const json = (value: unknown) => redactSecrets(value) as Prisma.InputJsonValue;

// Event history is operational telemetry, not a second copy of the full
// provider response. Keep it bounded so one repeated provider failure cannot
// make SQLite grow without limit and block the worker that must report it.
const MAX_EVENT_STRING_LENGTH = 4_000;
const MAX_EVENT_ARRAY_ITEMS = 20;
const MAX_EVENT_OBJECT_KEYS = 40;
const MAX_EVENT_PAYLOAD_LENGTH = 16_000;
const MIN_PROGRESS_EVENT_INTERVAL_MS = 30_000;

function compactEventValue(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value).slice(0, MAX_EVENT_STRING_LENGTH);
  if (typeof value !== "object" || value === null) return value;
  if (depth >= 5) return "[TRUNCATED_DEPTH]";
  if (Array.isArray(value)) {
    const items = value.length <= MAX_EVENT_ARRAY_ITEMS
      ? value
      : [...value.slice(0, 10), `[${value.length - 20} items omitted]`, ...value.slice(-10)];
    return items.map((item) => compactEventValue(item, depth + 1));
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const selected = entries.length <= MAX_EVENT_OBJECT_KEYS
    ? entries
    : [...entries.slice(0, MAX_EVENT_OBJECT_KEYS - 1), ["_omittedKeys", entries.length - (MAX_EVENT_OBJECT_KEYS - 1)]];
  return Object.fromEntries(selected.map(([key, item]) => [key, compactEventValue(item, depth + 1)]));
}

function eventJson(value: unknown) {
  const compacted = compactEventValue(value);
  const serialized = JSON.stringify(compacted);
  if (serialized.length <= MAX_EVENT_PAYLOAD_LENGTH) return compacted as Prisma.InputJsonValue;
  return {
    _truncated: true,
    _preview: serialized.slice(0, MAX_EVENT_PAYLOAD_LENGTH - 64),
  } as Prisma.InputJsonValue;
}

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const stringArray = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const stageSnapshot = (stage: StoredStage): CodexStageSnapshot => ({
  stage: stage.stage as CodexStage,
  status: stage.status as CodexStageSnapshot["status"],
  retryCount: stage.retryCount,
  maxRetries: stage.maxRetries,
  expectedState: stage.expectedState ? stage.expectedState as ExpectedState : undefined,
  actualState: stage.actualState ? record(stage.actualState) : undefined,
  validationResult: stage.validationResult ? stage.validationResult as CodexStageSnapshot["validationResult"] : undefined,
  lastStrategy: stage.lastStrategy ?? undefined,
});

export async function appendCodexEvent(jobId: string, type: CodexEventType, stage?: CodexStage, payload: Record<string, unknown> = {}, reasoningSummary?: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const aggregate = await db.codexEvent.aggregate({ where: { jobId }, _max: { sequence: true } });
    try {
      return await db.codexEvent.create({ data: { jobId, sequence: (aggregate._max.sequence ?? 0) + 1, type, stage, payload: eventJson(payload), reasoningSummary: reasoningSummary ? redactSecrets(reasoningSummary).slice(0, MAX_EVENT_STRING_LENGTH) : undefined } });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002" || attempt === 3) throw error;
    }
  }
  throw new Error("Không thể ghi Codex event.");
}
const appendEvent = appendCodexEvent;

export async function confirmDesktopFlowRuntime(userId: string, runtimeRevision: string, appVersion?: string | null) {
  if (!["flow-ipc-event-v2", "flow-recovery-v3"].includes(runtimeRevision)) return { confirmed: false, resumedJobIds: [] as string[] };
  const candidates = await db.codexJob.findMany({
    where: { userId, status: { in: ["NEEDS_HUMAN", "NEEDS_ENGINEERING"] }, currentStage: { in: ["ASSETS", "SCENES"] } },
    select: { id: true, status: true, currentStage: true, failureReason: true, automationRunId: true, retryCount: true },
    orderBy: { updatedAt: "asc" },
    take: 10,
  });
  const resumedJobIds: string[] = [];
  for (const candidate of candidates) {
    if (candidate.retryCount >= getEnv().CODEX_MAX_RECOVERY_PER_JOB) continue;
    const priorVerified = await db.codexEvent.findFirst({ where: { jobId: candidate.id, type: "RUNTIME_REPAIR_VERIFIED", stage: candidate.currentStage }, orderBy: { createdAt: "desc" }, select: { payload: true } });
    if (record(priorVerified?.payload).runtimeRevision === runtimeRevision) continue;
    if (!canAutoResumeAfterFlowRuntimeRepair({ status: candidate.status, stage: candidate.currentStage, failureReason: candidate.failureReason, runtimeRevision })) continue;
    const stage = candidate.currentStage as "ASSETS" | "SCENES";
    const validatorRetry = /quality validator|semantic_audit_required|gemini[_\s]quality|quality[_\s]provider|rate.?limit|quota|429/i.test(candidate.failureReason ?? "");
    const action = validatorRetry ? (stage === "ASSETS" ? "validateAssets" : "validateScenes") : stage === "ASSETS" ? "regenerateAsset" : "regenerateScene";
    const repairStrategy = validatorRetry ? "runtime-repair:retry-quality-validation" : `runtime-repair:${runtimeRevision}`;
    const claimed = await db.codexJob.updateMany({
      where: { id: candidate.id, status: candidate.status, currentStage: stage, failureReason: candidate.failureReason },
      data: { status: "RECOVERING", currentAction: action, failureReason: null, completedAt: null },
    });
    if (!claimed.count) continue;
    try {
      await db.$transaction([
        db.codexStageState.update({
          where: { jobId_stage: { jobId: candidate.id, stage } },
          data: { status: "RETRYING", lastStrategy: repairStrategy, validationResult: null, validationIssues: Prisma.JsonNull, completedAt: null },
        }),
        ...(candidate.automationRunId ? [db.automationRun.update({ where: { id: candidate.automationRunId }, data: { status: "RUNNING", error: null, completedAt: null } })] : []),
        db.runtimeFailure.updateMany({ where: { codexJobId: candidate.id, status: { not: "SENT_TO_CODEX" } }, data: { status: "RECOVERY_REQUESTED", resolvedAt: new Date() } }),
      ]);
      await appendEvent(candidate.id, "RUNTIME_REPAIR_VERIFIED", stage, { runtimeRevision, appVersion: appVersion ?? "unknown" }, "Electron đã nạp đúng bản sửa cầu nối Flow.");
      await appendEvent(candidate.id, "JOB_AUTO_RESUMED", stage, { action, runtimeRevision }, `Tự tiếp tục từ stage ${stage} sau khi xác nhận bản sửa.`);
      await new LocalJobQueue().enqueue("codex.job.execute", { jobId: candidate.id, userId }, `codex-auto-resume:${candidate.id}:${runtimeRevision}`);
      resumedJobIds.push(candidate.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Không thể enqueue lại Codex job.";
      await db.codexJob.update({ where: { id: candidate.id }, data: { status: candidate.status, currentAction: "waitForHuman", failureReason: redactSecrets(message) } });
      await appendEvent(candidate.id, "CODEX_WAKE_FAILED", stage, { runtimeRevision, error: redactSecrets(message) }, "Không thể tự enqueue lại job sau khi nạp bản sửa.");
    }
  }
  return { confirmed: true, resumedJobIds };
}

function basicValidation(stage: CodexStage, actual: Record<string, unknown> | undefined): ValidationOutput | null {
  const required: Partial<Record<CodexStage, string>> = { ANALYSIS: "analysisId", MODELING: "ideaId", PROJECT: "projectId" };
  if (stage === "FINAL_ASSEMBLY") {
    return actual?.finalVideoAvailable === true && actual.finalContainerValid === true && actual.finalVideoStreamValid === true && typeof actual.finalDurationSec === "number" && actual.finalDurationSec > 0.1 && typeof actual.finalResolution === "string"
      ? { verdict: "PASS", issues: [] }
      : { verdict: "FAIL", failureKind: "TECHNICAL_FAILURE", issues: [{ code: "FINAL_MEDIA_INVALID", message: "final.mp4 chưa đạt kiểm tra container/video stream/duration/resolution." }] };
  }
  const key = required[stage];
  if (!key) return null;
  return typeof actual?.[key] === "string" && actual[key]
    ? { verdict: "PASS", issues: [] }
    : { verdict: "FAIL", failureKind: "TECHNICAL_FAILURE", issues: [{ code: `${key.toUpperCase()}_MISSING`, message: `Stage ${stage} không trả về ${key}.` }] };
}

async function buildExpectedStates(projectId: string, userId: string) {
  const project = await db.contentProject.findFirst({
    where: { id: projectId, channel: { userId } },
    include: { scenes: { orderBy: { sceneNumber: "asc" } }, idea: true },
  });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy Content Project của Codex job.", 404);
  const strictSpec = assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy, sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, sourceSceneId: scene.sourceSceneId, targetDuration: scene.targetDuration })) });
  const idea = record(project.idea.content);
  const sourceIntent = String(idea.sourceMechanism ?? idea.coreConcept ?? project.idea.title);
  const scenes = project.scenes.map((scene) => {
    const strictScene = scene.sourceSceneId ? buildStrictSceneExpectedState(strictSpec, scene.sourceSceneId) : undefined;
    return buildSceneExpectedState({
    ...scene,
    sceneId: scene.id,
    characterDesign: project.characterDesign,
    backgroundDesign: project.backgroundDesign,
    sourceModelingIntent: sourceIntent,
    actionSequence: strictScene?.actionSequence ?? scene.actionSequence,
    cameraSpec: strictScene?.camera ?? scene.cameraSpec,
    spatialSpec: strictScene?.spatial ?? scene.spatialSpec,
    mustPreserve: strictScene?.mustPreserve ?? scene.mustPreserve,
    allowedTransformations: strictScene?.allowedTransformations ?? scene.allowedTransformations,
  });
  });
  const sceneNumbers = scenes.map((scene) => scene.sceneNumber);
  const aspectRatio = String(record(project.artDirection).aspectRatio ?? "9:16");
  const sourceValidationBase = { projectId, sourceVideoId: project.sourceVideoId!, sourceVideoPath: project.sourceVideoUrl, sourceVideoUrl: project.sourceVideoUrl, sourceModelingSpecVersion: project.sourceModelingSpecVersion ?? strictSpec.specVersion, sourceSpec: strictSpec, sourceEvidence: strictSpec.sourceEvidence, mustPreserve: [...new Set(strictSpec.scenes.flatMap((scene) => scene.mustPreserve))], allowedTransformations: [...CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS] };
  return {
    ASSETS: { stage: "ASSETS", projectId, requiredAssetKeys: ["background-0", ...sceneNumbers.map((number) => `scene-${number}`)], scenes, sourceValidation: { ...sourceValidationBase, validationStage: "START_FRAME" } } satisfies ExpectedState,
    SCENES: { stage: "SCENES", projectId, expectedSceneNumbers: sceneNumbers, expectedDurationPerScene: 4, scenes, sourceValidation: { ...sourceValidationBase, validationStage: "SCENE_VIDEO" } } satisfies ExpectedState,
    FINAL_ASSEMBLY: { stage: "FINAL_ASSEMBLY", projectId, expectedSceneOrder: sceneNumbers, expectedAspectRatio: aspectRatio, requireAudio: true, requireFinalVideo: true } satisfies ExpectedState,
    FINAL_AUDIT: { stage: "FINAL_AUDIT", projectId, expectedSceneNumbers: sceneNumbers, expectedSceneOrder: sceneNumbers, expectedAspectRatio: aspectRatio, expectedDurationPerScene: 4, requireAudio: true, requireFinalVideo: true, scenes, sourceValidation: { ...sourceValidationBase, validationStage: "FINAL_VIDEO" } } satisfies ExpectedState,
  };
}

async function buildFinalSourceValidationContext(projectId: string, userId: string, finalVideoPath: string, actual: Record<string, unknown>): Promise<SourceValidationContext | undefined> {
  const project = await db.contentProject.findFirst({ where: { id: projectId, channel: { userId } }, include: { scenes: { orderBy: { sceneNumber: "asc" } } } });
  if (!project?.sourceModelingSpec || !project.sourceVideoId || !project.sourceVideoUrl || !project.sourceModelingSpecVersion) return undefined;
  const spec = sourceModelingSpecSchema.parse(project.sourceModelingSpec);
  const identityPack = await getCharacterIdentityPack(project.channelId, userId).catch(() => null);
  const sourceScenes = [...spec.scenes].sort((left, right) => left.order - right.order);
  const scenePlans = project.scenes.map((scene) => {
    const source = sourceScenes.find((item) => item.sourceSceneId === scene.sourceSceneId);
    return { sceneNumber: scene.sceneNumber, generatedSceneId: scene.id, sourceSceneId: scene.sourceSceneId, storyBeat: source?.storyBeat, actionSequence: Array.isArray(scene.actionSequence) ? scene.actionSequence.filter((item): item is string => typeof item === "string") : undefined, camera: scene.cameraSpec && typeof scene.cameraSpec === "object" && !Array.isArray(scene.cameraSpec) ? scene.cameraSpec as Record<string, unknown> : undefined, targetDuration: scene.targetDuration, startState: source?.startState, endState: source?.endState };
  });
  const sceneOrder = Array.isArray(actual.sceneOrder) ? actual.sceneOrder.filter((item): item is number => typeof item === "number" && Number.isInteger(item)) : undefined;
  const expectedOrder = sourceScenes.map((scene) => scene.order);
  const sceneOrderMatches = sceneOrder ? sceneOrder.length === expectedOrder.length && sceneOrder.every((number, index) => number === expectedOrder[index]) : undefined;
  const sourceObservation = actual.sourceObservation && typeof actual.sourceObservation === "object" && !Array.isArray(actual.sourceObservation) ? actual.sourceObservation as Partial<FinalVideoObservation> : {};
  return { projectId, sourceVideoId: project.sourceVideoId, sourceVideoPath: project.sourceVideoUrl, sourceVideoUrl: project.sourceVideoUrl, sourceModelingSpecVersion: project.sourceModelingSpecVersion, sourceSpec: spec, sourceEvidence: spec.sourceEvidence, mustPreserve: [...new Set(sourceScenes.flatMap((scene) => scene.mustPreserve))], allowedTransformations: [...CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS], characterIdentityPack: identityPack, generatedAssetPath: finalVideoPath, generatedAssetType: "FINAL_VIDEO", validationStage: "FINAL_VIDEO", generatedScenePlans: scenePlans, finalObservation: { ...sourceObservation, sceneOrder, generatedDuration: typeof actual.finalDurationSec === "number" ? actual.finalDurationSec : undefined, structureMatch: sourceObservation.structureMatch ?? sceneOrderMatches, technicalStatus: sourceObservation.technicalStatus ?? (actual.finalContainerValid === true && actual.finalVideoStreamValid === true) } };
}

async function syncAutomation(jobId: string) {
  const job = await db.codexJob.findUnique({ where: { id: jobId }, include: { stages: true } });
  if (!job?.automationRunId) return;
  const steps = CODEX_STAGES.map((stage) => {
    const item = job.stages.find((candidate) => candidate.stage === stage);
    const status = item?.status === "COMPLETED" || item?.status === "SKIPPED" ? "completed" : item?.status === "RUNNING" || item?.status === "RETRYING" ? "running" : item?.status === "FAILED" ? "failed" : "pending";
    return { key: automationKey(stage), label: labels[stage], status, detail: item?.validationResult ? `Validation: ${item.validationResult}` : undefined };
  });
  const status = job.status === "COMPLETED" ? "SUCCEEDED" : job.status === "FAILED" || job.status === "NEEDS_HUMAN" || job.status === "NEEDS_ENGINEERING" ? "FAILED" : "RUNNING";
  await db.automationRun.update({ where: { id: job.automationRunId }, data: { status, steps: json(steps), projectId: job.contentProjectId, error: job.failureReason, ...(status !== "RUNNING" ? { completedAt: new Date() } : {}) } });
}

export async function restoreQualityStatusForJob(job: { id: string; projectId?: string | null; contentProjectId?: string | null; finalVideoPath?: string | null; qualityStatus: string; generationStatus: string; outputReady: boolean }, dependencies: { findQaRun?: (projectId: string, hash: string, version: string) => Promise<{ qualityStatusAfter: string } | null>; hash?: (path: string) => Promise<string>; fileExists?: (path: string) => Promise<void> } = {}) {
  const findQaRun = dependencies.findQaRun ?? prismaQaRunPersistence().find;
  const hash = dependencies.hash ?? hashFinalVideo;
  const fileExists = dependencies.fileExists ?? access;
  // CodexJob calls the Content Project identity `contentProjectId`; keep the
  // optional `projectId` fallback for callers/tests that already provide it.
  const projectId = job.projectId ?? job.contentProjectId;
  let restored = "NOT_RUN";
  if (projectId && job.finalVideoPath) {
    try {
      await fileExists(job.finalVideoPath);
      const run = await findQaRun(projectId, await hash(job.finalVideoPath), POST_ASSEMBLY_QA_VALIDATOR_VERSION);
      if (run && ["APPROVED", "NEEDS_REVIEW", "REPAIR_FAILED"].includes(run.qualityStatusAfter)) restored = run.qualityStatusAfter;
    } catch { restored = "NOT_RUN"; }
  }
  return { qualityStatus: restored, generationStatus: job.generationStatus, outputReady: job.outputReady };
}

async function presentJob(jobId: string, userId: string) {
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId } });
  if (!job) throw new AppError("CODEX_JOB_NOT_FOUND", "Không tìm thấy Codex job.", 404);
  const restored = await restoreQualityStatusForJob(job);
  if (restored.qualityStatus !== job.qualityStatus) await db.codexJob.update({ where: { id: jobId }, data: { qualityStatus: restored.qualityStatus } });
  const [stages, events, runtimeFailures] = await Promise.all([
    db.codexStageState.findMany({ where: { jobId }, orderBy: { id: "asc" } }),
    db.codexEvent.findMany({ where: { jobId }, orderBy: { sequence: "desc" }, take: 50, select: { id: true, jobId: true, sequence: true, type: true, stage: true, level: true, payload: true, reasoningSummary: true, createdAt: true } }),
    db.runtimeFailure.findMany({ where: { codexJobId: jobId }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, source: true, stage: true, failureKind: true, code: true, message: true, status: true, attempts: true, codexResponseId: true, lastAttemptAt: true, resolvedAt: true, createdAt: true } }),
  ]);
  const jobWithRelations = { ...job, qualityStatus: restored.qualityStatus, generationStatus: restored.generationStatus, outputReady: restored.outputReady, stages, events: [...events].reverse(), runtimeFailures };
  const snapshots = CODEX_STAGES.map((name) => jobWithRelations.stages.find((stage) => stage.stage === name)).filter((stage): stage is NonNullable<typeof stage> => Boolean(stage)).map(stageSnapshot);
  const activeStage = snapshots.find((stage) => stage.stage === job.currentStage);
  const persistedAction = job.currentAction && executableActions.has(job.currentAction as CodexAction["name"])
    ? { name: job.currentAction as CodexAction["name"], stage: job.currentStage as CodexStage, strategy: activeStage?.lastStrategy, targetIds: stringArray(activeStage?.actualState?.recoveryTargetIds) }
    : null;
  return { ...jobWithRelations, stages: snapshots, nextAction: job.status === "COMPLETED" ? { name: "jobComplete" } : job.status === "NEEDS_HUMAN" || job.status === "NEEDS_ENGINEERING" || job.status === "FAILED" ? { name: "waitForHuman", reason: job.failureReason } : persistedAction ?? nextPendingAction(snapshots) };
}

async function diagnoseAndRecover(jobId: string, userId: string, stage: CodexStage, message: string, actual: Record<string, unknown>, provider?: string, validation?: ValidationOutput): Promise<CodexAction> {
  const env = getEnv();
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, include: { stages: true, events: { where: { type: "RECOVERY_STARTED", stage }, orderBy: { sequence: "desc" }, take: 200 } } });
  if (!job) throw new AppError("CODEX_JOB_NOT_FOUND", "Không tìm thấy Codex job.", 404);
  const stageState = job.stages.find((item) => item.stage === stage);
  if (!stageState) throw new AppError("CODEX_STAGE_NOT_FOUND", "Không tìm thấy stage cần recovery.", 404);
  const kind = validation?.failureKind ?? classifyFailure(message, validation?.verdict === "FAIL");
  const signature = createErrorSignature(stage, message);
  const attempted = job.events
    .filter((event) => record(event.payload).errorSignature === signature)
    .map((event) => String(record(event.payload).strategy ?? ""))
    .filter(Boolean);
  const signatureRetryCount = retryCountForSignature(stageState.lastErrorSignature, signature, stageState.retryCount);
  const keepRunning = shouldKeepRunningUntilFinal(kind, message);
  let targetIds = extractRecoveryTargetIds(message, actual);
  const experience = await db.agentExperience.findFirst({ where: { stage, provider: provider ?? null, errorSignature: signature, result: "SUCCEEDED", successfulFix: { not: null } }, orderBy: { lastSeenAt: "desc" } });
  const candidates = recoveryStrategies(stage, kind, message);
  let strategy = chooseRecoveryStrategy(candidates, attempted, experience?.successfulFix);
  let selectedTool: CodexAction["name"] = kind === "ENGINEERING_FAILURE" ? "repairProductionCode" : recoveryActionFor(stage, strategy);
  let reasonerMode: "CODEX" | "DETERMINISTIC_FALLBACK" = "DETERMINISTIC_FALLBACK";
  let reasonerError: string | undefined;
  let reason = experience?.successfulFix ? "Ưu tiên cách sửa đã thành công với lỗi cùng chữ ký." : `Áp dụng recovery khác với ${attempted.length} lần thử trước.`;
  if (env.CODEX_ORCHESTRATOR_ENABLED) {
    try {
      const allowedTools = kind === "ENGINEERING_FAILURE" ? ["repairProductionCode"] : stage === "ASSETS" ? ["validateAssets", "regenerateAsset", "runAssetStage", "waitForHuman"] : stage === "SCENES" ? ["validateScenes", "regenerateScene", "runSceneGenerationStage", "waitForHuman"] : ["runAnalysisStage", "runModelingStage", "runProjectDevelopmentStage", "runFinalAssembly", "runFinalAudit", "waitForHuman"];
      const result = await new CodexReasoner().decide(userId, { purpose: "RECOVERY", stage, state: { failureKind: kind, validationVerdict: validation?.verdict, errorSignature: signature, message, expectedState: stageState.expectedState, actualState: actual, previousAttempts: attempted, experienceMatch: experience, candidateStrategies: candidates, derivedTargetIds: targetIds }, allowedTools }, job.previousResponseId);
      if (result.decision.strategy && !attempted.includes(result.decision.strategy)) strategy = result.decision.strategy;
      selectedTool = allowedTools.includes(result.decision.selectedTool) && result.decision.selectedTool !== "waitForHuman"
        ? result.decision.selectedTool
        : recoveryActionFor(stage, strategy);
      if (result.decision.targetIds?.length) targetIds = [...new Set([...targetIds, ...result.decision.targetIds])];
      reason = result.decision.shortReason;
      reasonerMode = "CODEX";
      if (result.responseId) await db.codexJob.update({ where: { id: jobId }, data: { previousResponseId: result.responseId } });
    } catch (error) {
      reasonerError = redactSecrets(error instanceof Error ? error.message : "Codex reasoner không phản hồi.");
      reason = `${reason} Codex API tạm thời không khả dụng; policy an toàn dùng chiến lược xác định sẵn.`;
    }
  }
  if (keepRunning && (!strategy || /request-human/i.test(strategy))) {
    strategy = nextContinuousRecoveryStrategy(candidates, signatureRetryCount);
    selectedTool = recoveryActionFor(stage, strategy);
  }
  // Provider validation outages must never regenerate already downloaded media.
  if (strategy && /quality-validation|provider-backoff/.test(strategy) && (stage === "ASSETS" || stage === "SCENES")) {
    selectedTool = recoveryActionFor(stage, strategy);
  }
  await appendCodexEvent(jobId, "ERROR_DIAGNOSED", stage, { failureKind: kind, validationVerdict: validation?.verdict, errorSignature: signature, evidence: redactSecrets(message), candidateStrategies: candidates, previousAttempts: attempted, selectedStrategy: strategy, selectedTool, targetIds, reasonerMode, reasonerError }, reason);
  if (kind === "ENGINEERING_FAILURE") {
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage } }, data: { status: "FAILED", lastErrorSignature: signature, actualState: json(actual) } });
    await db.codexJob.update({ where: { id: jobId }, data: { status: "NEEDS_ENGINEERING", currentStage: stage, currentAction: "codexGuardedCodeRepair", failureReason: redactSecrets(message) } });
    await appendCodexEvent(jobId, "JOB_NEEDS_ENGINEERING", stage, { errorSignature: signature, automaticRepairEnabled: env.CODEX_SELF_REPAIR_ENABLED }, reason);
    await syncAutomation(jobId);
    return { name: "waitForHuman", stage, strategy: "codex-guarded-code-repair", reason: message };
  }
  // Every recovery path has a real per-signature limit. Without this guard a
  // persistent provider error (for example quota/429) loops forever, grows
  // CodexEvent indefinitely, and eventually prevents the worker from writing
  // the very failure it is supposed to report.
  const exhausted = signatureRetryCount >= env.CODEX_MAX_RECOVERY_PER_ERROR
    || stageState.retryCount >= env.CODEX_MAX_RECOVERY_PER_STAGE
    || job.retryCount >= env.CODEX_MAX_RECOVERY_PER_JOB
    || !strategy
    || /request-human/.test(strategy)
    || !env.CODEX_AUTO_RECOVERY_ENABLED;
  if (exhausted) {
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage } }, data: { status: "FAILED", validationResult: validation?.verdict, lastErrorSignature: signature } });
    await db.codexJob.update({ where: { id: jobId }, data: { status: "NEEDS_HUMAN", currentStage: stage, currentAction: "waitForHuman", failureReason: redactSecrets(message) } });
    const failedExperience = await db.agentExperience.findFirst({ where: { stage, provider: provider ?? null, errorSignature: signature, result: "FAILED" }, orderBy: { lastSeenAt: "desc" } });
    if (failedExperience) await db.agentExperience.update({ where: { id: failedExperience.id }, data: { jobId, occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), errorMessage: redactSecrets(message), expectedState: stageState.expectedState ?? undefined, actualState: json(actual), rootCause: reason } });
    else await db.agentExperience.create({ data: { jobId, stage, provider, errorSignature: signature, errorMessage: redactSecrets(message), expectedState: stageState.expectedState ?? undefined, actualState: json(actual), rootCause: reason, result: "FAILED" } });
    await appendCodexEvent(jobId, "RECOVERY_FAILED", stage, { errorSignature: signature, attempts: signatureRetryCount });
    await appendCodexEvent(jobId, "JOB_NEEDS_HUMAN", stage, { reason: redactSecrets(message) });
    await syncAutomation(jobId);
    return { name: "waitForHuman", stage, reason: message };
  }
  const selectedStrategy = strategy as string;
  const nextRetry = signatureRetryCount + 1;
  const recoveryAttemptId = randomUUID();
  const inputFingerprint = `${signature}:${stage}:${selectedStrategy}:${targetIds.join(",")}`;
  const recoveryActual = { ...actual, recoveryTargetIds: targetIds, recoveryAttemptId, recoveryStrategyId: selectedStrategy, inputFingerprint };
  await db.codexStageState.update({ where: { jobId_stage: { jobId, stage } }, data: { status: "RETRYING", retryCount: nextRetry, lastErrorSignature: signature, lastStrategy: selectedStrategy, actualState: json(recoveryActual), validationResult: validation?.verdict } });
  await db.codexJob.update({ where: { id: jobId }, data: { status: "RECOVERING", currentStage: stage, currentAction: selectedTool, retryCount: { increment: 1 }, failureReason: null } });
  const priorAttempt = await db.agentExperience.findFirst({ where: { stage, provider: provider ?? null, errorSignature: signature, attemptedFix: selectedStrategy, result: "ATTEMPTED" }, orderBy: { lastSeenAt: "desc" } });
  if (priorAttempt) await db.agentExperience.update({ where: { id: priorAttempt.id }, data: { jobId, occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), errorMessage: redactSecrets(message), expectedState: stageState.expectedState ?? undefined, actualState: json(recoveryActual), rootCause: reason } });
  else await db.agentExperience.create({ data: { jobId, stage, provider, errorSignature: signature, errorMessage: redactSecrets(message), expectedState: stageState.expectedState ?? undefined, actualState: json(recoveryActual), attemptedFix: selectedStrategy, rootCause: reason, result: "ATTEMPTED" } });
  await appendCodexEvent(jobId, "RECOVERY_STARTED", stage, { recoveryAttemptId, recoveryStrategyId: selectedStrategy, inputFingerprint, strategy: selectedStrategy, tool: selectedTool, targetIds, retry: nextRetry, errorSignature: signature }, reason);
  const issueTargets = targetIds;
  if (stage === "FINAL_AUDIT") {
    if (issueTargets.length) {
      await db.$transaction([
        db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "SCENES" } }, data: { status: "RETRYING", lastStrategy: "final-audit-targeted-scene-regeneration" } }),
        db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "FINAL_ASSEMBLY" } }, data: { status: "PENDING", validationResult: null, completedAt: null } }),
        db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "FINAL_AUDIT" } }, data: { status: "PENDING", completedAt: null } }),
        db.codexJob.update({ where: { id: jobId }, data: { status: "RECOVERING", currentStage: "SCENES", currentAction: "regenerateScene" } }),
      ]);
      await syncAutomation(jobId);
      return { name: "regenerateScene", stage: "SCENES", targetIds: issueTargets, strategy: selectedStrategy, reason };
    }
    await db.$transaction([
      db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "FINAL_ASSEMBLY" } }, data: { status: "PENDING", validationResult: null, completedAt: null } }),
      db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "FINAL_AUDIT" } }, data: { status: "PENDING", completedAt: null } }),
      db.codexJob.update({ where: { id: jobId }, data: { status: "RECOVERING", currentStage: "FINAL_ASSEMBLY", currentAction: "runFinalAssembly" } }),
    ]);
    await syncAutomation(jobId);
    return { name: "runFinalAssembly", stage: "FINAL_ASSEMBLY", strategy: selectedStrategy, reason };
  }
  await syncAutomation(jobId);
  return { name: selectedTool, stage, targetIds: issueTargets, strategy: selectedStrategy, reason };
}

export async function createCodexJob(userId: string, input: CreateJobInput) {
  await ensureCodexStorage();
  const env = getEnv();
  if (!env.CODEX_ORCHESTRATOR_ENABLED) throw new AppError("CODEX_ORCHESTRATOR_DISABLED", "Codex Orchestrator đang tắt. Pipeline hiện tại không bị ảnh hưởng.", 409);
  const existing = await db.codexJob.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    if (existing.userId !== userId) throw new AppError("CODEX_JOB_CONFLICT", "Idempotency key đã được sử dụng.", 409);
    return presentJob(existing.id, userId);
  }
  const source = await db.competitorVideo.findFirst({ where: { id: input.sourceVideoId, competitor: { channel: { userId } } }, include: { competitor: { include: { channel: true } }, analyses: { orderBy: { version: "desc" }, take: 1 } } });
  if (!source) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy Source Video thuộc tài khoản.", 404);
  const stageRows = CODEX_STAGES.map((stage) => ({ stage, status: stage === "ANALYSIS" && source.analyses.length ? "COMPLETED" : "PENDING", maxRetries: env.CODEX_MAX_RECOVERY_ATTEMPTS }));
  const automationSteps = CODEX_STAGES.map((stage) => ({ key: automationKey(stage), label: labels[stage], status: stage === "ANALYSIS" && source.analyses.length ? "completed" : "pending" }));
  const result = await db.$transaction(async (tx) => {
    const automation = await tx.automationRun.create({ data: { userId, sourceVideoId: source.id, status: "RUNNING", settings: json({ ...input.settings, mode: "codex" }), steps: json(automationSteps) } });
    return tx.codexJob.create({ data: { userId, channelId: source.competitor.channel.id, sourceVideoId: source.id, automationRunId: automation.id, idempotencyKey: input.idempotencyKey, sessionId: randomUUID(), status: "PLANNING", currentStage: source.analyses.length ? "MODELING" : "ANALYSIS", currentAction: source.analyses.length ? "runModelingStage" : "runAnalysisStage", checkpoint: json({ settings: input.settings, analysisId: source.analyses[0]?.id ?? null }), stages: { create: stageRows } } });
  });
  await appendCodexEvent(result.id, "CODEX_JOB_STARTED", undefined, { sourceVideoId: source.id, channelId: source.competitor.channel.id, executor: "background-worker" });
  await new LocalJobQueue().enqueue("codex.job.execute", { jobId: result.id, userId }, `codex-execute:${result.id}`);
  await syncAutomation(result.id);
  return presentJob(result.id, userId);
}

export async function initializeCodexPlan(jobId: string, userId: string) {
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, include: { events: { where: { type: "PLAN_CREATED" }, take: 1 } } });
  if (!job) throw new AppError("CODEX_JOB_NOT_FOUND", "Không tìm thấy Codex job.", 404);
  if (job.events.length) return presentJob(jobId, userId);
  let summary = "Worker nền chạy pipeline hiện tại và chỉ đánh thức Codex tại checkpoint, lỗi, validation fail hoặc Final Audit.";
  try {
    const planned = await new CodexReasoner().decide(userId, { purpose: "PLAN", state: { sourceVideoId: job.sourceVideoId, channelId: job.channelId, checkpoint: job.checkpoint, stages: CODEX_STAGES }, allowedTools: [job.currentAction ?? "runAnalysisStage"] });
    summary = planned.decision.shortReason;
    if (planned.responseId) await db.codexJob.update({ where: { id: jobId }, data: { previousResponseId: planned.responseId } });
  } catch (error) {
    summary += ` Codex API chưa phản hồi; worker dùng kế hoạch xác định sẵn. ${error instanceof Error ? error.message : ""}`;
  }
  await db.codexJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });
  await appendCodexEvent(jobId, "PLAN_CREATED", undefined, { stages: CODEX_STAGES, executor: "background-worker" }, summary);
  await syncAutomation(jobId);
  return presentJob(jobId, userId);
}

export async function recordCodexProgress(jobId: string, userId: string, stage: CodexStage, detail: string, payload: Record<string, unknown> = {}) {
  const owned = await db.codexJob.findFirst({ where: { id: jobId, userId }, select: { id: true } });
  if (!owned) throw new AppError("CODEX_JOB_NOT_FOUND", "Không tìm thấy Codex job.", 404);
  await db.codexJob.update({ where: { id: jobId }, data: { currentStage: stage } });
  const latest = await db.codexEvent.findFirst({ where: { jobId, type: "STAGE_PROGRESS", stage }, orderBy: { sequence: "desc" }, select: { createdAt: true, reasoningSummary: true } });
  if (latest && Date.now() - latest.createdAt.getTime() < MIN_PROGRESS_EVENT_INTERVAL_MS && latest.reasoningSummary === detail) return;
  await appendCodexEvent(jobId, "STAGE_PROGRESS", stage, payload, detail);
}

export async function getCodexJob(userId: string, jobId: string) {
  await ensureCodexStorage();
  return presentJob(jobId, userId);
}

export async function listCodexJobs(userId: string) {
  await ensureCodexStorage();
  const jobs = await db.codexJob.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: 50 });
  return Promise.all(jobs.map(async (job) => {
    const [stages, events] = await Promise.all([
      db.codexStageState.findMany({ where: { jobId: job.id }, orderBy: { id: "asc" } }),
      db.codexEvent.findMany({ where: { jobId: job.id }, orderBy: { sequence: "desc" }, take: 20 }),
    ]);
    return { ...job, stages, events: [...events].reverse() };
  }));
}

export async function validateCodexStage(userId: string, jobId: string, stage: CodexStage) {
  await ensureCodexStorage();
  const state = await db.codexStageState.findFirst({ where: { jobId, stage, job: { userId } } });
  if (!state) throw new AppError("CODEX_STAGE_NOT_FOUND", "Không tìm thấy Expected State cần kiểm tra.", 404);
  if (!state.expectedState) return { verdict: "UNCERTAIN" as const, issues: [{ code: "EXPECTED_STATE_MISSING", message: "Stage chưa có Expected State." }] };
  return validateQuality(userId, stage, state.expectedState as ExpectedState);
}

export async function reportCodexEvent(userId: string, jobId: string, input: ReportCodexEventInput) {
  await ensureCodexStorage();
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, include: { stages: true } });
  if (!job) throw new AppError("CODEX_JOB_NOT_FOUND", "Không tìm thấy Codex job.", 404);
  if (job.status === "COMPLETED") return presentJob(jobId, userId);
  const stageState = job.stages.find((stage) => stage.stage === input.stage);
  if (!stageState) throw new AppError("CODEX_STAGE_NOT_FOUND", "Stage không thuộc Codex job.", 404);
  const actual = redactSecrets(input.actualState ?? {});
  if (input.type === "PROVIDER_FALLBACK") {
    await appendEvent(jobId, "PROVIDER_FALLBACK", input.stage, { fromProvider: input.provider, toProvider: input.fallbackProvider, reason: input.error });
    return presentJob(jobId, userId);
  }
  if (input.type === "STAGE_STARTED") {
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: input.stage } }, data: { status: "RUNNING", startedAt: stageState.startedAt ?? new Date() } });
    await db.codexJob.update({ where: { id: jobId }, data: { status: stageState.status === "RETRYING" || stageState.retryCount ? "RECOVERING" : "RUNNING", currentStage: input.stage, currentAction: null } });
    await appendEvent(jobId, "STAGE_STARTED", input.stage, { retry: stageState.retryCount, strategy: input.strategy ?? stageState.lastStrategy });
    const calledTool = input.action ?? (stageState.status === "RETRYING" && input.stage === "ASSETS" ? "regenerateAsset" : stageState.status === "RETRYING" && input.stage === "SCENES" ? "regenerateScene" : nextPendingAction([stageSnapshot({ ...stageState, status: "RUNNING" })]).name);
    await appendEvent(jobId, "TOOL_CALLED", input.stage, { tool: calledTool, strategy: input.strategy ?? stageState.lastStrategy });
    await syncAutomation(jobId);
    return presentJob(jobId, userId);
  }
  if (input.type === "STAGE_FAILED") {
    const message = input.error || "Stage failed without an error message.";
    // A stalled stage and the original provider error can arrive almost at the
    // same time. Claim the failure transition once so two workers cannot spend
    // two retries on the same interruption.
    const claimedFailure = await db.codexStageState.updateMany({
      where: { jobId, stage: input.stage, status: { in: ["PENDING", "RUNNING"] } },
      data: { actualState: json(actual) },
    });
    if (!claimedFailure.count) return presentJob(jobId, userId);
    await appendEvent(jobId, "TOOL_FAILED", input.stage, { provider: input.provider, error: message }, message);
    await appendEvent(jobId, "RUNTIME_FAILURE_REPORTED", input.stage, { source: "codex-stage", provider: input.provider, error: redactSecrets(message) }, "Lỗi stage đã được ghi nhận trước khi Codex chẩn đoán.");
    await appendEvent(jobId, "CODEX_WAKE_REQUESTED", input.stage, { source: "codex-stage", provider: input.provider }, "Đánh thức vòng điều phối Codex để chọn recovery.");
    return { ...(await presentJob(jobId, userId)), nextAction: await diagnoseAndRecover(jobId, userId, input.stage, message, actual, input.provider) };
  }
  let expected = stageState.expectedState as ExpectedState | null;
  if (input.stage === "PROJECT" && typeof actual.projectId === "string") {
    const states = await buildExpectedStates(actual.projectId, userId);
    expected = { stage: "PROJECT", projectId: actual.projectId };
    await db.$transaction(Object.entries(states).map(([stage, value]) => db.codexStageState.update({ where: { jobId_stage: { jobId, stage } }, data: { expectedState: json(value) } })));
    await db.codexJob.update({ where: { id: jobId }, data: { contentProjectId: actual.projectId, checkpoint: json({ ...record(job.checkpoint), projectId: actual.projectId }) } });
  }
  const validation = basicValidation(input.stage, actual) ?? validateExpectedActual(expected ?? undefined, actual);
  if (input.stage === "FINAL_AUDIT") {
    const incomplete = findIncompleteFinalAuditPrerequisite(job.stages);
    if (incomplete) {
      const snapshots = CODEX_STAGES.map((name) => job.stages.find((stage) => stage.stage === name)).filter((stage): stage is NonNullable<typeof stage> => Boolean(stage)).map(stageSnapshot);
      const action = nextPendingAction(snapshots);
      await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "FINAL_AUDIT" } }, data: { status: "PENDING", validationResult: "FAIL", validationIssues: json([{ code: "PIPELINE_INCOMPLETE", message: `Stage ${incomplete?.stage ?? "UNKNOWN"} chưa hoàn tất.` }]) } });
      await db.codexJob.update({ where: { id: jobId }, data: { status: "RUNNING", currentStage: action.stage ?? incomplete?.stage ?? "FINAL_AUDIT", currentAction: action.name, failureReason: null } });
      await appendEvent(jobId, "FINAL_AUDIT_FAILED", "FINAL_AUDIT", { code: "PIPELINE_INCOMPLETE", incompleteStage: incomplete?.stage });
      await syncAutomation(jobId);
      return presentJob(jobId, userId);
    }
  }
  if (validation.verdict !== "PASS") {
    if (input.stage === "FINAL_AUDIT") {
      const completedAt = new Date();
      await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: input.stage } }, data: { status: "COMPLETED", actualState: json(actual), validationResult: validation.verdict, validationIssues: json(validation.issues), completedAt } });
      await db.codexJob.update({ where: { id: jobId }, data: { checkpoint: json({ ...record(job.checkpoint), ...actual, lastCompletedStage: input.stage, finalAuditVerdict: validation.verdict }), status: "COMPLETED", currentStage: "FINAL_AUDIT", currentAction: "jobComplete", finalVideoId: typeof actual.finalVideoId === "string" ? actual.finalVideoId : undefined, finalVideoPath: typeof actual.finalVideoPath === "string" ? actual.finalVideoPath : undefined, finalVideoUrl: typeof actual.finalVideoUrl === "string" ? actual.finalVideoUrl : undefined, completedAt, failureReason: null } });
      await appendEvent(jobId, "STAGE_COMPLETED", input.stage, { validation: "DIAGNOSTIC_ONLY", verdict: validation.verdict, issues: validation.issues, actualState: actual });
      await appendEvent(jobId, "FINAL_AUDIT_RECORDED", input.stage, { verdict: validation.verdict, issues: validation.issues, completionGate: "FINAL_ASSEMBLY" }, "Final Audit chỉ ghi nhận vấn đề cải tiến; không chặn video đã xuất thành công.");
      await appendEvent(jobId, "JOB_COMPLETED", input.stage, { finalAudit: validation.verdict, completionGate: "FINAL_ASSEMBLY" });
      await syncAutomation(jobId);
      return presentJob(jobId, userId);
    }
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: input.stage } }, data: { actualState: json(actual), validationResult: validation.verdict, validationIssues: json(validation.issues) } });
    await appendEvent(jobId, "VALIDATION_FAILED", input.stage, { verdict: validation.verdict, issues: validation.issues });
    const message = validation.issues.map((issue) => issue.message).join(" ") || "Validation failed.";
    return { ...(await presentJob(jobId, userId)), nextAction: await diagnoseAndRecover(jobId, userId, input.stage, message, { ...actual, issues: validation.issues }, input.provider, validation) };
  }
  const hadRecovery = stageState.retryCount > 0 || Boolean(stageState.lastStrategy);
  await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: input.stage } }, data: { status: "COMPLETED", actualState: json(actual), validationResult: "PASS", validationIssues: json([]), completedAt: new Date() } });
  await db.codexJob.update({ where: { id: jobId }, data: { checkpoint: json({ ...record(job.checkpoint), ...actual, lastCompletedStage: input.stage }) } });
  await appendEvent(jobId, "STAGE_COMPLETED", input.stage, { validation: "PASS", actualState: actual });
  if (input.stage === "FINAL_ASSEMBLY") {
    const completedAt = new Date();
    await db.codexJob.update({ where: { id: jobId }, data: { checkpoint: json({ ...record(job.checkpoint), ...actual, lastCompletedStage: input.stage, generationSuccess: true }), status: "COMPLETED", currentStage: "FINAL_ASSEMBLY", currentAction: "jobComplete", generationStatus: "SUCCESS", qualityStatus: "NOT_RUN", outputReady: true, finalVideoPath: typeof actual.finalPath === "string" ? actual.finalPath : undefined, finalVideoUrl: typeof actual.finalVideoUrl === "string" ? actual.finalVideoUrl : undefined, completedAt, failureReason: null } });
    if (typeof actual.finalPath === "string") {
      try {
        await registerOriginalOutput({ projectId: String(actual.projectId ?? job.contentProjectId ?? ""), filePath: actual.finalPath, validationStatus: "PASS" });
      } catch (error) {
        await appendCodexEvent(jobId, "FINAL_AUDIT_RECORDED", "FINAL_AUDIT", { status: "OUTPUT_VERSION_REGISTRATION_WARNING", error: error instanceof Error ? error.message : String(error), generationStatus: "SUCCESS", outputReady: true }, "Không đăng ký được output version, nhưng final output thành công vẫn được giữ nguyên.");
      }
    }
    await appendEvent(jobId, "FINAL_ASSEMBLY_COMPLETED", input.stage, { finalVideoUrl: actual.finalVideoUrl, finalDurationSec: actual.finalDurationSec, finalResolution: actual.finalResolution });
    await appendEvent(jobId, "GENERATION_SUCCESS", input.stage, { outputReady: true, qualityStatus: "NOT_RUN" }, "Final Assembly hợp lệ: generation thành công, Content QA chưa chạy.");
    await appendEvent(jobId, "JOB_COMPLETED", input.stage, { completionGate: "FINAL_ASSEMBLY", generationStatus: "SUCCESS" });
    const finalProjectId = String(actual.projectId ?? job.contentProjectId ?? "");
    const finalVideoPath = String(actual.finalPath ?? "");
    let sourceValidation: SourceValidationContext | undefined;
    try { sourceValidation = await buildFinalSourceValidationContext(finalProjectId, userId, finalVideoPath, actual); }
    catch (error) { await appendEvent(jobId, "FINAL_AUDIT_RECORDED", "FINAL_AUDIT", { status: "SOURCE_VALIDATION_CONTEXT_ERROR", error: error instanceof Error ? error.message : String(error), generationStatus: "SUCCESS", outputReady: true }, "Không tạo được Source Validation Context; output generation vẫn khả dụng."); }
    void new PostAssemblyQaOrchestrator().run({ projectId: finalProjectId, finalVideoPath, finalVideoVersion: String(actual.finalVideoUrl ?? actual.finalPath ?? ""), approvedManifest: null, expectedSceneStates: {}, approvedSources: [], sourceValidation, checkpoint: { ...record(job.checkpoint), ...actual, finalMediaValidation: true } }).then(async qaRun => {
      await db.codexJob.update({ where: { id: jobId }, data: { qualityStatus: qaRun.qualityStatusAfter } });
      await appendEvent(jobId, "FINAL_AUDIT_RECORDED", "FINAL_AUDIT", { qaRunId: qaRun.qaRunId, status: qaRun.status, qualityStatus: qaRun.qualityStatusAfter, findings: qaRun.findings, incidentsCreated: qaRun.incidentsCreated, repairsTriggered: qaRun.repairsTriggered, generationStatus: "SUCCESS", outputReady: true }, "Post-Assembly QA chạy nền; không thay đổi generation success.");
    }).catch(async error => {
      await db.codexJob.update({ where: { id: jobId }, data: { qualityStatus: "NEEDS_REVIEW" } });
      await appendEvent(jobId, "FINAL_AUDIT_RECORDED", "FINAL_AUDIT", { status: "ERROR", error: error instanceof Error ? error.message : "unknown", generationStatus: "SUCCESS" }, "Post-Assembly QA lỗi; output generation vẫn khả dụng.");
    });
    await syncAutomation(jobId);
    return presentJob(jobId, userId);
  }
  if (hadRecovery) {
    await appendEvent(jobId, "RECOVERY_SUCCEEDED", input.stage, { strategy: stageState.lastStrategy });
    if (stageState.lastErrorSignature && stageState.lastStrategy) {
      const priorSuccess = await db.agentExperience.findFirst({ where: { stage: input.stage, provider: input.provider ?? null, errorSignature: stageState.lastErrorSignature, successfulFix: stageState.lastStrategy, result: "SUCCEEDED" }, orderBy: { lastSeenAt: "desc" } });
      if (priorSuccess) await db.agentExperience.update({ where: { id: priorSuccess.id }, data: { jobId, occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), actualState: json(actual) } });
      else await db.agentExperience.create({ data: { jobId, stage: input.stage, provider: input.provider, errorSignature: stageState.lastErrorSignature, successfulFix: stageState.lastStrategy, attemptedFix: stageState.lastStrategy, result: "SUCCEEDED", actualState: json(actual) } });
    }
  }
  if (input.stage === "FINAL_AUDIT") {
    await db.codexJob.update({ where: { id: jobId }, data: { checkpoint: json({ ...record(job.checkpoint), ...actual, lastCompletedStage: input.stage, finalAuditVerdict: "PASS" }), status: "COMPLETED", currentStage: "FINAL_AUDIT", currentAction: "jobComplete", finalVideoId: typeof actual.finalVideoId === "string" ? actual.finalVideoId : undefined, finalVideoPath: typeof actual.finalVideoPath === "string" ? actual.finalVideoPath : undefined, finalVideoUrl: typeof actual.finalVideoUrl === "string" ? actual.finalVideoUrl : undefined, completedAt: new Date(), failureReason: null } });
    await appendEvent(jobId, "FINAL_AUDIT_PASSED", input.stage, { finalVideoUrl: actual.finalVideoUrl });
    await appendEvent(jobId, "FINAL_AUDIT_RECORDED", input.stage, { verdict: "PASS", issues: [], completionGate: "FINAL_ASSEMBLY" }, "Final Audit đã ghi nhận; video được hoàn tất sau khi Final Assembly thành công.");
    await appendEvent(jobId, "JOB_COMPLETED", input.stage, { finalAudit: "PASS", completionGate: "FINAL_ASSEMBLY" });
    await syncAutomation(jobId);
  } else {
    const refreshed = await db.codexStageState.findMany({ where: { jobId } });
    const action = nextPendingAction(refreshed.map(stageSnapshot));
    await db.codexJob.update({ where: { id: jobId }, data: { status: "RUNNING", currentStage: action.stage ?? input.stage, currentAction: action.name, failureReason: null } });
    if (action.stage === "FINAL_AUDIT") await appendEvent(jobId, "FINAL_AUDIT_STARTED", "FINAL_AUDIT", {});
  }
  await syncAutomation(jobId);
  return presentJob(jobId, userId);
}

export async function runPostRunReview(jobId: string, userId: string) {
  const env = getEnv();
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, include: { events: true, experiences: true } });
  if (!job) return;
  const startedAt = new Date();
  await db.$transaction([
    db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "POST_RUN_REVIEW" } }, data: { status: "RUNNING", startedAt } }),
    db.codexJob.update({ where: { id: jobId }, data: { status: "RUNNING", currentStage: "POST_RUN_REVIEW", currentAction: "runPostRunReview", failureReason: null } }),
  ]);
  await syncAutomation(jobId);
  if (!env.CODEX_POST_RUN_REVIEW_ENABLED) {
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "POST_RUN_REVIEW" } }, data: { status: "SKIPPED", validationResult: "PASS", completedAt: new Date() } });
    await appendEvent(jobId, "POST_RUN_REVIEW_COMPLETED", "POST_RUN_REVIEW", { skipped: true, reason: "feature-flag-disabled" });
    await db.codexJob.update({ where: { id: jobId }, data: { status: "COMPLETED", currentStage: "POST_RUN_REVIEW", currentAction: "jobComplete", completedAt: new Date(), failureReason: null } });
    await appendEvent(jobId, "JOB_COMPLETED", "POST_RUN_REVIEW", { finalAudit: "PASS", postRunReview: "SKIPPED" });
    await syncAutomation(jobId);
    return;
  }
  let reviewSummary = "Đã phân loại lỗi transient, recovery và dấu hiệu hệ thống; không sửa production code.";
  let externalReferences: string[] = [];
  let alternativeSolutions: string[] = [];
  try {
    const result = await new CodexReasoner().decide(userId, { purpose: "POST_RUN_REVIEW", stage: "POST_RUN_REVIEW", state: { events: job.events.map((event) => ({ type: event.type, stage: event.stage, payload: event.payload })), experiences: job.experiences, externalResearchEnabled: env.CODEX_EXTERNAL_RESEARCH_ENABLED }, allowedTools: ["runPostRunReview"] }, job.previousResponseId);
    reviewSummary = result.decision.shortReason;
    externalReferences = result.decision.externalReferences ?? [];
    alternativeSolutions = result.decision.alternativeSolutions ?? [];
    if (result.responseId) await db.codexJob.update({ where: { id: jobId }, data: { previousResponseId: result.responseId } });
  } catch {
    reviewSummary += " Codex API không khả dụng nên đã lưu review xác định từ event log.";
  }
  const signatures = new Map<string, typeof job.experiences>();
  for (const experience of job.experiences) signatures.set(experience.errorSignature, [...(signatures.get(experience.errorSignature) ?? []), experience]);
  for (const [signature, matches] of signatures) {
    const historical = await db.agentExperience.aggregate({ where: { errorSignature: signature }, _sum: { occurrenceCount: true } });
    const historicalCount = historical._sum.occurrenceCount ?? 0;
    if (historicalCount < 2) continue;
    const sample = matches[0];
    const existing = await db.appImprovementCandidate.findFirst({ where: { affectedModule: sample.stage, category: signature, status: "PROPOSED" } });
    if (!existing) {
      await db.appImprovementCandidate.create({ data: { jobId, title: `Giảm lỗi lặp lại tại ${sample.stage}`, category: signature, affectedModule: sample.stage, evidence: json(matches.map((item) => ({ errorMessage: item.errorMessage, attemptedFix: item.attemptedFix, result: item.result }))), relatedJobs: json([...new Set(matches.map((item) => item.jobId).filter(Boolean))]), occurrenceCount: historicalCount, rootCause: sample.rootCause ?? "Cần xác minh bằng regression test.", currentBehavior: "Lỗi cùng chữ ký đã xuất hiện lặp lại.", desiredBehavior: "Stage tự xử lý ổn định mà không lặp lỗi.", proposedFix: "Tạo patch candidate riêng và regression test; không tự merge hoặc deploy.", externalReferences: json(externalReferences), alternativeSolutions: json(alternativeSolutions), riskLevel: "MEDIUM", expectedBenefit: "Giảm retry và thời gian hoàn thành job.", requiredTests: json(["Reproduce before patch", "Pass after patch", "Existing suite remains green"]), migrationImpact: "Chưa xác định; proposal không thay production." } });
      await appendEvent(jobId, "IMPROVEMENT_CANDIDATE_CREATED", "POST_RUN_REVIEW", { errorSignature: signature, occurrenceCount: historicalCount });
    }
  }
  await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "POST_RUN_REVIEW" } }, data: { status: "COMPLETED", actualState: json({ summary: reviewSummary }), validationResult: "PASS", completedAt: new Date() } });
  await appendEvent(jobId, "POST_RUN_REVIEW_COMPLETED", "POST_RUN_REVIEW", { summary: reviewSummary }, reviewSummary);
  await db.codexJob.update({ where: { id: jobId }, data: { status: "COMPLETED", currentStage: "POST_RUN_REVIEW", currentAction: "jobComplete", completedAt: new Date(), failureReason: null } });
  await appendEvent(jobId, "JOB_COMPLETED", "POST_RUN_REVIEW", { finalAudit: "PASS", postRunReview: "PASS" });
  await syncAutomation(jobId);
}
