import type Redis from "ioredis";
import { syncChannelVideos } from "@/modules/videos/sync-service";
import { runGenerationJob } from "@/modules/generation/job-service";
import type { VeoRequest } from "@/services/video-generation/types";
import { prepareDailyReport, publishDailyReport } from "@/modules/reports/service";
import { markSyncChannelComplete, markSyncFailed } from "@/modules/videos/sync-progress";

export async function handleJob(name: string, payload: Record<string, unknown>, redis: Redis) {
  if (name === "channel.sync") {
    const syncId = typeof payload.syncId === "string" ? payload.syncId : undefined;
    try {
      const result = await syncChannelVideos(String(payload.channelId), redis, syncId);
      if (syncId) await markSyncChannelComplete(redis, syncId);
      return result;
    } catch (error) {
      if (syncId) await markSyncFailed(redis, syncId, error instanceof Error ? error.message : "Unknown sync failure");
      throw error;
    }
  }
  if (name === "video.generate") return runGenerationJob(String(payload.jobId), payload.request as VeoRequest);
  if (name === "daily.report.prepare") return prepareDailyReport(String(payload.channelId));
  if (name === "daily.report.publish") return publishDailyReport(String(payload.channelId));
  throw new Error(`Unknown job: ${name}`);
}
