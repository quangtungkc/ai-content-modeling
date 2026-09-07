import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { LocalJobQueue } from "@/lib/jobs/queue";

const queue = new LocalJobQueue();
const intervalMs = 2 * 60 * 60 * 1000;

async function enqueueChannelSyncs() {
  const channels = await db.channel.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  for (const channel of channels) await queue.enqueue("channel.sync", { channelId: channel.id }, `channel-sync:${channel.id}:${new Date().toISOString().slice(0, 13)}`);
  logger.info("Channel sync jobs enqueued", { count: channels.length });
}

enqueueChannelSyncs().catch((error: unknown) => logger.error("Scheduler run failed", { error: error instanceof Error ? error.message : "unknown" }));
setInterval(() => { void enqueueChannelSyncs(); }, intervalMs);
logger.info("Scheduler started", { intervalHours: 2 });
