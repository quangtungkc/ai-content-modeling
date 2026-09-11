import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { analyzeCompetitorVideo } from "@/modules/videos/analysis-service";
import { generateIdeasFromVideo } from "@/modules/ideas/service";
import { developApprovedIdea, setIdeaStatus } from "@/modules/ideas/approval-service";
import { readProjectImage, readProjectVideo } from "@/modules/assets/image-generation-service";
import { generateProjectImagesWithFlowBrowser, generateProjectVideosWithFlowBrowser, type BrowserFlowImageSlot, type BrowserFlowVideoSlot } from "@/modules/generation/browser-flow-bridge";
import { assembleProjectVideo } from "@/modules/generation/final-assembly-service";
import { appendCodexEvent, getCodexJob, initializeCodexPlan, recordCodexProgress, reportCodexEvent, runPostRunReview, validateCodexStage } from "./service";
import { attemptGuardedProductionRepair } from "./self-repair";
import type { CodexAction, CodexStage } from "./types";

type ImageSlot = BrowserFlowImageSlot;
type VideoSlot = BrowserFlowVideoSlot;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function exists(check: () => Promise<unknown>) {
  try { await check(); return true; } catch { return false; }
}

function stageProvider(stage: CodexStage) {
  return stage === "ASSETS" || stage === "SCENES" ? "FLOW_BROWSER" : stage === "MODELING" || stage === "PROJECT" || stage === "FINAL_AUDIT" ? "AI" : undefined;
}

function targetSceneNumbers(targetIds: string[] | undefined) {
  return new Set((targetIds ?? []).map((value) => Number(value.match(/\d+$/)?.[0] ?? value)).filter(Number.isInteger));
}

export function createStallGuard(timeoutMs: number, onStalled: () => Promise<void> | void) {
  let lastProgress = Date.now();
  let stopped = false;
  const timer = setInterval(() => {
    if (!stopped && Date.now() - lastProgress >= timeoutMs) {
      stopped = true;
      void onStalled();
    }
  }, Math.min(30_000, Math.max(1_000, Math.floor(timeoutMs / 5))));
  return {
    touch: () => { lastProgress = Date.now(); },
    stop: () => { stopped = true; clearInterval(timer); },
    isStalled: () => stopped,
  };
}

async function projectForJob(jobId: string, userId: string) {
  const job = await db.codexJob.findFirst({ where: { id: jobId, userId }, select: { contentProjectId: true, channelId: true } });
  if (!job?.contentProjectId) throw new Error("Codex job chưa có Content Project.");
  const project = await db.contentProject.findFirst({ where: { id: job.contentProjectId, channel: { userId } }, include: { scenes: { orderBy: { sceneNumber: "asc" } } } });
  if (!project) throw new Error("Không tìm thấy Content Project của Codex job.");
  return { job, project };
}

async function executeStage(jobId: string, userId: string, action: CodexAction, progress: (detail: string, payload?: Record<string, unknown>) => Promise<void>) {
  const stage = action.stage;
  if (!stage) throw new Error("Codex action thiếu stage.");
  if (action.name === "runPostRunReview") {
    await runPostRunReview(jobId, userId);
    return { postRunReview: "PASS" };
  }
  if (action.name === "runAnalysisStage") {
    const job = await db.codexJob.findUniqueOrThrow({ where: { id: jobId }, select: { sourceVideoId: true } });
    const result = await analyzeCompetitorVideo(job.sourceVideoId, userId);
    return { analysisId: result.id };
  }
  if (action.name === "runModelingStage") {
    const job = await db.codexJob.findUniqueOrThrow({ where: { id: jobId }, select: { sourceVideoId: true, checkpoint: true } });
    const settings = object(object(job.checkpoint).settings);
    const result = await generateIdeasFromVideo(job.sourceVideoId, userId, String(settings.artStyle ?? "Hoạt hình 3D"));
    const idea = result.ideas[0];
    if (!idea) throw new Error("Không tạo được Modeling Idea.");
    return { ideaId: idea.id, title: idea.title };
  }
  if (action.name === "runProjectDevelopmentStage") {
    const job = await db.codexJob.findUniqueOrThrow({ where: { id: jobId }, select: { checkpoint: true } });
    const checkpoint = object(job.checkpoint);
    const ideaId = String(checkpoint.ideaId ?? "");
    if (!ideaId) throw new Error("Checkpoint thiếu Modeling Idea.");
    await setIdeaStatus(ideaId, userId, "APPROVED");
    const project = await developApprovedIdea(ideaId, userId, undefined, String(object(checkpoint.settings).aspectRatio ?? "9:16"));
    return { projectId: project.id };
  }
  const { job, project } = await projectForJob(jobId, userId);
  const aspectRatio = String(object(project.artDirection).aspectRatio ?? "9:16");
  if (action.name === "validateAssets" || action.name === "validateScenes") {
    if (action.strategy === "provider-backoff" || action.strategy === "retry-quality-validation-after-backoff") {
      await progress("Quality Validator tạm nghỉ 30 giây trước khi kiểm tra lại.", { recoveryStrategy: action.strategy });
      await new Promise((resolve) => setTimeout(resolve, 30_000));
    }
    const stageState = await db.codexStageState.findUniqueOrThrow({ where: { jobId_stage: { jobId, stage } }, select: { actualState: true } });
    const quality = await validateCodexStage(userId, jobId, stage);
    return { ...object(stageState.actualState), semanticVerdict: quality.verdict, semanticFailureKind: quality.failureKind, semanticIssues: quality.issues };
  }
  if (action.name === "runAssetStage" || action.name === "regenerateAsset") {
    const targetNumbers = targetSceneNumbers(action.targetIds);
    const slots: ImageSlot[] = [];
    if (!await exists(() => readProjectImage(project.id, userId, "background", 0))) {
      slots.push({ kind: "background", sceneNumber: 0, label: "Bối cảnh", prompt: `Create one clean full-frame ${aspectRatio} background image. Approved background design: ${JSON.stringify(project.backgroundDesign)}. Do not create a collage, storyboard, labels, captions, characters, or text.`, aspectRatio });
    }
    for (const scene of project.scenes) {
      const requested = !targetNumbers.size || targetNumbers.has(scene.sceneNumber);
      const available = await exists(() => readProjectImage(project.id, userId, "scene", scene.sceneNumber));
      if (requested && (!available || action.name === "regenerateAsset")) slots.push({ kind: "scene", sceneNumber: scene.sceneNumber, label: `Cảnh ${scene.sceneNumber}`, prompt: scene.startFramePrompt || `${scene.visualBlock}\nInitial state only.`, aspectRatio });
    }
    if (slots.length) await generateProjectImagesWithFlowBrowser(project.id, userId, job.channelId, slots, progress, `codex-flow:${jobId}:ASSETS:${action.strategy ?? "initial"}:${[...targetNumbers].join(",") || "all"}`, jobId);
    const generatedAssetKeys = ["background-0"];
    for (const scene of project.scenes) if (await exists(() => readProjectImage(project.id, userId, "scene", scene.sceneNumber))) generatedAssetKeys.push(`scene-${scene.sceneNumber}`);
    const quality = await validateCodexStage(userId, jobId, "ASSETS");
    return { generatedAssetKeys, semanticVerdict: quality.verdict, semanticFailureKind: quality.failureKind, semanticIssues: quality.issues };
  }
  if (action.name === "runSceneGenerationStage" || action.name === "regenerateScene") {
    const targetNumbers = targetSceneNumbers(action.targetIds);
    const slots: VideoSlot[] = [];
    for (const scene of project.scenes) {
      const requested = !targetNumbers.size || targetNumbers.has(scene.sceneNumber);
      const available = await exists(() => readProjectVideo(project.id, userId, scene.sceneNumber));
      if (requested && (!available || action.name === "regenerateScene")) slots.push({ sceneNumber: scene.sceneNumber, label: `Cảnh ${scene.sceneNumber}`, visualBlock: scene.visualBlock, actionBlock: scene.actionBlock, audioBlock: scene.audioBlock, englishPrompt: scene.englishPrompt || scene.actionBlock, aspectRatio });
    }
    if (slots.length) await generateProjectVideosWithFlowBrowser(project.id, userId, job.channelId, slots, progress, `codex-flow:${jobId}:SCENES:${action.strategy ?? "initial"}:${[...targetNumbers].join(",") || "all"}`, jobId);
    const generatedSceneNumbers: number[] = [];
    for (const scene of project.scenes) if (await exists(() => readProjectVideo(project.id, userId, scene.sceneNumber))) generatedSceneNumbers.push(scene.sceneNumber);
    const quality = await validateCodexStage(userId, jobId, "SCENES");
    return { generatedSceneNumbers, semanticVerdict: quality.verdict, semanticFailureKind: quality.failureKind, semanticIssues: quality.issues };
  }
  if (action.name === "runFinalAssembly") {
    const result = await assembleProjectVideo(project.id, project.scenes.map((scene) => scene.sceneNumber), (detail, processed, total) => progress(detail, { processed, total }));
    return { finalVideoAvailable: true, ...result };
  }
  if (action.name === "runFinalAudit") {
    const quality = await validateCodexStage(userId, jobId, "FINAL_AUDIT");
    return { finalVideoAvailable: true, finalVideoUrl: `/api/v1/projects/${project.id}/videos?final=1`, generatedSceneNumbers: project.scenes.map((scene) => scene.sceneNumber), sceneOrder: project.scenes.map((scene) => scene.sceneNumber), aspectRatio, hasAudio: true, semanticVerdict: quality.verdict, semanticFailureKind: quality.failureKind, semanticIssues: quality.issues };
  }
  throw new Error(`Worker chưa hỗ trợ action ${action.name}.`);
}

export async function executeCodexJob(jobId: string, userId: string) {
  await initializeCodexPlan(jobId, userId);
  const env = getEnv();
  while (true) {
    const state = await getCodexJob(userId, jobId);
    if (state.status === "COMPLETED") return state;
    if (state.status === "NEEDS_HUMAN" || state.status === "NEEDS_ENGINEERING" || state.status === "FAILED") return state;
    const action = state.nextAction as CodexAction;
    if (action.name === "jobComplete") return state;
    if (action.name === "waitForHuman" || !action.stage) return state;
    await reportCodexEvent(userId, jobId, { type: "STAGE_STARTED", stage: action.stage, action: action.name, strategy: action.strategy });
    let stalled = false;
    let stallRecovery: Promise<void> | null = null;
    const stallGuard = createStallGuard(env.CODEX_STALL_TIMEOUT_MS, () => {
      stalled = true;
      stallRecovery = (async () => {
        await recordCodexProgress(jobId, userId, action.stage as CodexStage, "Không có tiến triển trong 5 phút; Codex được đánh thức để chẩn đoán.", { stalled: true, timeoutMs: env.CODEX_STALL_TIMEOUT_MS });
        await reportCodexEvent(userId, jobId, { type: "STAGE_FAILED", stage: action.stage as CodexStage, error: `STAGE_STALLED_${action.stage}: không có tiến triển trong ${env.CODEX_STALL_TIMEOUT_MS}ms.`, actualState: { stalled: true, timeoutMs: env.CODEX_STALL_TIMEOUT_MS }, provider: stageProvider(action.stage as CodexStage) });
      })();
      return stallRecovery;
    });
    const progress = async (detail: string, payload: Record<string, unknown> = {}) => {
      stallGuard.touch();
      await recordCodexProgress(jobId, userId, action.stage as CodexStage, detail, payload);
    };
    try {
      const actualState = await executeStage(jobId, userId, action, progress);
      if (stalled) throw new Error(`STAGE_STALLED_${action.stage}: không có tiến triển trong ${env.CODEX_STALL_TIMEOUT_MS}ms.`);
      // The stage watchdog must not fire while the checkpoint event itself is
      // running (Final Audit also persists Post-Run Review).
      stallGuard.stop();
      await reportCodexEvent(userId, jobId, { type: "STAGE_COMPLETED", stage: action.stage, actualState, provider: stageProvider(action.stage) });
    } catch (error) {
      stallGuard.stop();
      const message = error instanceof Error ? error.message : "Stage không hoàn tất.";
      const stack = error instanceof Error ? error.stack ?? error.message : String(error);
      if (stallRecovery) await stallRecovery;
      const diagnosis = stalled
        ? await getCodexJob(userId, jobId)
        : await reportCodexEvent(userId, jobId, { type: "STAGE_FAILED", stage: action.stage, error: message, actualState: { errorName: error instanceof Error ? error.name : "UnknownError", stack }, provider: stageProvider(action.stage) });
      if (diagnosis.status === "NEEDS_ENGINEERING") {
        await appendCodexEvent(jobId, "ENGINEERING_REPAIR_STARTED", action.stage, { guarded: true }, "Codex bắt đầu tạo patch trong workspace nguồn được kiểm soát.");
        try {
          const repaired = await attemptGuardedProductionRepair(userId, action.stage, { message, stack });
          await appendCodexEvent(jobId, "ENGINEERING_REPAIR_SUCCEEDED", action.stage, repaired, repaired.summary);
          await db.codexJob.update({ where: { id: jobId }, data: { failureReason: "Codex đã sửa source và build thành công. Cần khởi động lại/cập nhật bản build để nạp mã mới." } });
        } catch (repairError) {
          const repairMessage = repairError instanceof Error ? repairError.message : "Không thể tự sửa code.";
          await appendCodexEvent(jobId, "ENGINEERING_REPAIR_FAILED", action.stage, { error: repairMessage }, repairMessage);
          await db.codexJob.update({ where: { id: jobId }, data: { failureReason: repairMessage } });
        }
      }
    } finally {
      stallGuard.stop();
    }
  }
  throw new Error("Codex worker vượt quá giới hạn vòng điều phối an toàn.");
}
