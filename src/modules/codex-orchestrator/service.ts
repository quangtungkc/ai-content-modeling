import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { CodexReasoner } from "./reasoner";
import { ensureCodexStorage } from "./storage";
import { buildSceneExpectedState, chooseRecoveryStrategy, classifyFailure, createErrorSignature, findIncompleteFinalAuditPrerequisite, nextPendingAction, recoveryStrategies, redactSecrets, validateExpectedActual } from "./policy";
import { CODEX_STAGES, type CodexAction, type CodexEventType, type CodexStage, type CodexStageSnapshot, type ExpectedState, type ReportCodexEventInput, type ValidationOutput } from "./types";
import { validateQuality } from "./quality-validator";

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

type CreateJobInput = {
  sourceVideoId: string;
  idempotencyKey: string;
  settings: { artStyle: string; aspectRatio: "9:16" | "16:9" | "1:1" | "4:5"; postText?: string; hashtags?: string; language?: string; targetCountry?: string };
};

type StoredStage = { stage: string; status: string; retryCount: number; maxRetries: number; expectedState: unknown; actualState: unknown; validationResult: string | null; lastStrategy: string | null };

const json = (value: unknown) => redactSecrets(value) as Prisma.InputJsonValue;
const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

async function appendEvent(jobId: string, type: CodexEventType, stage?: CodexStage, payload: Record<string, unknown> = {}, reasoningSummary?: string) {
  const aggregate = await db.codexEvent.aggregate({ where: { jobId }, _max: { sequence: true } });
  return db.codexEvent.create({ data: { jobId, sequence: (aggregate._max.sequence ?? 0) + 1, type, stage, payload: json(payload), reasoningSummary: reasoningSummary ? redactSecrets(reasoningSummary) : undefined } });
}

function basicValidation(stage: CodexStage, actual: Record<string, unknown> | undefined): ValidationOutput | null {
  const required: Partial<Record<CodexStage, string>> = { ANALYSIS: "analysisId", MODELING: "ideaId", PROJECT: "projectId" };
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
  const idea = record(project.idea.content);
  const sourceIntent = String(idea.sourceMechanism ?? idea.coreConcept ?? project.idea.title);
  const scenes = project.scenes.map((scene) => buildSceneExpectedState({
    ...scene,
    sceneId: scene.id,
    characterDesign: project.characterDesign,
    backgroundDesign: project.backgroundDesign,
    sourceModelingIntent: sourceIntent,
  }));
  const sceneNumbers = scenes.map((scene) => scene.sceneNumber);
  const aspectRatio = String(record(project.artDirection).aspectRatio ?? "9:16");
  return {
    ASSETS: { stage: "ASSETS", projectId, requiredAssetKeys: ["background-0", ...sceneNumbers.map((number) => `scene-${number}`)], scenes } satisfies ExpectedState,
    SCENES: { stage: "SCENES", projectId, expectedSceneNumbers: sceneNumbers, expectedDurationPerScene: 4, scenes } satisfies ExpectedState,
    FINAL_ASSEMBLY: { stage: "FINAL_ASSEMBLY", projectId, expectedSceneOrder: sceneNumbers, expectedAspectRatio: aspectRatio, requireAudio: true, requireFinalVideo: true } satisfies ExpectedState,
    FINAL_AUDIT: { stage: "FINAL_AUDIT", projectId, expectedSceneNumbers: sceneNumbers, expectedSceneOrder: sceneNumbers, expectedAspectRatio: aspectRatio, expectedDurationPerScene: 4, requireAudio: true, requireFinalVideo: true, scenes } satisfies ExpectedState,
  };
}

async function syncAutomation(jobId: string) {
  const job = await db.codexJob.findUnique({ where: { id: jobId }, include: { stages: true } });
  if (!job?.automationRunId) return;
  const steps = CODEX_STAGES.map((stage) => {
    const item = job.stages.find((candidate) => candidate.stage === stage);
    const status = item?.status === "COMPLETED" || item?.status === "SKIPPED" ? "completed" : item?.status === "RUNNING" || item?.status === "RETRYING" ? "running" : item?.status === "FAILED" ? "failed" : "pending";
    return { key: automationKey(stage), label: labels[stage], status, detail: item?.validationResult ? `Validation: ${item.validationResult}` : undefined };
  });
  const status = job.status === "COMPLETED" ? "SUCCEEDED" : job.status === "FAILED" || job.status === "NEEDS_HUMAN" ? "FAILED" : "RUNNING";
  await db.automationRun.update({ where: { id: job.automationRunId }, data: { status, steps: json(steps), projectId: job.contentProjectId, error: job.failureReason, ...(status !== "RUNNING" ? { completedAt: new Date() } : {}) } });
}

async function presentJob(jobId: string, userId: string) {
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, include: { stages: { orderBy: { id: "asc" } }, events: { orderBy: { sequence: "asc" }, take: 250 } } });
  if (!job) throw new AppError("CODEX_JOB_NOT_FOUND", "Không tìm thấy Codex job.", 404);
  const snapshots = CODEX_STAGES.map((name) => job.stages.find((stage) => stage.stage === name)).filter((stage): stage is NonNullable<typeof stage> => Boolean(stage)).map(stageSnapshot);
  return { ...job, stages: snapshots, nextAction: job.status === "COMPLETED" ? { name: "jobComplete" } : job.status === "NEEDS_HUMAN" || job.status === "FAILED" ? { name: "waitForHuman", reason: job.failureReason } : nextPendingAction(snapshots) };
}

async function diagnoseAndRecover(jobId: string, userId: string, stage: CodexStage, message: string, actual: Record<string, unknown>, provider?: string, validationFailure = false): Promise<CodexAction> {
  const env = getEnv();
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, include: { stages: true, events: { where: { type: "RECOVERY_STARTED", stage }, orderBy: { sequence: "asc" } } } });
  if (!job) throw new AppError("CODEX_JOB_NOT_FOUND", "Không tìm thấy Codex job.", 404);
  const stageState = job.stages.find((item) => item.stage === stage);
  if (!stageState) throw new AppError("CODEX_STAGE_NOT_FOUND", "Không tìm thấy stage cần recovery.", 404);
  const kind = classifyFailure(message, validationFailure);
  const signature = createErrorSignature(stage, message);
  const attempted = job.events.map((event) => String(record(event.payload).strategy ?? "")).filter(Boolean);
  const experience = await db.agentExperience.findFirst({ where: { stage, provider: provider ?? null, errorSignature: signature, result: "SUCCEEDED", successfulFix: { not: null } }, orderBy: { lastSeenAt: "desc" } });
  const candidates = recoveryStrategies(stage, kind, message);
  let strategy = chooseRecoveryStrategy(candidates, attempted, experience?.successfulFix);
  let reason = experience?.successfulFix ? "Ưu tiên cách sửa đã thành công với lỗi cùng chữ ký." : `Áp dụng recovery khác với ${attempted.length} lần thử trước.`;
  if (strategy && env.CODEX_ORCHESTRATOR_ENABLED) {
    try {
      const result = await new CodexReasoner().decide(userId, { purpose: "RECOVERY", stage, state: { failureKind: kind, errorSignature: signature, message, expectedState: stageState.expectedState, actualState: actual, previousAttempts: attempted, experienceMatch: experience, candidateStrategies: candidates }, allowedTools: stage === "ASSETS" ? ["regenerateAsset", "runAssetStage", "waitForHuman"] : stage === "SCENES" ? ["regenerateScene", "runSceneGenerationStage", "waitForHuman"] : ["runAnalysisStage", "runModelingStage", "runProjectDevelopmentStage", "runFinalAssembly", "runFinalAudit", "waitForHuman"] }, job.previousResponseId);
      if (result.decision.strategy && (candidates.includes(result.decision.strategy) || result.decision.strategy === experience?.successfulFix)) strategy = result.decision.strategy;
      reason = result.decision.shortReason;
      if (result.responseId) await db.codexJob.update({ where: { id: jobId }, data: { previousResponseId: result.responseId } });
    } catch {
      reason = `${reason} Codex API tạm thời không khả dụng; policy an toàn dùng chiến lược xác định sẵn.`;
    }
  }
  await appendEvent(jobId, "ERROR_DIAGNOSED", stage, { failureKind: kind, errorSignature: signature, evidence: redactSecrets(message) }, reason);
  const exhausted = stageState.retryCount >= stageState.maxRetries || !strategy || /request-human/.test(strategy) || !env.CODEX_AUTO_RECOVERY_ENABLED;
  if (exhausted) {
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage } }, data: { status: "FAILED", validationResult: validationFailure ? "FAIL" : undefined, lastErrorSignature: signature } });
    await db.codexJob.update({ where: { id: jobId }, data: { status: "NEEDS_HUMAN", currentStage: stage, currentAction: "waitForHuman", failureReason: redactSecrets(message) } });
    await appendEvent(jobId, "RECOVERY_FAILED", stage, { errorSignature: signature, attempts: stageState.retryCount });
    await appendEvent(jobId, "JOB_NEEDS_HUMAN", stage, { reason: redactSecrets(message) });
    await syncAutomation(jobId);
    return { name: "waitForHuman", stage, reason: message };
  }
  const selectedStrategy = strategy as string;
  const nextRetry = stageState.retryCount + 1;
  await db.codexStageState.update({ where: { jobId_stage: { jobId, stage } }, data: { status: "RETRYING", retryCount: nextRetry, lastErrorSignature: signature, lastStrategy: selectedStrategy, actualState: json(actual), validationResult: validationFailure ? "FAIL" : undefined } });
  await db.codexJob.update({ where: { id: jobId }, data: { status: "RECOVERING", currentStage: stage, currentAction: stage === "ASSETS" ? "regenerateAsset" : stage === "SCENES" ? "regenerateScene" : undefined, retryCount: { increment: 1 }, failureReason: null } });
  const priorAttempt = await db.agentExperience.findFirst({ where: { stage, provider: provider ?? null, errorSignature: signature, attemptedFix: selectedStrategy, result: "ATTEMPTED" }, orderBy: { lastSeenAt: "desc" } });
  if (priorAttempt) await db.agentExperience.update({ where: { id: priorAttempt.id }, data: { jobId, occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), errorMessage: redactSecrets(message), expectedState: stageState.expectedState ?? undefined, actualState: json(actual), rootCause: reason } });
  else await db.agentExperience.create({ data: { jobId, stage, provider, errorSignature: signature, errorMessage: redactSecrets(message), expectedState: stageState.expectedState ?? undefined, actualState: json(actual), attemptedFix: selectedStrategy, rootCause: reason, result: "ATTEMPTED" } });
  await appendEvent(jobId, "RECOVERY_STARTED", stage, { strategy: selectedStrategy, retry: nextRetry, errorSignature: signature }, reason);
  const issueTargets = Array.isArray(actual.issues) ? actual.issues.map((issue) => record(issue)).map((issue) => String(issue.targetId ?? issue.sceneNumber ?? "")).filter(Boolean) : [];
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
  return { name: stage === "ASSETS" ? "regenerateAsset" : stage === "SCENES" ? "regenerateScene" : nextPendingAction([stageSnapshot({ ...stageState, status: "RETRYING", retryCount: nextRetry, lastStrategy: selectedStrategy })]).name, stage, targetIds: issueTargets, strategy: selectedStrategy, reason };
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
  await appendEvent(result.id, "CODEX_JOB_STARTED", undefined, { sourceVideoId: source.id, channelId: source.competitor.channel.id });
  let summary = "Kế hoạch dùng pipeline hiện tại và chỉ đánh thức Codex ở checkpoint, lỗi, validation fail và Final Audit.";
  try {
    const planned = await new CodexReasoner().decide(userId, { purpose: "PLAN", state: { sourceVideoId: source.id, hasAnalysis: source.analyses.length > 0, channelId: source.competitor.channel.id, stages: CODEX_STAGES, settings: input.settings }, allowedTools: [source.analyses.length ? "runModelingStage" : "runAnalysisStage"] });
    summary = planned.decision.shortReason;
    if (planned.responseId) await db.codexJob.update({ where: { id: result.id }, data: { previousResponseId: planned.responseId } });
  } catch {
    summary += " Codex API chưa phản hồi; job giữ checkpoint và có thể resume khi kết nối sẵn sàng.";
  }
  await db.codexJob.update({ where: { id: result.id }, data: { status: "RUNNING" } });
  await appendEvent(result.id, "PLAN_CREATED", undefined, { stages: CODEX_STAGES }, summary);
  await syncAutomation(result.id);
  return presentJob(result.id, userId);
}

export async function getCodexJob(userId: string, jobId: string) {
  await ensureCodexStorage();
  return presentJob(jobId, userId);
}

export async function listCodexJobs(userId: string) {
  await ensureCodexStorage();
  return db.codexJob.findMany({ where: { userId }, orderBy: { startedAt: "desc" }, take: 50, include: { stages: true, events: { orderBy: { sequence: "desc" }, take: 20 } } });
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
    await db.codexJob.update({ where: { id: jobId }, data: { status: stageState.retryCount ? "RECOVERING" : "RUNNING", currentStage: input.stage, currentAction: null } });
    await appendEvent(jobId, "STAGE_STARTED", input.stage, { retry: stageState.retryCount, strategy: stageState.lastStrategy });
    const calledTool = stageState.status === "RETRYING" && input.stage === "ASSETS" ? "regenerateAsset" : stageState.status === "RETRYING" && input.stage === "SCENES" ? "regenerateScene" : nextPendingAction([stageSnapshot({ ...stageState, status: "RUNNING" })]).name;
    await appendEvent(jobId, "TOOL_CALLED", input.stage, { tool: calledTool, strategy: stageState.lastStrategy });
    await syncAutomation(jobId);
    return presentJob(jobId, userId);
  }
  if (input.type === "STAGE_FAILED") {
    const message = input.error || "Stage failed without an error message.";
    await appendEvent(jobId, "TOOL_FAILED", input.stage, { provider: input.provider, error: message }, message);
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
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: input.stage } }, data: { actualState: json(actual), validationResult: validation.verdict, validationIssues: json(validation.issues) } });
    await appendEvent(jobId, "VALIDATION_FAILED", input.stage, { verdict: validation.verdict, issues: validation.issues });
    if (input.stage === "FINAL_AUDIT") await appendEvent(jobId, "FINAL_AUDIT_FAILED", input.stage, { issues: validation.issues });
    const message = validation.issues.map((issue) => issue.message).join(" ") || "Validation failed.";
    return { ...(await presentJob(jobId, userId)), nextAction: await diagnoseAndRecover(jobId, userId, input.stage, message, { ...actual, issues: validation.issues }, input.provider, true) };
  }
  const hadRecovery = stageState.retryCount > 0;
  await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: input.stage } }, data: { status: "COMPLETED", actualState: json(actual), validationResult: "PASS", validationIssues: json([]), completedAt: new Date() } });
  await db.codexJob.update({ where: { id: jobId }, data: { checkpoint: json({ ...record(job.checkpoint), ...actual, lastCompletedStage: input.stage }) } });
  await appendEvent(jobId, "STAGE_COMPLETED", input.stage, { validation: "PASS", actualState: actual });
  if (input.stage === "FINAL_ASSEMBLY") await appendEvent(jobId, "FINAL_ASSEMBLY_COMPLETED", input.stage, { finalVideoUrl: actual.finalVideoUrl });
  if (hadRecovery) {
    await appendEvent(jobId, "RECOVERY_SUCCEEDED", input.stage, { strategy: stageState.lastStrategy });
    if (stageState.lastErrorSignature && stageState.lastStrategy) {
      const priorSuccess = await db.agentExperience.findFirst({ where: { stage: input.stage, provider: input.provider ?? null, errorSignature: stageState.lastErrorSignature, successfulFix: stageState.lastStrategy, result: "SUCCEEDED" }, orderBy: { lastSeenAt: "desc" } });
      if (priorSuccess) await db.agentExperience.update({ where: { id: priorSuccess.id }, data: { jobId, occurrenceCount: { increment: 1 }, lastSeenAt: new Date(), actualState: json(actual) } });
      else await db.agentExperience.create({ data: { jobId, stage: input.stage, provider: input.provider, errorSignature: stageState.lastErrorSignature, successfulFix: stageState.lastStrategy, attemptedFix: stageState.lastStrategy, result: "SUCCEEDED", actualState: json(actual) } });
    }
  }
  if (input.stage === "FINAL_AUDIT") {
    await appendEvent(jobId, "FINAL_AUDIT_PASSED", input.stage, { finalVideoUrl: actual.finalVideoUrl });
    await db.codexJob.update({ where: { id: jobId }, data: { status: "COMPLETED", currentStage: "POST_RUN_REVIEW", currentAction: "runPostRunReview", finalVideoId: typeof actual.finalVideoId === "string" ? actual.finalVideoId : undefined, finalVideoPath: typeof actual.finalVideoPath === "string" ? actual.finalVideoPath : undefined, finalVideoUrl: typeof actual.finalVideoUrl === "string" ? actual.finalVideoUrl : undefined, completedAt: new Date(), failureReason: null } });
    await appendEvent(jobId, "JOB_COMPLETED", input.stage, { finalAudit: "PASS" });
    await runPostRunReview(jobId, userId);
  } else {
    const refreshed = await db.codexStageState.findMany({ where: { jobId } });
    const action = nextPendingAction(refreshed.map(stageSnapshot));
    await db.codexJob.update({ where: { id: jobId }, data: { status: "RUNNING", currentStage: action.stage ?? input.stage, currentAction: action.name, failureReason: null } });
    if (action.stage === "FINAL_AUDIT") await appendEvent(jobId, "FINAL_AUDIT_STARTED", "FINAL_AUDIT", {});
  }
  await syncAutomation(jobId);
  return presentJob(jobId, userId);
}

async function runPostRunReview(jobId: string, userId: string) {
  const env = getEnv();
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, include: { events: true, experiences: true } });
  if (!job) return;
  if (!env.CODEX_POST_RUN_REVIEW_ENABLED) {
    await db.codexStageState.update({ where: { jobId_stage: { jobId, stage: "POST_RUN_REVIEW" } }, data: { status: "SKIPPED", validationResult: "PASS", completedAt: new Date() } });
    await appendEvent(jobId, "POST_RUN_REVIEW_COMPLETED", "POST_RUN_REVIEW", { skipped: true, reason: "feature-flag-disabled" });
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
  await syncAutomation(jobId);
}
