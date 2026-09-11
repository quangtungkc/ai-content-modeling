import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { readProjectFinalVideo, readProjectVideo } from "@/modules/assets/image-generation-service";
import { db } from "@/lib/db";
import { enqueueBrowserFlowJob } from "@/modules/generation/browser-flow-bridge";

type Context = { params: Promise<{ id: string }> };
const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;

export async function GET(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const searchParams = new URL(request.url).searchParams;
    if (searchParams.get("status") === "1") {
      const queueJobId = searchParams.get("queueJobId");
      if (!queueJobId) throw new AppError("VALIDATION_ERROR", "Thiếu queueJobId.", 400);
      const queueJob = await db.backgroundJob.findUnique({ where: { id: queueJobId } });
      const payload = queueJob?.payload && typeof queueJob.payload === "object" ? queueJob.payload as Record<string, unknown> : null;
      if (!queueJob || payload?.projectId !== id || payload?.userId !== session.userId) throw new AppError("GENERATION_JOB_NOT_FOUND", "Không tìm thấy phiên tạo video.", 404);
      const scenes = await db.storyboardScene.findMany({ where: { projectId: id }, select: { sceneNumber: true }, orderBy: { sceneNumber: "asc" } });
      const videos: Record<string, string> = {};
      for (const scene of scenes) {
        try { await readProjectVideo(id, session.userId, scene.sceneNumber); videos[`scene-${scene.sceneNumber}`] = `/api/v1/projects/${id}/videos?sceneNumber=${scene.sceneNumber}`; } catch { /* Cảnh còn đang tạo. */ }
      }
      return Response.json({ data: { status: queueJob.status === "succeeded" ? "completed" : queueJob.status, provider: "flow-browser", queueJobId, videos, error: queueJob.error }, requestId });
    }
    const isDownload = searchParams.get("download") === "1";
    if (searchParams.get("final") === "1") {
      const video = await readProjectFinalVideo(id, session.userId);
      return new Response(video, { headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes", ...(isDownload ? { "Content-Disposition": "attachment; filename=\"video-modeling.mp4\"" } : {}) } });
    }
    const sceneNumber = Number(searchParams.get("sceneNumber"));
    if (!Number.isInteger(sceneNumber) || sceneNumber < 1) throw new AppError("VALIDATION_ERROR", "Số phân cảnh không hợp lệ.", 400);
    const video = await readProjectVideo(id, session.userId, sceneNumber);
    return new Response(video, { headers: { "Content-Type": "video/mp4", "Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes" } });
  } catch (error) {
    return toErrorResponse(normalize(error), requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const body = await request.json() as { channelId?: string; slots?: Array<{ sceneNumber?: number; label?: string; visualBlock?: string; actionBlock?: string; audioBlock?: string; englishPrompt?: string; aspectRatio?: string }> };
    if (!body.channelId || !Array.isArray(body.slots) || !body.slots.length) throw new AppError("VALIDATION_ERROR", "Thiếu channelId hoặc danh sách video.", 400);
    const slots = body.slots.map((slot) => ({ sceneNumber: slot.sceneNumber, label: slot.label, visualBlock: slot.visualBlock, actionBlock: slot.actionBlock, audioBlock: slot.audioBlock, englishPrompt: slot.englishPrompt, aspectRatio: slot.aspectRatio })).filter((slot) => Number.isInteger(slot.sceneNumber) && (slot.sceneNumber ?? 0) > 0 && typeof slot.visualBlock === "string" && typeof slot.actionBlock === "string" && typeof slot.audioBlock === "string" && typeof slot.englishPrompt === "string" && slot.englishPrompt.trim()) as Array<{ sceneNumber: number; label?: string; visualBlock: string; actionBlock: string; audioBlock: string; englishPrompt: string; aspectRatio?: string }>;
    if (slots.length !== body.slots.length) throw new AppError("VALIDATION_ERROR", "Dữ liệu video không hợp lệ.", 400);
    const queued = await enqueueBrowserFlowJob("desktop.flow.videos", { userId: session.userId, projectId: id, channelId: body.channelId, slots, requestKey: `desktop-flow-videos:${id}:${randomUUID()}` });
    return Response.json({ data: { ...queued, status: "queued", provider: "flow-browser", queueJobId: queued.jobId, videos: {} }, requestId }, { status: 202 });
  } catch (error) {
    return toErrorResponse(normalize(error), requestId);
  }
}
