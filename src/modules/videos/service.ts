import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { metricSnapshotSchema } from "./schema";

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
