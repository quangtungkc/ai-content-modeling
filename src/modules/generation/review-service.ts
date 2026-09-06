import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

const score = (value: number | undefined) => value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value)));

async function ownedVersion(id: string, userId: string) {
  const version = await db.sceneGenerationVersion.findFirst({ where: { id, scene: { project: { channel: { userId } } } } });
  if (!version) throw new AppError("SCENE_VERSION_NOT_FOUND", "Không tìm thấy scene generation version.", 404);
  return version;
}

export async function listSceneVersions(sceneId: string, userId: string) {
  const scene = await db.storyboardScene.findFirst({ where: { id: sceneId, project: { channel: { userId } } }, select: { id: true } });
  if (!scene) throw new AppError("SCENE_NOT_FOUND", "Không tìm thấy scene.", 404);
  return db.sceneGenerationVersion.findMany({ where: { sceneId }, orderBy: { version: "desc" } });
}

export async function reviewSceneVersion(id: string, userId: string, input: { matchScore?: number; storyboardMatch?: number; characterMatch?: number; backgroundMatch?: number; actionMatch?: number; cameraMatch?: number; notes?: unknown }) {
  const version = await ownedVersion(id, userId);
  if (version.status === "GENERATING") throw new AppError("SCENE_NOT_READY", "Scene chưa hoàn tất để review.", 409);
  return db.sceneGenerationVersion.update({ where: { id }, data: { matchScore: score(input.matchScore), storyboardMatch: score(input.storyboardMatch), characterMatch: score(input.characterMatch), backgroundMatch: score(input.backgroundMatch), actionMatch: score(input.actionMatch), cameraMatch: score(input.cameraMatch), reviewNotes: input.notes as Prisma.InputJsonValue | undefined, reviewedAt: new Date() } });
}

export async function approveSceneVersion(id: string, userId: string) {
  const version = await ownedVersion(id, userId);
  if (version.status !== "READY") throw new AppError("SCENE_NOT_READY", "Chỉ có thể approve scene đã hoàn tất.", 409);
  return db.sceneGenerationVersion.update({ where: { id }, data: { status: "APPROVED", reviewedAt: new Date() } });
}
