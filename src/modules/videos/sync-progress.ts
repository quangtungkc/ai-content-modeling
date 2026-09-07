import { db } from "@/lib/db";

export async function initializeSyncProgress(input: { syncId: string; userId: string; total: number; channels: number }) {
  await db.syncRun.create({ data: { id: input.syncId, userId: input.userId, total: input.total, remainingChannels: input.channels, status: input.total === 0 ? "succeeded" : "running", completedAt: input.total === 0 ? new Date() : null } });
}

export async function markCompetitorProcessed(syncId: string, failed = false) {
  await db.syncRun.update({ where: { id: syncId }, data: { processed: { increment: 1 }, ...(failed ? { failed: { increment: 1 } } : {}) } });
}

export async function markSyncChannelComplete(syncId: string) {
  const run = await db.syncRun.update({ where: { id: syncId }, data: { remainingChannels: { decrement: 1 } } });
  if (run.remainingChannels <= 0) {
    const allFailed = run.total > 0 && run.failed >= run.total;
    await db.syncRun.update({
      where: { id: syncId },
      data: {
        status: allFailed ? "failed" : "succeeded",
        error: allFailed ? "Không lấy được dữ liệu từ bất kỳ đối thủ nào. Kiểm tra kết nối Facebook và Page Access Token." : null,
        completedAt: new Date(),
      },
    });
  }
}

export async function markSyncFailed(syncId: string, error: string) {
  await db.syncRun.update({ where: { id: syncId }, data: { status: "failed", error } });
}
