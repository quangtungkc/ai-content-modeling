import { db } from "@/lib/db";

export async function initializeSyncProgress(input: { syncId: string; userId: string; total: number; channels: number }) {
  await db.syncRun.create({ data: { id: input.syncId, userId: input.userId, total: input.total, remainingChannels: input.channels, status: input.total === 0 ? "succeeded" : "running", completedAt: input.total === 0 ? new Date() : null } });
}

export async function markCompetitorProcessed(syncId: string, failed = false) {
  await db.syncRun.update({ where: { id: syncId }, data: { processed: { increment: 1 }, ...(failed ? { failed: { increment: 1 } } : {}) } });
}

export async function markSyncChannelComplete(syncId: string) {
  const run = await db.syncRun.update({ where: { id: syncId }, data: { remainingChannels: { decrement: 1 } } });
  if (run.remainingChannels <= 0) await db.syncRun.update({ where: { id: syncId }, data: { status: "succeeded", completedAt: new Date() } });
}

export async function markSyncFailed(syncId: string, error: string) {
  await db.syncRun.update({ where: { id: syncId }, data: { status: "failed", error } });
}
