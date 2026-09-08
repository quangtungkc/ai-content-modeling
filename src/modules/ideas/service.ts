import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/secrets";
import { GeminiProvider } from "@/services/ai/gemini";
import { OpenAIProvider } from "@/services/ai/openai";
import { AIService } from "@/services/ai/service";
import { videoAnalysisSchema } from "@/services/ai/schemas";
import type { ChannelDNA, VideoContext } from "@/services/ai/types";

export async function generateIdeasFromVideo(videoId: string, userId: string, artStyle = "", provider?: AIService) {
  const video = await db.competitorVideo.findFirst({ where: { id: videoId, competitor: { channel: { userId } } }, include: { competitor: { include: { channel: true } }, analyses: { orderBy: { version: "desc" }, take: 1 } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy competitor video.", 404);
  const analysisRecord = video.analyses[0];
  if (!analysisRecord) throw new AppError("ANALYSIS_REQUIRED", "Video cần được phân tích trước khi tạo modeling ideas.", 409);
  const analysis = videoAnalysisSchema.parse(analysisRecord.content);
  const channel = video.competitor.channel;
  const channelDNA: ChannelDNA = { name: channel.name, topic: channel.topic, subTopic: channel.subTopic, targetCountry: channel.targetCountry, language: channel.language, audience: channel.audience, contentStyle: channel.contentStyle, visualStyle: channel.visualStyle, videoDuration: channel.videoDurationSec, hasDialogue: channel.hasDialogue, creativeInstructions: channel.creativeInstructions, timezone: channel.timezone };
  const videoContext: VideoContext = { id: video.id, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt?.toISOString(), duration: video.duration };
  let aiService = provider;
  if (!aiService) {
    const connection = await db.aIConnection.findFirst({ where: { userId, kind: "AI", provider: { in: ["GEMINI", "OPENAI"] }, revokedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!connection) throw new AppError("AI_CONNECTION_REQUIRED", "Vào Cài đặt AI và kết nối Gemini hoặc OpenAI trước khi tạo Modeling Idea.", 409);
    const apiKey = decryptSecret(connection.encryptedKey);
    const aiProvider = connection.provider === "GEMINI" ? new GeminiProvider(apiKey) : new OpenAIProvider(apiKey);
    aiService = new AIService(aiProvider, { userId, channelId: channel.id });
  }
  const result = await aiService.generateIdeas({ channelDNA, video: videoContext, analysis, artStyle });
  if (result.modelingDirections.length !== 1) throw new AppError("INVALID_IDEA_COUNT", "AI phải trả đúng 1 modeling idea.", 502);
  const ideas = await db.$transaction(result.modelingDirections.map((content) => db.modelingIdea.create({ data: { sourceVideoId: video.id, analysisId: analysisRecord.id, title: content.title, content, status: "DRAFT" } })));
  return { sourceVideoId: video.id, analysisId: analysisRecord.id, ideas };
}
