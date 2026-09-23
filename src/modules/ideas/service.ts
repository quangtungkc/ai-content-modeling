import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/secrets";
import { GeminiProvider } from "@/services/ai/gemini";
import { AIService } from "@/services/ai/service";
import { modelingIdeasSchema, videoAnalysisSchema } from "@/services/ai/schemas";
import type { ChannelDNA, VideoContext } from "@/services/ai/types";
import { readChannelMainCharacterImage } from "@/modules/channels/service";
import { assertAttachedSourceVideoEvidence, selectBestAnalysis } from "@/modules/videos/analysis-service";
import { requestStage2GeminiBrowser } from "@/modules/generation/browser-flow-bridge";

export async function generateIdeasFromVideoBrowser(videoId: string, userId: string, artStyle: string, runId: string | null, execution?: { codexJobId: string; onProgress: (detail: string, payload?: Record<string, unknown>) => Promise<void> }) {
  const video = await db.competitorVideo.findFirst({ where: { id: videoId, competitor: { channel: { userId } } }, include: { competitor: { include: { channel: true } }, analyses: { orderBy: { version: "desc" }, take: 10 } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy competitor video.", 404);
  const analysis = selectBestAnalysis(video.analyses);
  if (!analysis) throw new AppError("ANALYSIS_REQUIRED", "Video cần được phân tích trước.", 409);
  assertAttachedSourceVideoEvidence(analysis.content);
  const channel = video.competitor.channel;
  const result = await requestStage2GeminiBrowser({ userId, channelId: channel.id, runId, codexJobId: execution?.codexJobId, purpose: "MODELING_IDEA", video: { id: video.id, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnailUrl, duration: video.duration, publishedAt: video.publishedAt?.toISOString() }, analysis: videoAnalysisSchema.parse(analysis.content), channelDNA: { channel }, artStyle }, execution?.onProgress);
  return storeModelingIdeasFromBrowser(videoId, userId, result, analysis.id);
}

export async function generateIdeasFromVideo(videoId: string, userId: string, artStyle = "", provider?: AIService) {
  const video = await db.competitorVideo.findFirst({ where: { id: videoId, competitor: { channel: { userId } } }, include: { competitor: { include: { channel: true } }, analyses: { orderBy: { version: "desc" }, take: 10 } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy competitor video.", 404);
  const analysisRecord = selectBestAnalysis(video.analyses);
  if (!analysisRecord) throw new AppError("ANALYSIS_REQUIRED", "Video cần được phân tích trước khi tạo modeling ideas.", 409);
  assertAttachedSourceVideoEvidence(analysisRecord.content);
  const analysis = videoAnalysisSchema.parse(analysisRecord.content);
  const channel = video.competitor.channel;
  const mainCharacterImage = await readChannelMainCharacterImage(channel);
  const channelDNA: ChannelDNA = { name: channel.name, topic: channel.topic, subTopic: channel.subTopic, targetCountry: channel.targetCountry, language: channel.language, audience: channel.audience, contentStyle: channel.contentStyle, visualStyle: channel.visualStyle, videoDuration: channel.videoDurationSec, hasDialogue: channel.hasDialogue, creativeInstructions: channel.creativeInstructions, hashtags: channel.hashtags, mainCharacterImageAvailable: Boolean(channel.mainCharacterImageKey), mainCharacterImageName: channel.mainCharacterImageName, timezone: channel.timezone };
  const videoContext: VideoContext = { id: video.id, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt?.toISOString(), duration: video.duration };
  let aiService = provider;
  if (!aiService) {
    const connection = await db.aIConnection.findFirst({ where: { userId, kind: "AI", provider: "GEMINI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!connection) throw new AppError("AI_CONNECTION_REQUIRED", "Vào Cài đặt AI và kết nối Gemini API trước khi tạo Modeling Idea.", 409);
    const apiKey = decryptSecret(connection.encryptedKey);
    const aiProvider = new GeminiProvider(apiKey);
    aiService = new AIService(aiProvider, { userId, channelId: channel.id });
  }
  const result = await aiService.generateIdeas({ channelDNA, video: videoContext, analysis, artStyle, mainCharacterImage });
  if (result.modelingDirections.length !== 1) throw new AppError("INVALID_IDEA_COUNT", "AI phải trả đúng 1 modeling idea.", 502);
  const ideas = await db.$transaction(result.modelingDirections.map((content) => db.modelingIdea.create({ data: { sourceVideoId: video.id, analysisId: analysisRecord.id, title: content.title, content, status: "DRAFT" } })));
  return {
    sourceVideoId: video.id,
    analysisId: analysisRecord.id,
    ideas: ideas.map((idea) => ({
      id: idea.id,
      createdAt: idea.createdAt,
      status: idea.status,
      ...modelingIdeasSchema.shape.modelingDirections.element.parse(idea.content),
    })),
  };
}

export async function storeModelingIdeasFromBrowser(videoId: string, userId: string, value: unknown, analysisId?: string) {
  const video = await db.competitorVideo.findFirst({ where: { id: videoId, competitor: { channel: { userId } } }, include: { analyses: { orderBy: { version: "desc" }, take: 10 } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy competitor video.", 404);
  const analysisRecord = selectBestAnalysis(video.analyses, analysisId);
  if (!analysisRecord) throw new AppError("ANALYSIS_REQUIRED", "Video cần được phân tích trước khi tạo modeling ideas.", 409);
  assertAttachedSourceVideoEvidence(analysisRecord.content);
  const parsed = modelingIdeasSchema.parse(value);
  if (parsed.modelingDirections.length !== 1) throw new AppError("INVALID_IDEA_COUNT", "Browser Gemini phải trả đúng 1 modeling idea.", 502);
  const ideas = await db.$transaction(parsed.modelingDirections.map((content) => db.modelingIdea.create({ data: { sourceVideoId: video.id, analysisId: analysisRecord.id, title: content.title, content, status: "DRAFT" } })));
  return {
    sourceVideoId: video.id,
    analysisId: analysisRecord.id,
    ideas: ideas.map((idea) => ({ id: idea.id, createdAt: idea.createdAt, status: idea.status, ...modelingIdeasSchema.shape.modelingDirections.element.parse(idea.content) })),
  };
}
