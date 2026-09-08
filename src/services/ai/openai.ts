import { AIProviderNotConfiguredError, AIStructuredOutputError } from "./errors";
import { developedIdeaSchema, modelingIdeasSchema, videoAnalysisSchema } from "./schemas";
import type { AIInput, AIProvider, ModelingDirection, VideoAnalysis, VideoUnderstandingInput, VisualBreakdown, FinalReviewInput, FinalReview, AssetValidationInput, AssetValidation } from "./types";
import { finalReviewSchema } from "./review-schemas";

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY, private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini") {}
  analyzeVideo(input: AIInput) { return this.request("Analyze the video and return only JSON matching the analysis schema.", input, videoAnalysisSchema); }
  generateIdeas(input: AIInput & { analysis: VideoAnalysis; artStyle?: string }) { return this.request(`Generate exactly ONE original modeling idea in Vietnamese. Preserve only the source mechanism, never surface details, characters, setting, wording, or sequence. Return one modelingDirections item with title, coreConcept, script, characterDesign, setting, artStyle, sourceMechanism, whatIsPreserved, whatIsChanged, targetMarketAdaptation, similarityRisk, and whyWorthDeveloping. Selected art style: ${input.artStyle ?? "Use the channel's existing art style"}.`, input, modelingIdeasSchema); }
  developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection }) { return this.request("Develop the approved idea into the structured content package. Return only JSON matching the development schema.", input, developedIdeaSchema); }
  async understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown> { void input; throw new AIStructuredOutputError(this.name, "Video understanding trực tiếp dùng Gemini ở phase này."); }
  async reviewProject(input: FinalReviewInput): Promise<FinalReview> { return this.request("Review the draft package. Return issues and suggestions only; do not rewrite the package.", input, finalReviewSchema); }
  async validateAsset(input: AssetValidationInput): Promise<AssetValidation> { void input; throw new AIStructuredOutputError(this.name, "Asset visual validation dùng Gemini ở phase này."); }
  private async request<T>(instruction: string, input: unknown, schema: { parse(value: unknown): T }): Promise<T> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, input: [{ role: "system", content: [{ type: "input_text", text: instruction }] }, { role: "user", content: [{ type: "input_text", text: JSON.stringify(input) }] }], text: { format: { type: "json_object" } } }) });
    if (!response.ok) throw new AIStructuredOutputError(this.name, { status: response.status });
    const body = await response.json() as { output_text?: string };
    try { return schema.parse(JSON.parse(body.output_text ?? "")); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
}
