import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { createHash } from "node:crypto";
import { manualCompetitorVideoSchema, metricSnapshotSchema } from "./schema";

async function assertVideoOwner(videoId: string, userId: string) {
  const video = await db.competitorVideo.findFirst({ where: { id: videoId, competitor: { channel: { userId } } }, select: { id: true } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy competitor video.", 404);
}

export async function listVideoMetricSnapshots(videoId: string, userId: string) {
  await assertVideoOwner(videoId, userId);
  return db.videoMetricSnapshot.findMany({ where: { videoId }, orderBy: { capturedAt: "asc" } });
}

export async function recordVideoMetricSnapshot(videoId: string, userId: string, input: unknown) {
  await assertVideoOwner(videoId, userId);
  const data = metricSnapshotSchema.parse(input);
  return db.videoMetricSnapshot.upsert({ where: { videoId_capturedAt: { videoId, capturedAt: data.capturedAt } }, create: { videoId, ...data }, update: { views: data.views, likes: data.likes, comments: data.comments, shares: data.shares } });
}

export async function saveManualCompetitorVideo(competitorId: string, userId: string, input: unknown) {
  const competitor = await db.competitor.findFirst({ where: { id: competitorId, status: "ACTIVE", channel: { userId } }, select: { id: true } });
  if (!competitor) throw new AppError("COMPETITOR_NOT_FOUND", "Không tìm thấy đối thủ đang hoạt động.", 404);

  const data = manualCompetitorVideoSchema.parse(input);
  const externalId = `manual:${createHash("sha256").update(data.url).digest("hex")}`;
  const video = await db.competitorVideo.upsert({
    where: { competitorId_externalId: { competitorId, externalId } },
    create: { competitorId, externalId, url: data.url, caption: data.caption || null, publishedAt: data.publishedAt },
    update: { url: data.url, caption: data.caption || null, publishedAt: data.publishedAt, lastSeenAt: new Date() },
  });
  return db.videoMetricSnapshot.create({
    data: { videoId: video.id, capturedAt: new Date(), views: data.views, likes: data.likes, comments: data.comments, shares: data.shares, rawMetrics: { source: "manual" } },
  });
}
