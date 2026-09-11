import { db } from "@/lib/db";
import { LocalJobQueue } from "@/lib/jobs/queue";

export type BrowserFlowImageSlot = {
  kind: "background" | "scene";
  sceneNumber?: number;
  label?: string;
  prompt: string;
  aspectRatio?: string;
};

export type BrowserFlowVideoSlot = {
  sceneNumber: number;
  label?: string;
  visualBlock: string;
  actionBlock: string;
  audioBlock: string;
  englishPrompt: string;
  aspectRatio?: string;
};

type BridgeRequest = {
  userId: string;
  projectId: string;
  channelId: string;
  requestKey: string;
  codexJobId?: string;
  stage?: "ASSETS" | "SCENES";
  slots: BrowserFlowImageSlot[] | BrowserFlowVideoSlot[];
  onProgress?: (detail: string, payload?: Record<string, unknown>) => Promise<void> | void;
};

const BRIDGE_TIMEOUT_MS = 30 * 60_000;
const BRIDGE_TOUCH_INTERVAL_MS = 15_000;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForBridgeJob(jobId: string, onProgress?: BridgeRequest["onProgress"]) {
  const startedAt = Date.now();
  let lastTouch = 0;
  let lastProgress = 0;
  for (;;) {
    const job = await db.backgroundJob.findUnique({ where: { id: jobId }, select: { status: true, error: true, payload: true } });
    if (!job) throw new Error("Không tìm thấy job Google Flow trên trình duyệt.");
    if (job.status === "succeeded") {
      const payload = record(job.payload);
      return record(payload.bridgeResult);
    }
    if (job.status === "failed") throw new Error(job.error || "Google Flow trên trình duyệt không hoàn tất.");
    if (Date.now() - startedAt >= BRIDGE_TIMEOUT_MS) throw new Error("Google Flow trên trình duyệt vượt quá thời gian chờ 30 phút.");

    const now = Date.now();
    if (now - lastTouch >= BRIDGE_TOUCH_INTERVAL_MS) {
      await db.backgroundJob.updateMany({ where: { id: jobId, status: { in: ["queued", "running"] } }, data: { startedAt: new Date() } });
      lastTouch = now;
      if (onProgress && now - lastProgress >= BRIDGE_TOUCH_INTERVAL_MS) {
        await onProgress("Đang chờ Electron điều khiển Google Flow bằng trình duyệt...", { bridgeJobId: jobId });
        lastProgress = now;
      }
    }
    await sleep(1_000);
  }
}

async function enqueueAndWait(name: "desktop.flow.images" | "desktop.flow.videos", input: BridgeRequest) {
  const queued = await enqueueBrowserFlowJob(name, input);
  return waitForBridgeJob(queued.jobId, input.onProgress);
}

export async function enqueueBrowserFlowJob(name: "desktop.flow.images" | "desktop.flow.videos", input: Omit<BridgeRequest, "onProgress">) {
  const project = await db.contentProject.findFirst({ where: { id: input.projectId, channelId: input.channelId, channel: { userId: input.userId } }, select: { id: true } });
  if (!project) throw new Error("Không tìm thấy content project để chạy Google Flow.");
  const payload: Record<string, unknown> = {
    userId: input.userId,
    projectId: input.projectId,
    channelId: input.channelId,
    slots: input.slots,
    bridgeStatus: "QUEUED",
  };
  if (input.codexJobId) payload.codexJobId = input.codexJobId;
  if (input.stage) payload.stage = input.stage;
  return new LocalJobQueue().enqueue(name, payload, input.requestKey);
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
  const result = await enqueueAndWait("desktop.flow.images", { userId, projectId, channelId, slots, requestKey, onProgress, codexJobId, stage: "ASSETS" });
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
  const result = await enqueueAndWait("desktop.flow.videos", { userId, projectId, channelId, slots, requestKey, onProgress, codexJobId, stage: "SCENES" });
  return { status: "completed", provider: "flow-browser", videos: record(result.videos) };
}
