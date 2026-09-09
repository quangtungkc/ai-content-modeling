import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/secrets";
import { GeminiProvider } from "@/services/ai/gemini";
import { OpenAIProvider } from "@/services/ai/openai";
import { AIService } from "@/services/ai/service";
import type { ChannelDNA, VideoContext } from "@/services/ai/types";

export async function analyzeCompetitorVideo(videoId: string, userId: string) {
  const video = await db.competitorVideo.findFirst({
    where: { id: videoId, competitor: { channel: { userId } } },
    include: { competitor: { include: { channel: true } }, snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy video đối thủ.", 404);

  const connection = await db.aIConnection.findFirst({
    where: { userId, kind: "AI", provider: { in: ["GEMINI", "OPENAI"] }, revokedAt: null },
    orderBy: { updatedAt: "desc" },
  });
  if (!connection) throw new AppError("AI_CONNECTION_REQUIRED", "Vào Cài đặt AI và kết nối Gemini hoặc OpenAI trước khi phân tích.", 409);

  const apiKey = decryptSecret(connection.encryptedKey);
  const provider = connection.provider === "GEMINI" ? new GeminiProvider(apiKey) : new OpenAIProvider(apiKey);
  const channel = video.competitor.channel;
  const channelDNA: ChannelDNA = {
    name: channel.name,
    topic: channel.topic,
    subTopic: channel.subTopic,
    targetCountry: channel.targetCountry,
    language: channel.language,
    audience: channel.audience,
    contentStyle: channel.contentStyle,
    visualStyle: channel.visualStyle,
    videoDuration: channel.videoDurationSec,
    hasDialogue: channel.hasDialogue,
    creativeInstructions: channel.creativeInstructions,
    mainCharacterImageAvailable: Boolean(channel.mainCharacterImageKey),
    mainCharacterImageName: channel.mainCharacterImageName,
    timezone: channel.timezone,
  };
  const latest = video.snapshots[0];
  const videoContext: VideoContext = {
    id: video.id,
    url: video.url,
    caption: [video.caption, latest ? `Số liệu đang hiển thị: ${latest.views} lượt xem, ${latest.likes} lượt thích, ${latest.comments} bình luận, ${latest.shares} lượt chia sẻ.` : null].filter(Boolean).join("\n"),
    thumbnailUrl: video.thumbnailUrl,
    publishedAt: video.publishedAt?.toISOString(),
    duration: video.duration,
  };
  const aiService = new AIService(provider, { userId, channelId: channel.id });
  const analysis = await aiService.analyzeVideo({ channelDNA, video: videoContext });
  const latestAnalysis = await db.sourceAnalysis.findFirst({ where: { sourceVideoId: video.id }, orderBy: { version: "desc" }, select: { version: true } });
  const stored = await db.sourceAnalysis.create({
    data: { sourceVideoId: video.id, version: (latestAnalysis?.version ?? 0) + 1, provider: aiService.providerName, schemaVersion: analysis.schemaVersion, content: analysis },
  });
  return { id: stored.id, createdAt: stored.createdAt, analysis };
}
