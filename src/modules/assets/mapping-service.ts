import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { sceneAssetMappingSchema } from "./mapping-schema";

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

async function getOwnedScene(sceneId: string, userId: string) {
  const scene = await db.storyboardScene.findFirst({ where: { id: sceneId, project: { channel: { userId } } }, select: { id: true, projectId: true } });
  if (!scene) throw new AppError("SCENE_NOT_FOUND", "Không tìm thấy storyboard scene.", 404);
  return scene;
}

export async function getSceneAssets(sceneId: string, userId: string) {
  await getOwnedScene(sceneId, userId);
  return db.sceneAsset.findMany({ where: { sceneId }, include: { asset: { include: { validations: { orderBy: { version: "desc" }, take: 1 } } } }, orderBy: { asset: { name: "asc" } } });
}

export async function replaceSceneAssets(sceneId: string, userId: string, input: unknown) {
  const scene = await getOwnedScene(sceneId, userId);
  const { assetIds } = sceneAssetMappingSchema.parse(input);
  const uniqueAssetIds = [...new Set(assetIds)];
  const assets = await db.asset.findMany({ where: { id: { in: uniqueAssetIds }, projectId: scene.projectId }, select: { id: true, sceneIds: true } });
  if (assets.length !== uniqueAssetIds.length) throw new AppError("INVALID_ASSET_MAPPING", "Tất cả asset phải thuộc cùng content project với scene.", 400);
  return db.$transaction(async (transaction) => {
    await transaction.sceneAsset.deleteMany({ where: { sceneId } });
    if (uniqueAssetIds.length) await transaction.sceneAsset.createMany({ data: uniqueAssetIds.map((assetId) => ({ sceneId, assetId })) });
    const projectAssets = await transaction.asset.findMany({ where: { projectId: scene.projectId }, select: { id: true, sceneIds: true } });
    for (const asset of projectAssets) {
      const currentSceneIds = stringArray(asset.sceneIds);
      const nextSceneIds = uniqueAssetIds.includes(asset.id) ? [...new Set([...currentSceneIds, sceneId])] : currentSceneIds.filter((id) => id !== sceneId);
      await transaction.asset.update({ where: { id: asset.id }, data: { sceneIds: nextSceneIds } });
    }
    return transaction.sceneAsset.findMany({ where: { sceneId }, include: { asset: true }, orderBy: { asset: { name: "asc" } } });
  });
}
