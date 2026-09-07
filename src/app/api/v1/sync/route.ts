import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getRequiredSession } from "@/lib/auth/provider";
import { getRequiredRedisUrl } from "@/lib/env";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { RedisJobQueue } from "@/lib/jobs/queue";

export async function POST(request: Request) {
  const requestId = randomUUID();
  let redis: Redis | undefined;
  try {
    const session = await getRequiredSession();
    const body = await request.json().catch(() => ({})) as { channelId?: string };
    const channels = await db.channel.findMany({ where: { userId: session.userId, status: "ACTIVE", ...(body.channelId ? { id: body.channelId } : {}) }, select: { id: true } });
    if (body.channelId && !channels.length) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404);
    redis = new Redis(getRequiredRedisUrl());
    const queue = new RedisJobQueue(redis);
    const jobs = await Promise.all(channels.map((channel) => queue.enqueue("channel.sync", { channelId: channel.id }, `manual-channel-sync:${channel.id}:${new Date().toISOString().slice(0, 13)}`)));
    return Response.json({ data: { channels: channels.length, jobs: jobs.length, message: "Đã đưa yêu cầu đồng bộ vào hàng đợi." }, requestId }, { status: 202 });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  } finally {
    await redis?.quit();
  }
}
