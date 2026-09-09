import { db } from "@/lib/db";
import { hasProjectFinalVideo } from "@/modules/assets/image-generation-service";
import { calculateBaselineViews, calculateViralScore } from "@/modules/viral-score";

export async function getViralDashboard(userId: string, channelId?: string, periodHours = 24) {
  const periodEnd = new Date();
  const safePeriodHours = [24, 72, 168].includes(periodHours) ? periodHours : 24;
  const periodStart = new Date(periodEnd.getTime() - safePeriodHours * 60 * 60 * 1000);
  const channels = await db.channel.findMany({ where: { userId, status: "ACTIVE", ...(channelId ? { id: channelId } : {}) }, select: { id: true, name: true, timezone: true }, orderBy: { createdAt: "asc" } });
  const selectedChannel = channels[0];
  if (!selectedChannel) return { periodStart, periodEnd, channel: null, stats: { competitors: 0, newVideos: 0, viralVideos: 0 }, videos: [] };
  const competitors = await db.competitor.findMany({ where: { channelId: selectedChannel.id, status: "ACTIVE" }, select: { id: true, displayName: true, handle: true, platform: true } });
  const videos = await db.competitorVideo.findMany({ where: { competitorId: { in: competitors.map(({ id }) => id) }, publishedAt: { gte: periodStart, lte: periodEnd } }, include: { competitor: { select: { displayName: true, handle: true, platform: true } }, snapshots: { orderBy: { capturedAt: "desc" }, take: 1 }, analyses: { orderBy: { version: "desc" }, take: 1, select: { createdAt: true, content: true } } }, orderBy: { publishedAt: "desc" } });
  const modelingProjects = videos.length
    ? await db.contentProject.findMany({ where: { channelId: selectedChannel.id, idea: { sourceVideoId: { in: videos.map(({ id }) => id) } } }, select: { id: true, updatedAt: true, idea: { select: { sourceVideoId: true } } }, orderBy: { updatedAt: "desc" } })
    : [];
  const completedModelingVideos = new Map<string, string>();
  for (const project of modelingProjects) {
    if (completedModelingVideos.has(project.idea.sourceVideoId)) continue;
    if (await hasProjectFinalVideo(project.id)) completedModelingVideos.set(project.idea.sourceVideoId, project.id);
  }
  const cards = await Promise.all(videos.map(async (video) => {
    const previous = await db.competitorVideo.findMany({ where: { competitorId: video.competitorId, publishedAt: { lt: video.publishedAt ?? periodEnd } }, include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } }, orderBy: { publishedAt: "desc" }, take: 20 });
    const baselineViews = calculateBaselineViews(previous.map((item) => item.snapshots[0]?.views ?? 0));
    const latest = video.snapshots[0];
    if (!latest || !video.publishedAt) return null;
    const score = calculateViralScore({ currentViews: latest.views, baselineViews, publishedAt: video.publishedAt, likes: latest.likes, comments: latest.comments, shares: latest.shares, now: periodEnd, snapshots: video.snapshots });
    const modelingProjectId = completedModelingVideos.get(video.id);
    return { id: video.id, url: video.url, modelingVideoUrl: modelingProjectId ? `/api/v1/projects/${modelingProjectId}/videos?final=1` : null, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt, competitor: video.competitor, analysis: video.analyses[0] ? { createdAt: video.analyses[0].createdAt, content: video.analyses[0].content } : null, metrics: { views: latest.views, likes: latest.likes, comments: latest.comments, shares: latest.shares }, ...score };
  }));
  const validCards = cards.filter((card): card is NonNullable<typeof card> => card !== null).sort((a, b) => b.score - a.score);
  return { periodStart, periodEnd, channel: selectedChannel, stats: { competitors: competitors.length, newVideos: videos.length, viralVideos: validCards.filter((video) => video.score >= 80).length }, videos: validCards };
}

export async function deleteVideosForChannel(channelId: string, userId: string) {
  const channel = await db.channel.findFirst({ where: { id: channelId, userId, status: "ACTIVE" }, select: { id: true } });
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  const videos = await db.competitorVideo.findMany({
    where: { competitor: { channelId } },
    select: { id: true },
  });
  const ids = videos.map(({ id }) => id);
  if (!ids.length) return;
  await db.$transaction([
    db.modelingIdea.deleteMany({ where: { sourceVideoId: { in: ids } } }),
    db.sourceAnalysis.deleteMany({ where: { sourceVideoId: { in: ids } } }),
    db.reportItem.deleteMany({ where: { sourceVideoId: { in: ids } } }),
    db.videoMetricSnapshot.deleteMany({ where: { videoId: { in: ids } } }),
    db.competitorVideo.deleteMany({ where: { id: { in: ids } } }),
  ]);
  return { deleted: ids.length };
}
