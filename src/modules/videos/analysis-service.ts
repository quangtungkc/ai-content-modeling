import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/secrets";
import { GeminiProvider } from "@/services/ai/gemini";
import { AIService } from "@/services/ai/service";
import type { ChannelDNA, VideoContext } from "@/services/ai/types";
import { readChannelMainCharacterImage } from "@/modules/channels/service";
import { analyzeSourceVideoWithGeminiBrowser } from "@/modules/generation/browser-flow-bridge";
import { videoAnalysisSchema } from "@/services/ai/schemas";

const ANALYSIS_FIELDS = ["summary", "hook", "setup", "conflict", "escalation", "twist", "payoff", "theGag", "cameraPattern", "editingRhythm", "soundPattern", "retentionMechanism"] as const;
const INSUFFICIENT_EVIDENCE = /không thể quan sát|không truy cập|không xem được|không tiếp cận|phỏng đoán|giới hạn truy cập/i;

export function analysisEvidenceScore(value: unknown) {
  const parsed = videoAnalysisSchema.safeParse(value);
  if (!parsed.success) return Number.NEGATIVE_INFINITY;
  const content = parsed.data;
  const usableFields = ANALYSIS_FIELDS.filter((field) => content[field].trim().length >= 24 && !INSUFFICIENT_EVIDENCE.test(content[field])).length;
  const interactionScore = content.characterInteractions.filter((item) => item.trim().length >= 16 && !INSUFFICIENT_EVIDENCE.test(item)).length;
  const whyScore = content.whyItWorks.filter((item) => item.trim().length >= 16 && !INSUFFICIENT_EVIDENCE.test(item)).length;
  return usableFields + interactionScore + whyScore;
}

export function isAnalysisUsableForModeling(value: unknown) {
  return analysisEvidenceScore(value) >= 10;
}

export function selectBestAnalysis<T extends { id: string; version: number; content: unknown }>(records: T[], preferredId?: string) {
  const preferred = preferredId ? records.find((record) => record.id === preferredId) : undefined;
  if (preferred && isAnalysisUsableForModeling(preferred.content)) return preferred;
  return records
    .filter((record) => isAnalysisUsableForModeling(record.content))
    .sort((left, right) => analysisEvidenceScore(right.content) - analysisEvidenceScore(left.content) || right.version - left.version)[0]
    ?? preferred
    ?? records.slice().sort((left, right) => right.version - left.version)[0];
}

async function ownedVideo(videoId: string, userId: string) {
  const video = await db.competitorVideo.findFirst({
    where: { id: videoId, competitor: { channel: { userId } } },
    include: { competitor: { include: { channel: true } }, snapshots: { orderBy: { capturedAt: "desc" }, take: 1 } },
  });
  if (!video) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy video đối thủ.", 404);
  return video;
}

export async function storeCompetitorVideoAnalysis(videoId: string, userId: string, value: unknown, providerName = "gemini-browser") {
  const video = await ownedVideo(videoId, userId);
  const analysis = videoAnalysisSchema.parse(value);
  const latestAnalysis = await db.sourceAnalysis.findFirst({ where: { sourceVideoId: video.id }, orderBy: { version: "desc" }, select: { version: true } });
  const stored = await db.sourceAnalysis.create({ data: { sourceVideoId: video.id, version: (latestAnalysis?.version ?? 0) + 1, provider: providerName, schemaVersion: analysis.schemaVersion, content: analysis } });
  return { id: stored.id, createdAt: stored.createdAt, analysis };
}

export async function analyzeCompetitorVideo(videoId: string, userId: string) {
  const video = await ownedVideo(videoId, userId);

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
    hashtags: channel.hashtags,
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
  const mainCharacterImage = await readChannelMainCharacterImage(channel);
  let analysis;
  let providerName = "gemini-browser";
  if (process.env.DESKTOP_MODE === "1") {
    const browserResult = await analyzeSourceVideoWithGeminiBrowser({ userId, channelId: channel.id, video: videoContext, channelDNA });
    analysis = videoAnalysisSchema.parse(browserResult);
  } else {
    const connection = await db.aIConnection.findFirst({ where: { userId, kind: "AI", provider: "GEMINI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
    if (!connection) throw new AppError("AI_CONNECTION_REQUIRED", "Vào Cài đặt AI và kết nối Gemini API trước khi phân tích.", 409);
    const apiKey = decryptSecret(connection.encryptedKey);
    const provider = new GeminiProvider(apiKey);
    const aiService = new AIService(provider, { userId, channelId: channel.id });
    analysis = await aiService.analyzeVideo({ channelDNA, video: videoContext, mainCharacterImage });
    providerName = aiService.providerName;
  }
  return storeCompetitorVideoAnalysis(video.id, userId, analysis, providerName);
}
