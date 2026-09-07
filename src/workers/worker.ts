import Redis from "ioredis";
import { getRequiredRedisUrl } from "@/lib/env";
import { logger } from "@/lib/logger";
import { RedisJobQueue } from "@/lib/jobs/queue";
import { syncChannelVideos } from "@/modules/videos/sync-service";
import { runGenerationJob } from "@/modules/generation/job-service";
import type { VeoRequest } from "@/services/video-generation/types";
import { prepareDailyReport, publishDailyReport } from "@/modules/reports/service";

const redis = new Redis(getRequiredRedisUrl());
const queue = new RedisJobQueue(redis);

async function handleJob(name: string, payload: Record<string, unknown>) {
  if (name === "channel.sync") return syncChannelVideos(String(payload.channelId), redis);
  if (name === "video.generate") return runGenerationJob(String(payload.jobId), payload.request as VeoRequest);
  if (name === "daily.report.prepare") return prepareDailyReport(String(payload.channelId));
  if (name === "daily.report.publish") return publishDailyReport(String(payload.channelId));
  throw new Error(`Unknown job: ${name}`);
}

async function run() {
  logger.info("Background worker started");
  while (true) {
    const job = await queue.claim();
    if (!job) continue;
    try { await handleJob(job.name, job.payload); await queue.markSucceeded(job); logger.info("Job succeeded", { jobId: job.jobId, name: job.name }); }
    catch (error) { const message = error instanceof Error ? error.message : "Unknown job failure"; await queue.markFailed(job, message); logger.error("Job failed", { jobId: job.jobId, name: job.name, message, attempt: job.attempts + 1 }); }
  }
}

run().catch((error: unknown) => { logger.error("Worker stopped", { error: error instanceof Error ? error.message : "unknown" }); process.exitCode = 1; });
