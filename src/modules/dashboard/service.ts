import { db } from "@/lib/db";
import { calculateBaselineViews, calculateViralScore } from "@/modules/viral-score";

export async function getViralDashboard(userId: string, channelId?: string) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000);
  const channels = await db.channel.findMany({ where: { userId, status: "ACTIVE", ...(channelId ? { id: channelId } : {}) }, select: { id: true, name: true, timezone: true }, orderBy: { createdAt: "asc" } });
  const selectedChannel = channels[0];
  if (!selectedChannel) return { periodStart, periodEnd, channel: null, stats: { competitors: 0, newVideos: 0, viralVideos: 0 }, videos: [] };
  const competitors = await db.competitor.findMany({ where: { channelId: selectedChannel.id, status: "ACTIVE" }, select: { id: true, displayName: true, handle: true, platform: true } });
  const videos = await db.competitorVideo.findMany({ where: { competitorId: { in: competitors.map(({ id }) => id) }, publishedAt: { gte: periodStart, lte: periodEnd } }, include: { competitor: { select: { displayName: true, handle: true, platform: true } }, snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } }, orderBy: { publishedAt: "desc" } });
  const cards = await Promise.all(videos.map(async (video) => {
    const previous = await db.competitorVideo.findMany({ where: { competitorId: video.competitorId, publishedAt: { lt: video.publishedAt ?? periodEnd } }, include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } }, orderBy: { publishedAt: "desc" }, take: 20 });
    const baselineViews = calculateBaselineViews(previous.map((item) => item.snapshots[0]?.views ?? 0));
    const latest = video.snapshots[0];
    if (!latest || !video.publishedAt) return null;
    const score = calculateViralScore({ currentViews: latest.views, baselineViews, publishedAt: video.publishedAt, likes: latest.likes, comments: latest.comments, shares: latest.shares, now: periodEnd, snapshots: video.snapshots });
    return { id: video.id, url: video.url, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt, competitor: video.competitor, metrics: { views: latest.views, likes: latest.likes, comments: latest.comments, shares: latest.shares }, ...score };
  }));
  const validCards = cards.filter((card): card is NonNullable<typeof card> => card !== null).sort((a, b) => b.score - a.score);
  return { periodStart, periodEnd, channel: selectedChannel, stats: { competitors: competitors.length, newVideos: videos.length, viralVideos: validCards.filter((video) => video.score >= 80).length }, videos: validCards.slice(0, 20) };
}
