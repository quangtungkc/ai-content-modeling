import { randomUUID } from "node:crypto";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { db } from "@/lib/db";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { readChannelMainCharacterImage } from "@/modules/channels/service";
import { requireProviderApiKey } from "@/modules/ai-connections/credentials";
import { readProjectImage, writeProjectImage } from "@/modules/assets/image-generation-service";
import { GeminiProvider } from "@/services/ai/gemini";
import { createGenerationJob, runGenerationJob } from "./job-service";
import type { VeoRequest } from "@/services/video-generation/types";

type ImageSlot = { kind: "background" | "scene"; sceneNumber?: number; label?: string; prompt: string; aspectRatio?: string };
export type VideoSlot = { sceneNumber: number; label?: string; visualBlock: string; actionBlock: string; audioBlock: string; englishPrompt: string; aspectRatio?: string };

function ensureApiFirst() {
  const env = getEnv();
  if (!env.GOOGLE_API_FIRST_ENABLED) throw new AppError("API_PROVIDER_UNAVAILABLE", "Google API-first đang tắt; có thể dùng Flow fallback.", 503, { browserFallback: env.GOOGLE_BROWSER_FALLBACK_ENABLED });
}

function providerUnavailable(message: string) {
  return new AppError("API_PROVIDER_UNAVAILABLE", message, 503, { browserFallback: getEnv().GOOGLE_BROWSER_FALLBACK_ENABLED });
}

function imageUrl(projectId: string, kind: "background" | "scene", sceneNumber: number) {
  return `/api/v1/projects/${projectId}/images?kind=${kind}&sceneNumber=${sceneNumber}&v=${Date.now()}`;
}

export async function generateProjectImagesWithGoogleApi(projectId: string, userId: string, channelId: string, slots: ImageSlot[], onProgress?: (detail: string, processed: number, total: number) => Promise<void> | void) {
  ensureApiFirst();
  if (!getEnv().GOOGLE_IMAGE_API_ENABLED) throw providerUnavailable("Google Image API đang tắt; có thể dùng Flow fallback.");
  if (!slots.length) throw new AppError("VALIDATION_ERROR", "Không có ảnh cần tạo.", 400);

  const project = await db.contentProject.findFirst({
    where: { id: projectId, channelId, channel: { userId } },
    include: { channel: true },
  });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
  let apiKey: string;
  try { apiKey = await requireProviderApiKey(userId, ["GEMINI"], "AI", "Gemini"); }
  catch { throw providerUnavailable("Chưa kết nối Gemini API; có thể dùng Flow fallback."); }
  const character = await readChannelMainCharacterImage(project.channel);
  const provider = new GeminiProvider(apiKey);
  const images: Record<string, string> = {};

  // Giữ nguyên thứ tự: background trước, sau đó từng start-frame một.
  for (const [index, slot] of slots.entries()) {
    const sceneNumber = slot.kind === "background" ? 0 : slot.sceneNumber;
    if (slot.kind === "scene" && (!Number.isInteger(sceneNumber) || (sceneNumber ?? 0) < 1)) throw new AppError("VALIDATION_ERROR", "Số cảnh không hợp lệ.", 400);
    const references: Array<{ mimeType: string; data: string }> = [];
    if (slot.kind === "scene") {
      if (!character) throw new AppError("CHANNEL_CHARACTER_IMAGE_MISSING", "Kênh chưa có ảnh nhân vật chính.", 409);
      const background = await readProjectImage(projectId, userId, "background", 0);
      references.push({ mimeType: character.mimeType, data: character.data }, { mimeType: background.mimeType, data: background.data.toString("base64") });
    }
    const result = await provider.generateImage(slot.prompt, slot.aspectRatio ?? "9:16", references);
    await writeProjectImage(projectId, slot.kind, sceneNumber ?? 0, Buffer.from(result.data, "base64"), result.mimeType);
    images[`${slot.kind}-${sceneNumber ?? 0}`] = imageUrl(projectId, slot.kind, sceneNumber ?? 0);
    await onProgress?.(`Đã tạo và lưu ${slot.kind === "background" ? "ảnh bối cảnh" : `ảnh bắt đầu cảnh ${sceneNumber}`}.`, index + 1, slots.length);
  }
  return { status: "completed", provider: "google-image-api", images };
}

export async function generateProjectVideosWithVeoApi(projectId: string, userId: string, channelId: string, slots: VideoSlot[], onProgress?: (detail: string, processed: number, total: number) => Promise<void> | void) {
  ensureApiFirst();
  if (!getEnv().VEO_API_ENABLED) throw providerUnavailable("Veo API đang tắt; có thể dùng Flow fallback.");
  if (!slots.length) throw new AppError("VALIDATION_ERROR", "Không có video cảnh cần tạo.", 400);
  const project = await db.contentProject.findFirst({ where: { id: projectId, channelId, channel: { userId } }, include: { scenes: true } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
  try { await requireProviderApiKey(userId, ["VEO", "GEMINI"], "VIDEO_GENERATION", "Veo/Google Video"); }
  catch { throw providerUnavailable("Chưa kết nối Veo/Google Video API; có thể dùng Flow fallback."); }
  const videos: Record<string, string> = {};

  // Mỗi operation được hoàn tất và tải về local trước khi khởi tạo cảnh kế tiếp.
  for (const [index, slot] of slots.entries()) {
    const scene = project.scenes.find((item) => item.sceneNumber === slot.sceneNumber);
    if (!scene) throw new AppError("SCENE_NOT_FOUND", `Không tìm thấy cảnh ${slot.sceneNumber}.`, 404);
    const image = await readProjectImage(projectId, userId, "scene", slot.sceneNumber);
    const firstFrame = { uri: `data:${image.mimeType};base64,${image.data.toString("base64")}`, mimeType: image.mimeType };
    const request: VeoRequest = {
      sceneId: scene.id,
      prompt: [
        `Create one 4-second ${slot.aspectRatio === "16:9" ? "16:9" : "vertical 9:16"} video from the attached start-frame image.`,
        `Use that image as the exact Start frame for scene ${slot.sceneNumber}.`,
        "Do not add an End frame, unrelated characters, props, actions, or story beats.",
        `Video prompt written by Gemini: ${slot.englishPrompt}`,
        `Action reference: ${slot.actionBlock}`,
        `Camera and visual direction reference: ${slot.visualBlock}`,
        `Audio and sound direction reference: ${slot.audioBlock}`,
        "Generate one final video with synchronized audio.",
      ].join("\n"),
      aspectRatio: slot.aspectRatio === "16:9" ? "16:9" : "9:16",
      resolution: "720p",
      duration: 4,
      firstFrame,
      audioEnabled: true,
    };
    const job = await createGenerationJob(scene.id, userId, request, { enqueue: false });
    const completed = await runGenerationJob(job.id, request, (status) => onProgress?.(`Cảnh ${slot.sceneNumber}: Veo ${status}.`, index, slots.length));
    if (completed.status !== "COMPLETED" || !completed.resultUrl) throw new AppError("VIDEO_GENERATION_FAILED", `Không tạo được video cảnh ${slot.sceneNumber}.`, 502);
    videos[`scene-${slot.sceneNumber}`] = `${completed.resultUrl}&v=${Date.now()}`;
    await onProgress?.(`Đã tạo và tải video cảnh ${slot.sceneNumber}.`, index + 1, slots.length);
  }
  return { status: "completed", provider: "veo-api", videos };
}

export async function enqueueProjectVideosWithVeoApi(projectId: string, userId: string, channelId: string, slots: VideoSlot[]) {
  ensureApiFirst();
  if (!getEnv().VEO_API_ENABLED) throw providerUnavailable("Veo API đang tắt; có thể dùng Flow fallback.");
  if (!slots.length) throw new AppError("VALIDATION_ERROR", "Không có video cảnh cần tạo.", 400);
  const project = await db.contentProject.findFirst({ where: { id: projectId, channelId, channel: { userId } }, select: { id: true } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
  try { await requireProviderApiKey(userId, ["VEO", "GEMINI"], "VIDEO_GENERATION", "Veo/Google Video"); }
  catch { throw providerUnavailable("Chưa kết nối Veo/Google Video API; có thể dùng Flow fallback."); }
  const batchId = randomUUID();
  const queued = await new LocalJobQueue().enqueue("video.project.generate", { batchId, projectId, userId, channelId, slots }, `video-project:${batchId}`);
  return { status: "queued", provider: "veo-api", queueJobId: queued.jobId, videos: {} };
}
