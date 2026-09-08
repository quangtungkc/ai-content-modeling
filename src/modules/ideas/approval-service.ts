import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { AIService } from "@/services/ai/service";
import { videoAnalysisSchema, modelingIdeasSchema } from "@/services/ai/schemas";
import type { ModelingDirection } from "@/services/ai/types";
import { decryptSecret } from "@/lib/secrets";
import { GeminiProvider } from "@/services/ai/gemini";
import { OpenAIProvider } from "@/services/ai/openai";

async function getOwnedIdea(id: string, userId: string) {
  const idea = await db.modelingIdea.findFirst({ where: { id, analysis: { sourceVideo: { competitor: { channel: { userId } } } } }, include: { analysis: true } });
  if (!idea) throw new AppError("IDEA_NOT_FOUND", "Không tìm thấy modeling idea.", 404);
  return idea;
}

export async function setIdeaStatus(id: string, userId: string, status: "APPROVED" | "REJECTED") {
  await getOwnedIdea(id, userId);
  return db.modelingIdea.update({ where: { id }, data: { status } });
}

export async function saveIdea(id: string, userId: string) {
  await getOwnedIdea(id, userId);
  return db.modelingIdea.update({ where: { id }, data: { saved: true } });
}

export async function developApprovedIdea(id: string, userId: string, ai?: AIService, aspectRatio = "9:16") {
  const idea = await getOwnedIdea(id, userId);
  if (idea.status !== "APPROVED") throw new AppError("IDEA_APPROVAL_REQUIRED", "Idea phải được approve trước khi Develop.", 409);
  const existingProject = await db.contentProject.findUnique({ where: { ideaId: id } });
  if (existingProject) return existingProject;
  const video = await db.competitorVideo.findUnique({ where: { id: idea.sourceVideoId }, include: { competitor: { include: { channel: true } } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy source video của idea.", 404);
  const analysis = videoAnalysisSchema.parse(idea.analysis.content);
  const rawContent = modelingIdeasSchema.shape.modelingDirections.element.parse(idea.content) as ModelingDirection;
  const channel = video.competitor.channel;
  let aiService = ai;
  if (!aiService) {
    const connection = await db.aIConnection.findFirst({ where: { userId, kind: "AI", provider: { in: ["GEMINI", "OPENAI"] }, revokedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!connection) throw new AppError("AI_CONNECTION_REQUIRED", "Vào Cài đặt AI và kết nối Gemini hoặc OpenAI trước khi tạo Content Project.", 409);
    const apiKey = decryptSecret(connection.encryptedKey);
    const aiProvider = connection.provider === "GEMINI" ? new GeminiProvider(apiKey) : new OpenAIProvider(apiKey);
    aiService = new AIService(aiProvider, { userId, channelId: channel.id });
  }
  const result = await aiService.developIdea({ channelDNA: { name: channel.name, topic: channel.topic, subTopic: channel.subTopic, targetCountry: channel.targetCountry, language: channel.language, audience: channel.audience, contentStyle: channel.contentStyle, visualStyle: channel.visualStyle, videoDuration: channel.videoDurationSec, hasDialogue: channel.hasDialogue, creativeInstructions: channel.creativeInstructions, timezone: channel.timezone }, video: { id: video.id, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt?.toISOString(), duration: video.duration }, analysis, idea: rawContent, aspectRatio });
  const storyboard = result.storyboard as Prisma.InputJsonValue;
  const productionPrompts = result.storyboard.map((scene) => ({ sceneNumber: scene.sceneNumber, englishPrompt: scene.englishPrompt })) as Prisma.InputJsonValue;
  return db.contentProject.create({ data: { channelId: channel.id, ideaId: id, status: "DRAFT", deconstruction: result.deconstruction as Prisma.InputJsonValue, artDirection: { ...(result.artDirection as Record<string, unknown>), aspectRatio } as Prisma.InputJsonValue, characterDesign: result.characterDesign as Prisma.InputJsonValue, backgroundDesign: result.backgroundDesign as Prisma.InputJsonValue, storyboard, safetyReview: result.safetyReview as Prisma.InputJsonValue, productionPrompts, createdBy: userId, scenes: { create: result.storyboard.map((scene) => ({ sceneNumber: scene.sceneNumber, visualBlock: scene.visualBlock, actionBlock: scene.actionBlock, audioBlock: scene.audioBlock, englishPrompt: scene.englishPrompt, status: "DRAFT" })) } }, include: { scenes: true } });
}
