import { db } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { AIService } from "@/services/ai/service";
import { developedIdeaSchema, normalizeDevelopedIdeaResponse, videoAnalysisSchema, modelingIdeasSchema } from "@/services/ai/schemas";
import type { ModelingDirection } from "@/services/ai/types";
import { decryptSecret } from "@/lib/secrets";
import { GeminiProvider } from "@/services/ai/gemini";
import { readChannelMainCharacterImage } from "@/modules/channels/service";
import { assembleSourceModelingSpec, assertStrictModelingIdeaChangeScope, CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS, CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, CANONICAL_DEFAULT_MODELING_POLICY, CANONICAL_DEFAULT_TIMING_TOLERANCE, sourceModelingSpecSchema, validateGeneratedSceneMapping, type GeneratedSceneMapping } from "@/modules/modeling/strict-source-modeling";
import { buildAuthoritativeStoryboardValidationPlans, validateStoryboardSource, type SourceValidationContext } from "@/modules/source-validation/multi-stage";

function strictSourceFields(video: { id: string; url: string; caption?: string | null; thumbnailUrl?: string | null; publishedAt?: Date | null; duration?: number | null; competitor: { platform: string } }, result: { sourceModelingSpec?: unknown; storyboard: Array<{ sceneNumber: number; sourceSceneId?: string; sourceBeat?: string; actionSequence?: string[]; cameraSpec?: Record<string, unknown>; spatialSpec?: Record<string, unknown>; startState?: string; endState?: string; targetDuration?: number }> }, storyboard: Array<{ sceneNumber: number; sourceSceneId?: string; targetDuration?: number }>) {
  const sourceVideoMetadata = { id: video.id, url: video.url, caption: video.caption ?? null, thumbnailUrl: video.thumbnailUrl ?? null, publishedAt: video.publishedAt?.toISOString() ?? null, duration: video.duration ?? null, platform: video.competitor.platform };
  const assembled = result.sourceModelingSpec === undefined ? null : assembleSourceModelingSpec(result.sourceModelingSpec, { sourceVideoId: video.id, sourceVideoUrl: video.url, sourceVideoMetadata, sourceDuration: video.duration, sourcePlatform: video.competitor.platform, modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY, modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET, timingTolerance: CANONICAL_DEFAULT_TIMING_TOLERANCE });
  if (assembled?.metadataMismatches.length) console.warn("[STRICT_MODELING_METADATA_MISMATCH]", JSON.stringify(assembled.metadataMismatches));
  if (assembled?.canonicalizationApplied) console.warn("[STRICT_MODELING_CANONICALIZATION]", JSON.stringify({ canonicalizedFields: assembled.canonicalizedFields, changes: assembled.canonicalizationChanges }));
  const sourceModelingSpec = assembled ? sourceModelingSpecSchema.parse(assembled.candidate) : null;
  let mappings: GeneratedSceneMapping[] = [];
  if (sourceModelingSpec) {
    const sourceScenes = [...sourceModelingSpec.scenes].sort((left, right) => left.order - right.order);
    mappings = validateGeneratedSceneMapping(sourceModelingSpec, storyboard.map((scene, index) => ({ ...scene, targetDuration: scene.targetDuration ?? sourceScenes[index]?.duration })));
  }
  if (sourceModelingSpec) {
    const sourceContext: SourceValidationContext = { projectId: "pending-content-project", sourceVideoId: video.id, sourceVideoUrl: video.url, sourceModelingSpecVersion: sourceModelingSpec.specVersion, sourceSpec: sourceModelingSpec, mustPreserve: [...new Set(sourceModelingSpec.scenes.flatMap((scene) => scene.mustPreserve))], allowedTransformations: [...CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS], validationStage: "STORYBOARD", sourceEvidence: sourceModelingSpec.sourceEvidence };
    const storyboardValidation = validateStoryboardSource(sourceContext, buildAuthoritativeStoryboardValidationPlans(sourceModelingSpec, mappings));
    if (storyboardValidation.status !== "PASS") throw new AppError(storyboardValidation.status === "FAIL" ? "SOURCE_STORYBOARD_MISMATCH" : "SOURCE_STORYBOARD_NOT_EVALUATED", "Storyboard chưa chứng minh đủ source scene/beat/action/camera/timing theo STRICT_MODELING.", 409, { validation: storyboardValidation });
  }
  return {
    sourceVideoId: video.id,
    sourceVideoUrl: video.url,
    sourceVideoMetadata: { id: video.id, url: video.url, caption: video.caption ?? null, thumbnailUrl: video.thumbnailUrl ?? null, publishedAt: video.publishedAt?.toISOString() ?? null, duration: video.duration ?? null, platform: video.competitor.platform },
    sourceDuration: video.duration,
    sourcePlatform: video.competitor.platform,
    modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY,
    modelingFidelityTarget: CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET,
    sourceModelingSpecVersion: sourceModelingSpec?.specVersion ?? null,
    sourceModelingSpec: sourceModelingSpec ? sourceModelingSpec as Prisma.InputJsonValue : undefined,
    sourceSpecCreatedAt: sourceModelingSpec ? new Date() : null,
    mappings,
  };
}

function strictSceneFields(mapping: GeneratedSceneMapping | undefined): Record<string, unknown> {
  if (!mapping) return {};
  return { sourceSceneId: mapping.sourceSceneId, sourceSceneOrder: mapping.sourceSceneOrder, sourceSceneStartTime: mapping.sourceSceneStartTime, sourceSceneEndTime: mapping.sourceSceneEndTime, sourceDuration: mapping.sourceDuration, targetDuration: mapping.targetDuration, durationDelta: mapping.durationDelta, durationRatio: mapping.durationRatio, timingStatus: mapping.timingStatus, cameraSpec: mapping.cameraSpec as Prisma.InputJsonValue, actionSequence: mapping.actionSequence as Prisma.InputJsonValue, spatialSpec: mapping.spatialSpec as Prisma.InputJsonValue, mustPreserve: mapping.mustPreserve as Prisma.InputJsonValue, allowedTransformations: mapping.allowedTransformations as Prisma.InputJsonValue };
}

async function getOwnedIdea(id: string, userId: string) {
  const idea = await db.modelingIdea.findFirst({ where: { id, analysis: { sourceVideo: { competitor: { channel: { userId } } } } }, include: { analysis: true } });
  if (!idea) throw new AppError("IDEA_NOT_FOUND", "Không tìm thấy modeling idea.", 404);
  return idea;
}

function assertModelingSafetyReview(result: { safetyReview: { safetyStatus: "PASS" | "BLOCKED"; blockedReasons: string[]; safeAlternative: string } }) {
  if (result.safetyReview.safetyStatus === "PASS") return;
  throw new AppError("CONTENT_SAFETY_BLOCKED", "Modeling bị dừng vì Gemini đánh dấu nội dung có nguy cơ vi phạm an toàn. Hãy chỉnh source/prompt theo phương án an toàn rồi chạy lại.", 422, { blockedReasons: result.safetyReview.blockedReasons, safeAlternative: result.safetyReview.safeAlternative });
}

export async function getAuthoritativeSourceModelingSpec(sourceVideoId: string) {
  const priorProjects = await db.contentProject.findMany({
    where: { sourceVideoId, modelingPolicy: CANONICAL_DEFAULT_MODELING_POLICY },
    orderBy: { createdAt: "asc" },
    select: { sourceModelingSpec: true },
  });
  return priorProjects.find((project) => project.sourceModelingSpec)?.sourceModelingSpec ?? null;
}

export async function setIdeaStatus(id: string, userId: string, status: "APPROVED" | "REJECTED") {
  await getOwnedIdea(id, userId);
  return db.modelingIdea.update({ where: { id }, data: { status } });
}

export async function saveIdea(id: string, userId: string) {
  await getOwnedIdea(id, userId);
  return db.modelingIdea.update({ where: { id }, data: { saved: true } });
}

export async function developApprovedIdeaBrowser(id: string, userId: string, aspectRatio: string, runId: string | null, execution?: { codexJobId: string; onProgress: (detail: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const idea = await getOwnedIdea(id, userId);
  if (idea.status !== "APPROVED") throw new AppError("IDEA_APPROVAL_REQUIRED", "Idea phải được approve trước khi Develop.", 409);
  const existing = await db.contentProject.findUnique({ where: { ideaId: id } });
  if (existing) return existing;
  assertStrictModelingIdeaChangeScope(modelingIdeasSchema.shape.modelingDirections.element.parse(idea.content));
  const video = await db.competitorVideo.findUnique({ where: { id: idea.sourceVideoId }, include: { competitor: { include: { channel: true } } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy source video.", 404);
  const { requestStage2GeminiBrowser } = await import("@/modules/generation/browser-flow-bridge");
  const result = await requestStage2GeminiBrowser({ userId, channelId: video.competitor.channel.id, runId, codexJobId: execution?.codexJobId, purpose: "CONTENT_PROJECT_DEVELOP", video: { id: video.id, url: video.url, caption: video.caption, duration: video.duration, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt?.toISOString() }, analysis: videoAnalysisSchema.parse(idea.analysis.content), idea: modelingIdeasSchema.shape.modelingDirections.element.parse(idea.content), channelDNA: { channel: video.competitor.channel }, aspectRatio, authoritativeSourceModelingSpec: await getAuthoritativeSourceModelingSpec(video.id) }, execution?.onProgress);
  return storeDevelopedIdeaFromBrowser(id, userId, result, aspectRatio);
}

export async function developApprovedIdea(id: string, userId: string, ai?: AIService, aspectRatio = "9:16") {
  const idea = await getOwnedIdea(id, userId);
  if (idea.status !== "APPROVED") throw new AppError("IDEA_APPROVAL_REQUIRED", "Idea phải được approve trước khi Develop.", 409);
  const existingProject = await db.contentProject.findUnique({ where: { ideaId: id } });
  if (existingProject) return existingProject;
  assertStrictModelingIdeaChangeScope(modelingIdeasSchema.shape.modelingDirections.element.parse(idea.content));
  const video = await db.competitorVideo.findUnique({ where: { id: idea.sourceVideoId }, include: { competitor: { include: { channel: true } } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy source video của idea.", 404);
  const analysis = videoAnalysisSchema.parse(idea.analysis.content);
  const rawContent = modelingIdeasSchema.shape.modelingDirections.element.parse(idea.content) as ModelingDirection;
  const channel = video.competitor.channel;
  let aiService = ai;
  if (!aiService) {
    const connection = await db.aIConnection.findFirst({ where: { userId, kind: "AI", provider: "GEMINI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!connection) throw new AppError("AI_CONNECTION_REQUIRED", "Vào Cài đặt AI và kết nối Gemini API trước khi tạo Content Project.", 409);
    const apiKey = decryptSecret(connection.encryptedKey);
    const aiProvider = new GeminiProvider(apiKey);
    aiService = new AIService(aiProvider, { userId, channelId: channel.id });
  }
  const mainCharacterImage = await readChannelMainCharacterImage(channel);
  const result = await aiService.developIdea({ channelDNA: { name: channel.name, topic: channel.topic, subTopic: channel.subTopic, targetCountry: channel.targetCountry, language: channel.language, audience: channel.audience, contentStyle: channel.contentStyle, visualStyle: channel.visualStyle, videoDuration: channel.videoDurationSec, hasDialogue: channel.hasDialogue, creativeInstructions: channel.creativeInstructions, hashtags: channel.hashtags, mainCharacterImageAvailable: Boolean(channel.mainCharacterImageKey), mainCharacterImageName: channel.mainCharacterImageName, timezone: channel.timezone }, video: { id: video.id, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt?.toISOString(), duration: video.duration }, analysis, idea: rawContent, aspectRatio, mainCharacterImage });
  assertModelingSafetyReview(result);
  const storyboard = result.storyboard as Prisma.InputJsonValue;
  const productionPrompts = result.storyboard.map((scene) => ({ sceneNumber: scene.sceneNumber, startFramePrompt: scene.startFramePrompt, englishPrompt: scene.englishPrompt })) as Prisma.InputJsonValue;
  const strict = strictSourceFields(video, result, result.storyboard);
  const mappingByScene = new Map(strict.mappings.map((mapping) => [mapping.sceneNumber, mapping]));
  return db.contentProject.create({ data: { channelId: channel.id, ideaId: id, status: "DRAFT", sourceVideoId: strict.sourceVideoId, sourceVideoUrl: strict.sourceVideoUrl, sourceVideoMetadata: strict.sourceVideoMetadata, sourceDuration: strict.sourceDuration, sourcePlatform: strict.sourcePlatform, modelingPolicy: strict.modelingPolicy, modelingFidelityTarget: strict.modelingFidelityTarget, sourceModelingSpecVersion: strict.sourceModelingSpecVersion, sourceModelingSpec: strict.sourceModelingSpec, sourceSpecCreatedAt: strict.sourceSpecCreatedAt, deconstruction: result.deconstruction as Prisma.InputJsonValue, artDirection: { ...(result.artDirection as Record<string, unknown>), aspectRatio, modelingPolicy: "STRICT_MODELING", modelingFidelityTarget: 0.9 } as Prisma.InputJsonValue, characterDesign: result.characterDesign as Prisma.InputJsonValue, backgroundDesign: result.backgroundDesign as Prisma.InputJsonValue, storyboard, safetyReview: result.safetyReview as Prisma.InputJsonValue, productionPrompts, createdBy: userId, scenes: { create: result.storyboard.map((scene) => ({ ...strictSceneFields(mappingByScene.get(scene.sceneNumber)), sceneNumber: scene.sceneNumber, visualBlock: scene.visualBlock, actionBlock: scene.actionBlock, audioBlock: scene.audioBlock, startFramePrompt: scene.startFramePrompt, englishPrompt: scene.englishPrompt, status: "DRAFT" })) } }, include: { scenes: true } });
}

export async function storeDevelopedIdeaFromBrowser(id: string, userId: string, value: unknown, aspectRatio = "9:16") {
  const idea = await getOwnedIdea(id, userId);
  if (idea.status !== "APPROVED") throw new AppError("IDEA_APPROVAL_REQUIRED", "Idea phải được approve trước khi Develop.", 409);
  const existingProject = await db.contentProject.findUnique({ where: { ideaId: id } });
  if (existingProject) return existingProject;
  const video = await db.competitorVideo.findUnique({ where: { id: idea.sourceVideoId }, include: { competitor: { include: { channel: true } } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy source video của idea.", 404);
  const result = developedIdeaSchema.parse(normalizeDevelopedIdeaResponse(value));
  assertModelingSafetyReview(result);
  const storyboard = result.storyboard as Prisma.InputJsonValue;
  const productionPrompts = result.storyboard.map((scene) => ({ sceneNumber: scene.sceneNumber, startFramePrompt: scene.startFramePrompt, englishPrompt: scene.englishPrompt })) as Prisma.InputJsonValue;
  const strict = strictSourceFields(video, result, result.storyboard);
  const mappingByScene = new Map(strict.mappings.map((mapping) => [mapping.sceneNumber, mapping]));
  return db.contentProject.create({ data: { channelId: video.competitor.channel.id, ideaId: id, status: "DRAFT", sourceVideoId: strict.sourceVideoId, sourceVideoUrl: strict.sourceVideoUrl, sourceVideoMetadata: strict.sourceVideoMetadata, sourceDuration: strict.sourceDuration, sourcePlatform: strict.sourcePlatform, modelingPolicy: strict.modelingPolicy, modelingFidelityTarget: strict.modelingFidelityTarget, sourceModelingSpecVersion: strict.sourceModelingSpecVersion, sourceModelingSpec: strict.sourceModelingSpec, sourceSpecCreatedAt: strict.sourceSpecCreatedAt, deconstruction: result.deconstruction as Prisma.InputJsonValue, artDirection: { ...result.artDirection, aspectRatio, modelingPolicy: "STRICT_MODELING", modelingFidelityTarget: 0.9 } as Prisma.InputJsonValue, characterDesign: result.characterDesign as Prisma.InputJsonValue, backgroundDesign: result.backgroundDesign as Prisma.InputJsonValue, storyboard, safetyReview: result.safetyReview as Prisma.InputJsonValue, productionPrompts, createdBy: userId, scenes: { create: result.storyboard.map((scene) => ({ ...strictSceneFields(mappingByScene.get(scene.sceneNumber)), sceneNumber: scene.sceneNumber, visualBlock: scene.visualBlock, actionBlock: scene.actionBlock, audioBlock: scene.audioBlock, startFramePrompt: scene.startFramePrompt, englishPrompt: scene.englishPrompt, status: "DRAFT" })) } }, include: { scenes: true } });
}
