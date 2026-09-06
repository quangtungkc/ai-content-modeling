import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { assetInputSchema, assetStatusSchema } from "./schema";

async function getOwnedProject(projectId: string, userId: string) {
  const project = await db.contentProject.findFirst({ where: { id: projectId, channel: { userId } }, select: { id: true } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
}

export async function listProjectAssets(projectId: string, userId: string) {
  await getOwnedProject(projectId, userId);
  return db.asset.findMany({ where: { projectId }, include: { validations: { orderBy: { version: "desc" }, take: 1 }, scenes: { select: { sceneId: true } } }, orderBy: [{ type: "asc" }, { name: "asc" }, { version: "desc" }] });
}

export async function registerAsset(projectId: string, userId: string, input: unknown) {
  await getOwnedProject(projectId, userId);
  const data = assetInputSchema.parse(input);
  const latest = await db.asset.findFirst({ where: { projectId, name: data.name }, orderBy: { version: "desc" }, select: { version: true } });
  const version = (latest?.version ?? 0) + 1;
  const asset = await db.asset.create({ data: { ...data, projectId, version, metadata: data.metadata as Prisma.InputJsonValue | undefined } });
  for (const sceneId of data.sceneIds) await db.sceneAsset.create({ data: { sceneId, assetId: asset.id } });
  return asset;
}

export async function updateAssetStatus(id: string, userId: string, input: unknown) {
  const { status } = assetStatusSchema.parse(input);
  const asset = await db.asset.findFirst({ where: { id, project: { channel: { userId } } } });
  if (!asset) throw new AppError("ASSET_NOT_FOUND", "Không tìm thấy asset.", 404);
  return db.asset.update({ where: { id }, data: { status } });
}
