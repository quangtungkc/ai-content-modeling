import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { calculateBaselineViews, calculateViralScore } from "@/modules/viral-score";
import { getLocalClock } from "./time";
import { AIService } from "@/services/ai/service";

export async function prepareDailyReport(channelId: string, now = new Date(), ai?: AIService) {
  const periodStart = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const channel = await db.channel.findFirst({
    where: { id: channelId, status: "ACTIVE" },
    include: {
      competitors: {
        where: { status: "ACTIVE" },
        include: {
          videos: {
            where: { publishedAt: { gte: periodStart, lte: now } },
            include: {
              snapshots: { orderBy: { capturedAt: "desc" }, take: 1 },
            },
          },
        },
      },
    },
  });
  if (!channel) throw new Error("CHANNEL_NOT_FOUND");
  const aiService = ai ?? new AIService(undefined, { userId: channel.userId, channelId });
  const local = getLocalClock(channel.timezone, now);
  const localDate = new Date(`${local.date}T00:00:00.000Z`);
  const report = await db.dailyReport.upsert({ where: { channelId_localDate: { channelId, localDate } }, create: { channelId, localDate, periodStart, periodEnd: now, timezone: channel.timezone, status: "PREPARING" }, update: { periodEnd: now, status: "PREPARING" } });
  await db.reportItem.deleteMany({ where: { reportId: report.id } });
  const candidates = channel.competitors.flatMap((competitor) => competitor.videos.map((video) => ({ competitor, video, latest: video.snapshots[0] }))).filter((item) => item.latest && item.video.publishedAt);
  const scored = await Promise.all(candidates.map(async ({ competitor, video, latest }) => {
    const previous = await db.competitorVideo.findMany({ where: { competitorId: competitor.id, publishedAt: { lt: video.publishedAt! } }, include: { snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } }, take: 20, orderBy: { publishedAt: "desc" } });
    const baselineViews = calculateBaselineViews(previous.map((item) => item.snapshots[0]?.views ?? 0));
    return { video, latest: latest!, score: calculateViralScore({ currentViews: latest!.views, baselineViews, publishedAt: video.publishedAt!, likes: latest!.likes, comments: latest!.comments, shares: latest!.shares, now }) };
  }));
  const viral = scored.filter((item) => item.score.score >= 80).sort((a, b) => b.score.score - a.score.score);
  await db.reportItem.createMany({ data: viral.map((item, index) => ({ reportId: report.id, sourceVideoId: item.video.id, viralScore: item.score.score, relativePerformance: item.score.relativePerformance, analysisSummary: `${item.score.relativePerformance.toFixed(2)}× baseline; ${item.score.confidence} confidence`, modelingMechanism: "Analysis queued", rank: index + 1 })) });
  for (const item of viral) {
    try {
      const analysis = await aiService.analyzeVideo({ channelDNA: { name: channel.name, topic: channel.topic, subTopic: channel.subTopic, targetCountry: channel.targetCountry, language: channel.language, audience: channel.audience, contentStyle: channel.contentStyle, visualStyle: channel.visualStyle, videoDuration: channel.videoDurationSec, hasDialogue: channel.hasDialogue, creativeInstructions: channel.creativeInstructions, hashtags: channel.hashtags, mainCharacterImageAvailable: Boolean(channel.mainCharacterImageKey), mainCharacterImageName: channel.mainCharacterImageName, timezone: channel.timezone }, video: { id: item.video.id, url: item.video.url, caption: item.video.caption, thumbnailUrl: item.video.thumbnailUrl, publishedAt: item.video.publishedAt?.toISOString(), duration: item.video.duration } });
      const latestAnalysis = await db.sourceAnalysis.findFirst({ where: { sourceVideoId: item.video.id }, orderBy: { version: "desc" }, select: { version: true } });
      const storedAnalysis = await db.sourceAnalysis.create({ data: { sourceVideoId: item.video.id, version: (latestAnalysis?.version ?? 0) + 1, provider: aiService.providerName, schemaVersion: analysis.schemaVersion, content: analysis as unknown as Prisma.InputJsonValue } });
      const ideas = await aiService.generateIdeas({ channelDNA: { name: channel.name, topic: channel.topic, subTopic: channel.subTopic, targetCountry: channel.targetCountry, language: channel.language, audience: channel.audience, contentStyle: channel.contentStyle, visualStyle: channel.visualStyle, videoDuration: channel.videoDurationSec, hasDialogue: channel.hasDialogue, creativeInstructions: channel.creativeInstructions, hashtags: channel.hashtags, mainCharacterImageAvailable: Boolean(channel.mainCharacterImageKey), mainCharacterImageName: channel.mainCharacterImageName, timezone: channel.timezone }, video: { id: item.video.id, url: item.video.url, caption: item.video.caption, thumbnailUrl: item.video.thumbnailUrl, publishedAt: item.video.publishedAt?.toISOString(), duration: item.video.duration }, analysis });
      await db.modelingIdea.createMany({ data: ideas.modelingDirections.map((idea) => ({ sourceVideoId: item.video.id, analysisId: storedAnalysis.id, title: idea.title, content: idea as unknown as Prisma.InputJsonValue, status: "DRAFT" })) });
      await db.reportItem.update({ where: { reportId_sourceVideoId: { reportId: report.id, sourceVideoId: item.video.id } }, data: { analysisSummary: analysis.summary, modelingMechanism: ideas.modelingDirections[0]?.sourceMechanism ?? "Analyzed" } });
    } catch (error) {
      await db.reportItem.update({ where: { reportId_sourceVideoId: { reportId: report.id, sourceVideoId: item.video.id } }, data: { analysisSummary: `Analysis failed: ${error instanceof Error ? error.message : "unknown error"}` } });
    }
  }
  return db.dailyReport.update({ where: { id: report.id }, data: { status: "READY", generatedAt: new Date() }, include: { items: true } });
}

export async function publishDailyReport(channelId: string, now = new Date()) {
  const report = await db.dailyReport.findFirst({ where: { channelId, localDate: { lte: new Date(`${getLocalClock((await db.channel.findUniqueOrThrow({ where: { id: channelId }, select: { timezone: true } })).timezone, now).date}T00:00:00.000Z`) } }, orderBy: { localDate: "desc" } });
  if (!report || report.status === "PUBLISHED") return report;
  const published = await db.dailyReport.update({ where: { id: report.id }, data: { status: "PUBLISHED", publishedAt: now } });
  const channel = await db.channel.findUniqueOrThrow({ where: { id: channelId }, select: { userId: true, name: true } });
  await db.inAppNotification.create({ data: { userId: channel.userId, channelId, reportId: report.id, type: "DAILY_VIRAL_REPORT", title: `Daily Viral Report — ${channel.name}`, message: "Bản tin viral 24 giờ đã sẵn sàng." } });
  return published;
}
