import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getRequiredSession } from "@/lib/auth/provider";
import { getRequiredRedisUrl } from "@/lib/env";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { RedisJobQueue } from "@/lib/jobs/queue";
import { ZodError } from "zod";
import { initializeSyncProgress } from "@/modules/videos/sync-progress";

export async function POST(request: Request) {
  const requestId = randomUUID();
  let redis: Redis | undefined;
  try {
    const session = await getRequiredSession();
    const body = await request.json().catch(() => ({})) as { channelId?: string };
    const channels = await db.channel.findMany({ where: { userId: session.userId, status: "ACTIVE", ...(body.channelId ? { id: body.channelId } : {}) }, select: { id: true } });
    if (body.channelId && !channels.length) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404);
    const total = await db.competitor.count({ where: { channelId: { in: channels.map((channel) => channel.id) }, status: "ACTIVE" } });
    const syncId = randomUUID();
    redis = new Redis(getRequiredRedisUrl());
    const queue = new RedisJobQueue(redis);
    await initializeSyncProgress(redis, { syncId, userId: session.userId, total, channels: channels.length });
    const jobs = await Promise.all(channels.map((channel) => queue.enqueue("channel.sync", { channelId: channel.id, syncId }, `manual-channel-sync:${channel.id}:${syncId}`)));
    return Response.json({ data: { syncId, channels: channels.length, total, jobs: jobs.length, message: "Đã đưa yêu cầu đồng bộ vào hàng đợi." }, requestId }, { status: 202 });
  } catch (error) {
    console.error("Manual sync failed", error instanceof ZodError ? error.issues.map((issue) => issue.path.join(".")).join(",") : error instanceof Error ? error.message : "unknown");
    const message = error instanceof Error && error.message === "REDIS_URL chưa được cấu hình cho worker nền."
      ? "Chưa cấu hình máy chủ hàng đợi đồng bộ (REDIS_URL)."
      : error instanceof Error && /redis|connect|timeout/i.test(error.message)
        ? "Không kết nối được máy chủ hàng đợi đồng bộ."
        : error instanceof ZodError
          ? "Cấu hình máy chủ đồng bộ chưa đầy đủ."
          : null;
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
      ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
      : message
        ? new AppError("SYNC_UNAVAILABLE", message, 503)
        : error;
    return toErrorResponse(normalized, requestId);
  } finally {
    await redis?.quit();
  }
}
