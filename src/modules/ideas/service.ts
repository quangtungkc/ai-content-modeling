import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { AIService } from "@/services/ai/service";
import { videoAnalysisSchema } from "@/services/ai/schemas";
import type { ChannelDNA, VideoContext } from "@/services/ai/types";

export async function generateIdeasFromVideo(videoId: string, userId: string, provider?: AIService) {
  const video = await db.competitorVideo.findFirst({ where: { id: videoId, competitor: { channel: { userId } } }, include: { competitor: { include: { channel: true } }, analyses: { orderBy: { version: "desc" }, take: 1 } } });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy competitor video.", 404);
  const analysisRecord = video.analyses[0];
  if (!analysisRecord) throw new AppError("ANALYSIS_REQUIRED", "Video cần được phân tích trước khi tạo modeling ideas.", 409);
  const analysis = videoAnalysisSchema.parse(analysisRecord.content);
  const channel = video.competitor.channel;
  const channelDNA: ChannelDNA = { name: channel.name, topic: channel.topic, subTopic: channel.subTopic, targetCountry: channel.targetCountry, language: channel.language, audience: channel.audience, contentStyle: channel.contentStyle, visualStyle: channel.visualStyle, videoDuration: channel.videoDurationSec, hasDialogue: channel.hasDialogue, creativeInstructions: channel.creativeInstructions, timezone: channel.timezone };
  const videoContext: VideoContext = { id: video.id, url: video.url, caption: video.caption, thumbnailUrl: video.thumbnailUrl, publishedAt: video.publishedAt?.toISOString(), duration: video.duration };
  const aiService = provider ?? new AIService(undefined, { userId, channelId: channel.id });
  const result = await aiService.generateIdeas({ channelDNA, video: videoContext, analysis });
  if (result.modelingDirections.length < 3 || result.modelingDirections.length > 5) throw new AppError("INVALID_IDEA_COUNT", "AI phải trả từ 3 đến 5 modeling ideas.", 502);
  const ideas = await db.$transaction(result.modelingDirections.map((content) => db.modelingIdea.create({ data: { sourceVideoId: video.id, analysisId: analysisRecord.id, title: content.title, content, status: "DRAFT" } })));
  return { sourceVideoId: video.id, analysisId: analysisRecord.id, ideas };
}
