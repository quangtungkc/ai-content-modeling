import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { readProjectFinalVideo, readProjectVideo } from "@/modules/assets/image-generation-service";

type Context = { params: Promise<{ id: string }> };
const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;

export async function GET(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const searchParams = new URL(request.url).searchParams;
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
