import { getAIProvider } from ".";
import type { AIInput, DevelopedIdea, ModelingDirection, ModelingIdeas, VideoAnalysis, VideoUnderstandingInput, VisualBreakdown, FinalReview, FinalReviewInput, AssetValidationInput, AssetValidation } from "./types";
import { UsageMetric } from "@prisma/client";
import { recordUsage, type UsageContext } from "@/modules/usage/service";

export class AIService {
  constructor(private readonly provider = getAIProvider(), private readonly usageContext?: UsageContext) {}
  get providerName() { return this.provider.name; }
  analyzeVideo(input: AIInput): Promise<VideoAnalysis> { return this.track(UsageMetric.AI_CALL, () => this.provider.analyzeVideo(input)); }
  generateIdeas(input: AIInput & { analysis: VideoAnalysis }): Promise<ModelingIdeas> { return this.track(UsageMetric.AI_CALL, () => this.provider.generateIdeas(input)); }
  developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection }): Promise<DevelopedIdea> { return this.track(UsageMetric.AI_CALL, () => this.provider.developIdea(input)); }
  understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown> { return this.track(UsageMetric.GEMINI_VIDEO_ANALYSIS, () => this.provider.understandVideo(input)); }
  reviewProject(input: FinalReviewInput): Promise<FinalReview> { return this.track(UsageMetric.AI_CALL, () => this.provider.reviewProject(input)); }
  validateAsset(input: AssetValidationInput): Promise<AssetValidation> { return this.track(UsageMetric.AI_CALL, () => this.provider.validateAsset(input)); }
  private async track<T>(metric: UsageMetric, operation: () => Promise<T>) { try { return await operation(); } finally { if (this.usageContext) void recordUsage({ ...this.usageContext, metric, idempotencyKey: `ai:${metric}:${this.provider.name}:${crypto.randomUUID()}` }); } }
}
