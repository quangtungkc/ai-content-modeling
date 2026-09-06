import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { GeminiProvider } from "@/services/ai/gemini";
import { AIService } from "@/services/ai/service";

async function getOwnedProject(id: string, userId: string) {
  const project = await db.contentProject.findFirst({ where: { id, channel: { userId } }, include: { scenes: true, idea: { include: { analysis: true } } } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
  return project;
}

export async function createGeminiReview(projectId: string, userId: string) {
  const project = await getOwnedProject(projectId, userId);
  const latest = await db.projectReview.findFirst({ where: { projectId }, orderBy: { version: "desc" } });
  const version = (latest?.version ?? 0) + 1;
  const result = await new AIService(new GeminiProvider(), { userId, channelId: project.channelId, projectId }).reviewProject({ projectId, draftPackage: { deconstruction: project.deconstruction, artDirection: project.artDirection, characterDesign: project.characterDesign, backgroundDesign: project.backgroundDesign, storyboard: project.storyboard, safetyReview: project.safetyReview, productionPrompts: project.productionPrompts }, scenes: project.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, visualBlock: scene.visualBlock, actionBlock: scene.actionBlock, audioBlock: scene.audioBlock, englishPrompt: scene.englishPrompt })) });
  return db.projectReview.create({ data: { projectId, version, provider: "gemini", issues: result.issues as Prisma.InputJsonValue, originalSnapshot: { deconstruction: project.deconstruction, artDirection: project.artDirection, characterDesign: project.characterDesign, backgroundDesign: project.backgroundDesign, storyboard: project.storyboard, safetyReview: project.safetyReview, productionPrompts: project.productionPrompts } as Prisma.InputJsonValue } });
}

export async function decideReview(reviewId: string, userId: string, status: "APPLIED" | "IGNORED", issueIds?: string[], note?: string) {
  const review = await db.projectReview.findFirst({ where: { id: reviewId, project: { channel: { userId } } } });
  if (!review) throw new AppError("REVIEW_NOT_FOUND", "Không tìm thấy Gemini review.", 404);
  return db.projectReview.update({ where: { id: reviewId }, data: { status, selectedIssueIds: issueIds ? issueIds : Prisma.JsonNull, decisionNote: note } });
}
