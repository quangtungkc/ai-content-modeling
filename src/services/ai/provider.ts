import type { AIInput, AIProvider, DevelopedIdea, ModelingIdeas, ModelingDirection, VideoAnalysis, VideoUnderstandingInput, VisualBreakdown, FinalReviewInput, FinalReview, AssetValidationInput, AssetValidation } from "./types";
import { AIProviderNotConfiguredError } from "./errors";

export class UnconfiguredAIProvider implements AIProvider {
  readonly name = "unconfigured";
  private unavailable(): never { throw new AIProviderNotConfiguredError(this.name); }
  async analyzeVideo(input: AIInput): Promise<VideoAnalysis> { void input; return this.unavailable(); }
  async generateIdeas(input: AIInput & { analysis: VideoAnalysis }): Promise<ModelingIdeas> { void input; return this.unavailable(); }
  async developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection }): Promise<DevelopedIdea> { void input; return this.unavailable(); }
  async understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown> { void input; return this.unavailable(); }
  async reviewProject(input: FinalReviewInput): Promise<FinalReview> { void input; return this.unavailable(); }
  async validateAsset(input: AssetValidationInput): Promise<AssetValidation> { void input; return this.unavailable(); }
}
