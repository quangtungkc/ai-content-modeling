import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getCompetitorProvider } from "@/lib/platform";
import { RedisRateLimiter } from "@/lib/jobs/rate-limit";
import type Redis from "ioredis";
import { UsageMetric } from "@prisma/client";
import { recordUsage } from "@/modules/usage/service";
import { decryptSecret } from "@/lib/secrets";
import { markCompetitorProcessed } from "./sync-progress";

export async function syncChannelVideos(channelId: string, redis: Redis, syncId?: string) {
  const competitors = await db.competitor.findMany({ where: { channelId, status: "ACTIVE" }, include: { channel: { select: { userId: true } } } });
  const hasFacebook = competitors.some((competitor) => typeof competitor.platform === "string" && competitor.platform.toLowerCase() === "facebook");
  const facebookConnection = hasFacebook && competitors[0] ? await db.aIConnection.findUnique({ where: { userId_provider_kind: { userId: competitors[0].channel.userId, provider: "FACEBOOK", kind: "PLATFORM" } } }) : null;
  const facebookToken = facebookConnection && !facebookConnection.revokedAt ? decryptSecret(facebookConnection.encryptedKey) : undefined;
  const limiter = new RedisRateLimiter(redis);
  let syncedCompetitors = 0;
  let syncedVideos = 0;
  for (const competitor of competitors) {
    let failed = false;
    try {
      const provider = getCompetitorProvider(competitor.url, facebookToken);
      if (!(await limiter.take(provider.platform, 60, 60))) throw new Error(`Rate limit reached for ${provider.platform}`);
      const channel = await provider.resolveChannel(competitor.url);
      void recordUsage({ userId: competitor.channel.userId, channelId, metric: UsageMetric.COMPETITOR_REQUEST, idempotencyKey: `competitor:resolve:${competitor.id}:${Date.now()}` });
      const videos = await provider.getRecentVideos(channel);
      void recordUsage({ userId: competitor.channel.userId, channelId, metric: UsageMetric.COMPETITOR_REQUEST, quantity: 1, idempotencyKey: `competitor:recent:${competitor.id}:${Date.now()}` });
      const uniqueVideos = [...new Map(videos.map((video) => [video.externalId, video])).values()];
      for (const video of uniqueVideos) {
        const storedVideo = await db.competitorVideo.upsert({ where: { competitorId_externalId: { competitorId: competitor.id, externalId: video.externalId } }, create: { competitorId: competitor.id, externalId: video.externalId, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnail, publishedAt: video.publishedAt, duration: video.durationSec }, update: { url: video.url, caption: video.caption, thumbnailUrl: video.thumbnail, publishedAt: video.publishedAt, duration: video.durationSec } });
        const metrics = await provider.getVideoMetrics(video);
        void recordUsage({ userId: competitor.channel.userId, channelId, metric: UsageMetric.COMPETITOR_REQUEST, idempotencyKey: `competitor:metrics:${competitor.id}:${video.externalId}:${Date.now()}` });
        await db.videoMetricSnapshot.upsert({ where: { videoId_capturedAt: { videoId: storedVideo.id, capturedAt: metrics.capturedAt } }, create: { videoId: storedVideo.id, views: metrics.views, likes: metrics.likes, comments: metrics.comments, shares: metrics.shares ?? 0, capturedAt: metrics.capturedAt }, update: { views: metrics.views, likes: metrics.likes, comments: metrics.comments, shares: metrics.shares ?? 0 } });
        syncedVideos += 1;
      }
      await db.competitor.update({ where: { id: competitor.id }, data: { lastSyncedAt: new Date(), syncError: null } });
      syncedCompetitors += 1;
    } catch (error) {
      failed = true;
      const message = error instanceof Error ? error.message : "Unknown competitor sync failure";
      await db.competitor.update({ where: { id: competitor.id }, data: { syncError: message } });
      logger.error("Competitor sync failed", { channelId, competitorId: competitor.id, message });
    }
    if (syncId) await markCompetitorProcessed(redis, syncId, failed);
  }
  return { channelId, competitors: syncedCompetitors, videos: syncedVideos };
}
