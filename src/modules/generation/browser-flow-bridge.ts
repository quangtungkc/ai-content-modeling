import { db } from "@/lib/db";
import { LocalJobQueue } from "@/lib/jobs/queue";

export async function requestStage2GeminiBrowser(input: {
  userId: string; channelId: string; runId: string | null;
  purpose: "MODELING_IDEA" | "CONTENT_PROJECT_DEVELOP";
  video: Record<string, unknown>; analysis: unknown; channelDNA: unknown;
  idea?: unknown; artStyle?: string; aspectRatio?: string;
  codexJobId?: string;
}, onProgress?: (detail: string, payload?: Record<string, unknown>) => Promise<void>) {
  const queued = await new LocalJobQueue().enqueue("desktop.flow.quality", {
    ...input, stage: "STAGE2",
  }, `browser-stage2:${input.purpose}:${crypto.randomUUID()}`);
  return waitForBridgeJob(queued.jobId, onProgress);
}
import { buildCharacterIdentityInstruction, getCharacterIdentityPack } from "@/modules/channels/identity-pack";
import { assertCharacterIdentityPackReady } from "@/modules/assets/character-identity";
import { assertStrictModelingReady, compileStrictModelingConstraints } from "@/modules/modeling/strict-source-modeling";
import { markPromptSent, preparePromptForGeneration, verifyPersistedPromptForScene } from "@/modules/prompt-fidelity/service";

export type BrowserFlowImageSlot = {
  kind: "background" | "scene";
  sceneNumber?: number;
  label?: string;
  prompt: string;
  aspectRatio?: string;
  candidateId?: string;
  promptId?: string;
  validatedPrompt?: string;
  validatedPromptHash?: string;
};

export type BrowserFlowVideoSlot = {
  sceneNumber: number;
  sceneId?: string;
  label?: string;
  visualBlock: string;
  actionBlock: string;
  audioBlock: string;
  englishPrompt: string;
  aspectRatio?: string;
  promptId?: string;
  validatedPrompt?: string;
  validatedPromptHash?: string;
};

type BridgeRequest = {
  userId: string;
  projectId: string;
  channelId: string;
  requestKey: string;
  provider?: "flow-cdp" | "gemini-cdp";
  codexJobId?: string;
  stage?: "ASSETS" | "SCENES";
  slots: BrowserFlowImageSlot[] | BrowserFlowVideoSlot[];
  onProgress?: (detail: string, payload?: Record<string, unknown>) => Promise<void> | void;
};

export type BrowserSourceAnalysisInput = {
  userId: string;
  channelId: string;
  video: Record<string, unknown>;
  channelDNA: Record<string, unknown>;
};

const BRIDGE_TIMEOUT_MS = 30 * 60_000;
const BRIDGE_TOUCH_INTERVAL_MS = 15_000;
const BRIDGE_HEARTBEAT_STALE_MS = 90_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function waitForBridgeJob(jobId: string, onProgress?: BridgeRequest["onProgress"]) {
  const startedAt = Date.now();
  let lastTouch = 0;
  let lastProgress = 0;
  for (;;) {
    const job = await db.backgroundJob.findUnique({ where: { id: jobId }, select: { status: true, error: true, payload: true, startedAt: true } });
    if (!job) throw new Error("Không tìm thấy job Google Flow trên trình duyệt.");
    if (job.status === "succeeded") {
      const payload = record(job.payload);
      return record(payload.bridgeResult);
    }
    if (job.status === "failed") {
      const failure = record(record(job.payload).bridgeFailure);
      const error = new Error(typeof failure.message === "string" ? failure.message : job.error || "Google Flow trên trình duyệt không hoàn tất.");
      Object.assign(error, failure);
      throw error;
    }
    if (job.status === "running" && job.startedAt && Date.now() - job.startedAt.getTime() >= BRIDGE_HEARTBEAT_STALE_MS) {
      throw new Error("FLOW_BRIDGE_HEARTBEAT_STALE: Electron không còn heartbeat; dừng chờ để recovery từ checkpoint.");
    }
    if (Date.now() - startedAt >= BRIDGE_TIMEOUT_MS) throw new Error("Google Flow trên trình duyệt vượt quá thời gian chờ 30 phút.");

    const now = Date.now();
    if (now - lastTouch >= BRIDGE_TOUCH_INTERVAL_MS) {
      // Only Electron's claim heartbeat proves that the browser executor is alive.
      // A waiting worker must not refresh this lease after Electron has exited.
      lastTouch = now;
      if (onProgress && now - lastProgress >= BRIDGE_TOUCH_INTERVAL_MS) {
        await onProgress("Đang chờ Electron điều khiển Google Flow bằng trình duyệt...", { bridgeJobId: jobId });
        lastProgress = now;
      }
    }
    await sleep(1_000);
  }
}

async function enqueueAndWait(name: "desktop.flow.images" | "desktop.flow.videos" | "desktop.gemini.videos", input: BridgeRequest) {
  const queued = await enqueueBrowserFlowJob(name, input);
  return waitForBridgeJob(queued.jobId, input.onProgress);
}

export async function enqueueBrowserFlowJob(name: "desktop.flow.images" | "desktop.flow.videos" | "desktop.gemini.videos", input: Omit<BridgeRequest, "onProgress">) {
  if ((name === "desktop.gemini.videos") !== (input.provider === "gemini-cdp")) throw new Error("VIDEO_PROVIDER_EXECUTOR_MISMATCH");
  const project = await db.contentProject.findFirst({ where: { id: input.projectId, channelId: input.channelId, channel: { userId: input.userId } }, select: { id: true, sourceVideoId: true, sourceVideoUrl: true, sourceDuration: true, modelingPolicy: true, sourceModelingSpec: true, scenes: { select: { id: true, sceneNumber: true, sourceSceneId: true, targetDuration: true } } } });
  if (!project) throw new Error("Không tìm thấy content project để chạy Google Flow.");
  assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy, sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes });
  if (!(await getCharacterIdentityPack(input.channelId, input.userId))) throw new Error("MAIN_CHARACTER_IDENTITY_MISSING: Channel chưa có Character Identity Pack và reference nhân vật chính.");
  const preparedSlots = await Promise.all(input.slots.map(async (slot) => {
    const isImage = name === "desktop.flow.images";
    const imageSlot = slot as BrowserFlowImageSlot;
    const videoSlot = slot as BrowserFlowVideoSlot;
    const sceneNumber = isImage && imageSlot.kind === "scene" ? imageSlot.sceneNumber : !isImage ? videoSlot.sceneNumber : undefined;
    const existingPrompt = isImage ? imageSlot.validatedPrompt : videoSlot.validatedPrompt;
    const existingPromptId = isImage ? imageSlot.promptId : videoSlot.promptId;
    const existingPromptHash = isImage ? imageSlot.validatedPromptHash : videoSlot.validatedPromptHash;
    if (existingPrompt && existingPromptId) {
      const sceneId = project.scenes.find((scene) => scene.sceneNumber === sceneNumber)?.id ?? null;
      await verifyPersistedPromptForScene({ promptId: existingPromptId, projectId: input.projectId, sceneId, promptType: isImage ? "IMAGE" : "VIDEO", prompt: existingPrompt, promptHash: existingPromptHash });
      return isImage ? { ...imageSlot, prompt: existingPrompt } : { ...videoSlot, englishPrompt: existingPrompt };
    }
    const draftPrompt = isImage ? imageSlot.prompt : videoSlot.englishPrompt;
    const prepared = await preparePromptForGeneration({ projectId: input.projectId, userId: input.userId, sceneNumber, promptType: isImage ? "IMAGE" : "VIDEO", draftPrompt });
    await markPromptSent(prepared.promptId, prepared.validatedPrompt);
    return isImage ? { ...imageSlot, prompt: prepared.validatedPrompt, promptId: prepared.promptId, validatedPrompt: prepared.validatedPrompt, validatedPromptHash: prepared.promptHash } : { ...videoSlot, englishPrompt: prepared.validatedPrompt, promptId: prepared.promptId, validatedPrompt: prepared.validatedPrompt, validatedPromptHash: prepared.promptHash };
  }));
  const payload: Record<string, unknown> = {
    userId: input.userId,
    projectId: input.projectId,
    channelId: input.channelId,
    slots: preparedSlots,
    bridgeStatus: "QUEUED",
  };
  if (input.codexJobId) payload.codexJobId = input.codexJobId;
  if (input.stage) payload.stage = input.stage;
  if (input.provider) payload.provider = input.provider;
  return new LocalJobQueue().enqueue(name, payload, input.requestKey);
}

export async function analyzeSourceVideoWithGeminiBrowser(input: BrowserSourceAnalysisInput) {
  const queued = await new LocalJobQueue().enqueue("desktop.flow.quality", {
    userId: input.userId,
    channelId: input.channelId,
    stage: "ANALYSIS",
    purpose: "SOURCE_ANALYSIS",
    video: input.video,
    channelDNA: input.channelDNA,
  }, `browser-source-analysis:${String(input.video.id)}:${crypto.randomUUID()}`);
  return waitForBridgeJob(queued.jobId);
}

export async function generateProjectImagesWithFlowBrowser(
  projectId: string,
  userId: string,
  channelId: string,
  slots: BrowserFlowImageSlot[],
  onProgress: BridgeRequest["onProgress"],
  requestKey: string,
  codexJobId?: string,
) {
  if (!slots.length) throw new Error("Không có ảnh cần tạo bằng Google Flow.");
  const pack = assertCharacterIdentityPackReady(await getCharacterIdentityPack(channelId, userId));
  const project = await db.contentProject.findFirst({ where: { id: projectId, channelId, channel: { userId } }, select: { sourceVideoId: true, sourceVideoUrl: true, sourceDuration: true, modelingPolicy: true, sourceModelingSpec: true, scenes: { select: { sceneNumber: true, sourceSceneId: true, targetDuration: true } } } });
  if (!project) throw new Error("Không tìm thấy content project để chạy Google Flow.");
  const strictSpec = assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy, sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes });
  const boundSlots = slots.map(slot => ({ ...slot, prompt: `${buildCharacterIdentityInstruction(pack)}\n${compileStrictModelingConstraints(strictSpec, slot.sceneNumber ? project.scenes.find(scene => scene.sceneNumber === slot.sceneNumber)?.sourceSceneId ?? undefined : undefined)}\n${slot.prompt}` }));
  const result = await enqueueAndWait("desktop.flow.images", { userId, projectId, channelId, slots: boundSlots, requestKey, onProgress, codexJobId, stage: "ASSETS" });
  return { status: "completed", provider: "flow-browser", images: record(result.images) };
}

export async function generateProjectVideosWithFlowBrowser(
  projectId: string,
  userId: string,
  channelId: string,
  slots: BrowserFlowVideoSlot[],
  onProgress: BridgeRequest["onProgress"],
  requestKey: string,
  codexJobId?: string,
) {
  if (!slots.length) throw new Error("Không có video cảnh cần tạo bằng Google Flow.");
  const pack = assertCharacterIdentityPackReady(await getCharacterIdentityPack(channelId, userId));
  const project = await db.contentProject.findFirst({ where: { id: projectId, channelId, channel: { userId } }, select: { sourceVideoId: true, sourceVideoUrl: true, sourceDuration: true, modelingPolicy: true, sourceModelingSpec: true, scenes: { select: { sceneNumber: true, sourceSceneId: true, targetDuration: true } } } });
  if (!project) throw new Error("Không tìm thấy content project để chạy Google Flow.");
  const strictSpec = assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy, sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes });
  const boundSlots = slots.map(slot => ({ ...slot, englishPrompt: `${buildCharacterIdentityInstruction(pack)}\n${compileStrictModelingConstraints(strictSpec, project.scenes.find(scene => scene.sceneNumber === slot.sceneNumber)?.sourceSceneId ?? undefined)}\n${slot.englishPrompt}` }));
  const result = await enqueueAndWait("desktop.flow.videos", { userId, projectId, channelId, slots: boundSlots, requestKey, onProgress, codexJobId, stage: "SCENES" });
  return { status: "completed", provider: "flow-browser", videos: record(result.videos) };
}
