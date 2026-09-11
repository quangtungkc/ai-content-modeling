import { syncChannelVideos } from "@/modules/videos/sync-service";
import { runGenerationJob } from "@/modules/generation/job-service";
import { generateProjectVideosWithVeoApi } from "@/modules/generation/google-api-pipeline";
import type { VeoRequest } from "@/services/video-generation/types";
import { prepareDailyReport, publishDailyReport } from "@/modules/reports/service";
import { markSyncChannelComplete, markSyncFailed } from "@/modules/videos/sync-progress";
import { executeCodexJob } from "@/modules/codex-orchestrator/executor";
import { dispatchRuntimeFailure } from "@/modules/codex-orchestrator/runtime-failure";

export async function handleJob(name: string, payload: Record<string, unknown>) {
  if (name === "channel.sync") {
    const syncId = typeof payload.syncId === "string" ? payload.syncId : undefined;
    try {
      const result = await syncChannelVideos(String(payload.channelId), syncId);
      if (syncId) await markSyncChannelComplete(syncId);
      return result;
    } catch (error) {
      if (syncId) await markSyncFailed(syncId, error instanceof Error ? error.message : "Unknown sync failure");
      throw error;
    }
  }
  if (name === "video.generate") return runGenerationJob(String(payload.jobId), payload.request as VeoRequest);
  if (name === "video.project.generate") return generateProjectVideosWithVeoApi(String(payload.projectId), String(payload.userId), String(payload.channelId), payload.slots as Parameters<typeof generateProjectVideosWithVeoApi>[3]);
  if (name === "codex.job.execute") return executeCodexJob(String(payload.jobId), String(payload.userId));
  if (name === "codex.runtime.failure") return dispatchRuntimeFailure(String(payload.runtimeFailureId));
  if (name === "daily.report.prepare") return prepareDailyReport(String(payload.channelId));
  if (name === "daily.report.publish") return publishDailyReport(String(payload.channelId));
  throw new Error(`Unknown job: ${name}`);
}
