import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getCompetitorProvider } from "@/lib/platform";
import { LocalRateLimiter } from "@/lib/jobs/rate-limit";
import { Prisma, UsageMetric } from "@prisma/client";
import { recordUsage } from "@/modules/usage/service";
import { decryptSecret } from "@/lib/secrets";
import { markCompetitorProcessed } from "./sync-progress";
import { reportRuntimeFailure } from "@/modules/codex-orchestrator/runtime-failure";
import { isRecentVideoPublishedAt } from "./recent-window";

export const MAX_RECENT_VIDEOS_PER_COMPETITOR = 10;

async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  async function consume() {
    while (true) {
      const index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => consume()));
  return results;
}

export async function syncChannelVideos(channelId: string, syncId?: string) {
  const competitors = await db.competitor.findMany({ where: { channelId, status: "ACTIVE" }, include: { channel: { select: { userId: true } } } });
  const hasFacebook = competitors.some((competitor) => typeof competitor.platform === "string" && competitor.platform.toLowerCase() === "facebook");
  const facebookConnection = hasFacebook && competitors[0] ? await db.aIConnection.findUnique({ where: { userId_provider_kind: { userId: competitors[0].channel.userId, provider: "FACEBOOK", kind: "PLATFORM" } } }) : null;
  const facebookToken = facebookConnection && !facebookConnection.revokedAt ? decryptSecret(facebookConnection.encryptedKey) : undefined;
  const limiter = new LocalRateLimiter();
  const results = await mapWithConcurrency(competitors, 4, async (competitor) => {
    let failed = false;
    let syncedVideos = 0;
    try {
      const provider = getCompetitorProvider(competitor.url, facebookToken);
      if (!(await limiter.take(provider.platform, 60, 60))) throw new Error(`Rate limit reached for ${provider.platform}`);
      const channel = await provider.resolveChannel(competitor.url);
      void recordUsage({ userId: competitor.channel.userId, channelId, metric: UsageMetric.COMPETITOR_REQUEST, idempotencyKey: `competitor:resolve:${competitor.id}:${Date.now()}` });
      const videos = await provider.getRecentVideos(channel);
      void recordUsage({ userId: competitor.channel.userId, channelId, metric: UsageMetric.COMPETITOR_REQUEST, quantity: 1, idempotencyKey: `competitor:recent:${competitor.id}:${Date.now()}` });
      const uniqueVideos = [...new Map(videos.map((video) => [video.externalId, video])).values()]
        .filter((video) => isRecentVideoPublishedAt(video.publishedAt))
        .sort((left, right) => right.publishedAt.getTime() - left.publishedAt.getTime())
        .slice(0, MAX_RECENT_VIDEOS_PER_COMPETITOR);
      const videoErrors: string[] = [];
      await mapWithConcurrency(uniqueVideos, 3, async (video) => {
        try {
          const storedVideo = await db.competitorVideo.upsert({ where: { competitorId_externalId: { competitorId: competitor.id, externalId: video.externalId } }, create: { competitorId: competitor.id, externalId: video.externalId, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnail, publishedAt: video.publishedAt, duration: video.durationSec }, update: { url: video.url, caption: video.caption, thumbnailUrl: video.thumbnail, publishedAt: video.publishedAt, duration: video.durationSec, lastSeenAt: new Date() } });
          const metrics = await provider.getVideoMetrics(video);
          void recordUsage({ userId: competitor.channel.userId, channelId, metric: UsageMetric.COMPETITOR_REQUEST, idempotencyKey: `competitor:metrics:${competitor.id}:${video.externalId}:${Date.now()}` });
          await db.videoMetricSnapshot.upsert({ where: { videoId_capturedAt: { videoId: storedVideo.id, capturedAt: metrics.capturedAt } }, create: { videoId: storedVideo.id, views: metrics.views, likes: metrics.likes, comments: metrics.comments, shares: metrics.shares ?? 0, rawMetrics: metrics.rawMetrics as Prisma.InputJsonValue, capturedAt: metrics.capturedAt }, update: { views: metrics.views, likes: metrics.likes, comments: metrics.comments, shares: metrics.shares ?? 0, rawMetrics: metrics.rawMetrics as Prisma.InputJsonValue } });
          syncedVideos += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Không đọc được metrics video.";
          videoErrors.push(`${video.externalId}: ${message}`);
          logger.warn("Competitor video metrics failed", { channelId, competitorId: competitor.id, videoId: video.externalId, message });
        }
      });
      const syncError = videoErrors.length ? `Đã quét ${uniqueVideos.length} video, đọc metrics thành công ${syncedVideos}; lỗi: ${videoErrors.slice(0, 3).join(" | ")}` : null;
      await db.competitor.update({ where: { id: competitor.id }, data: { lastSyncedAt: new Date(), syncError } });
      if (uniqueVideos.length > 0 && syncedVideos === 0) failed = true;
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "Unknown competitor sync failure";
      await db.competitor.update({ where: { id: competitor.id }, data: { syncError: message } });
      await reportRuntimeFailure({ userId: competitor.channel.userId, source: "competitor-sync", code: "COMPETITOR_SYNC_FAILED", error, context: { channelId, competitorId: competitor.id, syncId } });
      logger.error("Competitor sync failed", { channelId, competitorId: competitor.id, message });
    }
    if (syncId) await markCompetitorProcessed(syncId, failed);
    return { failed, videos: syncedVideos };
  });
  return { channelId, competitors: results.filter((result) => !result.failed).length, videos: results.reduce((total, result) => total + result.videos, 0) };
}
