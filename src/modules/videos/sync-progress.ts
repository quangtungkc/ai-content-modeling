import type Redis from "ioredis";

const EXPIRY_SECONDS = 24 * 60 * 60;

export async function initializeSyncProgress(
  redis: Redis,
  input: { syncId: string; userId: string; total: number; channels: number },
) {
  await redis.hset(`sync:${input.syncId}`, {
    userId: input.userId,
    total: input.total,
    processed: 0,
    failed: 0,
    remainingChannels: input.channels,
    status: input.total === 0 ? "succeeded" : "running",
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  await redis.expire(`sync:${input.syncId}`, EXPIRY_SECONDS);
}

export async function markCompetitorProcessed(
  redis: Redis,
  syncId: string,
  failed = false,
) {
  const pipeline = redis.multi();
  pipeline.hincrby(`sync:${syncId}`, "processed", 1);
  if (failed) pipeline.hincrby(`sync:${syncId}`, "failed", 1);
  pipeline.hset(`sync:${syncId}`, "updatedAt", new Date().toISOString());
  pipeline.expire(`sync:${syncId}`, EXPIRY_SECONDS);
  await pipeline.exec();
}

export async function markSyncChannelComplete(redis: Redis, syncId: string) {
  const remaining = await redis.hincrby(`sync:${syncId}`, "remainingChannels", -1);
  if (remaining <= 0) {
    await redis.hset(`sync:${syncId}`, {
      status: "succeeded",
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

export async function markSyncFailed(redis: Redis, syncId: string, error: string) {
  await redis.hset(`sync:${syncId}`, {
    status: "failed",
    error,
    updatedAt: new Date().toISOString(),
  });
}
