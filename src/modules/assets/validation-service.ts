import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { AIService } from "@/services/ai/service";

export async function validateAsset(id: string, userId: string, ai?: AIService) {
  const asset = await db.asset.findFirst({ where: { id, project: { channel: { userId } } }, include: { project: true } });
  if (!asset) throw new AppError("ASSET_NOT_FOUND", "Không tìm thấy asset.", 404);
  const latest = await db.assetValidation.findFirst({ where: { assetId: id }, orderBy: { version: "desc" }, select: { version: true } });
  const aiService = ai ?? new AIService(undefined, { userId, channelId: asset.project.channelId, projectId: asset.projectId });
  const result = await aiService.validateAsset({ assetId: id, assetType: asset.type as "character" | "background" | "prop", assetUri: asset.storageKey, mimeType: asset.mimeType, expectedDesign: asset.type === "character" ? (asset.project.characterDesign as Record<string, unknown> ?? {}) : asset.type === "background" ? (asset.project.backgroundDesign as Record<string, unknown> ?? {}) : {}, projectContext: { projectId: asset.projectId } });
  return db.assetValidation.create({ data: { assetId: id, result: result.result, issues: { scores: result.scores, issues: result.issues } as Prisma.InputJsonValue, provider: "gemini", version: (latest?.version ?? 0) + 1 } });
}
