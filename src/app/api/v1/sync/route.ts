import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { ZodError } from "zod";
import { initializeSyncProgress } from "@/modules/videos/sync-progress";

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const body = await request.json().catch(() => ({})) as { channelId?: string };
    const channels = await db.channel.findMany({ where: { userId: session.userId, status: "ACTIVE", ...(body.channelId ? { id: body.channelId } : {}) }, select: { id: true, platform: true } });
    if (body.channelId && !channels.length) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404);
    const needsFacebook = channels.some((channel) => channel.platform.toLowerCase() === "facebook");
    if (needsFacebook) {
      const facebookConnection = await db.aIConnection.findUnique({
        where: { userId_provider_kind: { userId: session.userId, provider: "FACEBOOK", kind: "PLATFORM" } },
        select: { revokedAt: true },
      });
      if (!facebookConnection || facebookConnection.revokedAt) {
        throw new AppError(
          "FACEBOOK_CONNECTION_REQUIRED",
          "Chưa có Facebook Page Access Token. Vào Cài đặt AI → Facebook, dán token và bấm Lưu kết nối.",
          409,
        );
      }
    }
    const total = await db.competitor.count({ where: { channelId: { in: channels.map((channel) => channel.id) }, status: "ACTIVE" } });
    const syncId = randomUUID();
    const queue = new LocalJobQueue();
    await initializeSyncProgress({ syncId, userId: session.userId, total, channels: channels.length });
    const jobs = await Promise.all(channels.map((channel) => queue.enqueue("channel.sync", { channelId: channel.id, syncId }, `manual-channel-sync:${channel.id}:${syncId}`)));
    return Response.json({ data: { syncId, channels: channels.length, total, jobs: jobs.length, message: "Đã đưa yêu cầu đồng bộ vào hàng đợi." }, requestId }, { status: 202 });
  } catch (error) {
    console.error("Manual sync failed", error instanceof ZodError ? error.issues.map((issue) => issue.path.join(".")).join(",") : error instanceof Error ? error.message : "unknown");
    const message = error instanceof ZodError ? "Cấu hình đồng bộ chưa đầy đủ." : null;
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
      ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
      : message
        ? new AppError("SYNC_UNAVAILABLE", message, 503)
        : error;
    return toErrorResponse(normalized, requestId);
  }
}
