import { AIProviderNotConfiguredError, AIStructuredOutputError } from "./errors";
import { developedIdeaSchema, modelingIdeasSchema, videoAnalysisSchema } from "./schemas";
import { visualBreakdownSchema } from "./video-schemas";
import { finalReviewSchema } from "./review-schemas";
import { assetValidationSchema } from "./asset-schemas";
import type { AIInput, AIProvider, ModelingDirection, VideoAnalysis, VideoUnderstandingInput, VisualBreakdown, FinalReviewInput, FinalReview, AssetValidationInput, AssetValidation } from "./types";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  constructor(private readonly apiKey = process.env.GEMINI_API_KEY, private readonly model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash") {}
  analyzeVideo(input: AIInput) {
    return this.request(
      "Analyze the video. Return exactly one JSON object, with no Markdown fences and no commentary. Use exactly these keys: schemaVersion (string \"1.0\"), summary, hook, setup, conflict, escalation, twist, payoff, theGag, cameraPattern, editingRhythm, soundPattern, retentionMechanism (all strings), characterInteractions and whyItWorks (arrays of strings). Write the analysis in Vietnamese. If evidence is missing, use a short honest explanation instead of inventing details.",
      input,
      videoAnalysisSchema,
      normalizeVideoAnalysis,
      videoAnalysisResponseSchema,
    );
  }
  generateIdeas(input: AIInput & { analysis: VideoAnalysis }) { return this.request("Generate exactly 3 to 5 original modeling directions. Keep the successful mechanism but change the execution; do not copy surface-level details, characters, setting, wording, or sequence. Return only JSON.", input, modelingIdeasSchema); }
  developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection }) { return this.request("Develop the approved idea and return only the structured content package JSON.", input, developedIdeaSchema); }
  async understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const systemPrompt = input.instruction ?? "Analyze this short-form competitor video. Do not propose a new idea yet. Return structured JSON with videoSummary, openingHook, timeline with MM:SS timestamps, characters, setting, visualGag, escalation, twist, payoff, cameraPattern, audioPattern, whyItLikelyWorks. Focus on observable evidence and distinguish evidence from inference.";
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ file_data: { file_uri: input.videoFileUri, mime_type: input.mimeType } }, { text: `${systemPrompt}\nChannel DNA context:\n${JSON.stringify(input.channelDNA ?? {})}` }] }], generationConfig: { responseMimeType: "application/json" } }) });
    if (!response.ok) throw new AIStructuredOutputError(this.name, { status: response.status, message: await readApiError(response) });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try { return visualBreakdownSchema.parse(parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "")); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  async reviewProject(input: FinalReviewInput): Promise<FinalReview> {
    return this.request("Review this draft content package. Do not rewrite it and do not generate a new package. Return only structured JSON listing missing details, continuity problems, ambiguities, prompt improvements, safety concerns, location, severity, and suggested corrections. The user will decide Apply or Ignore.", input, finalReviewSchema);
  }
  async validateAsset(input: AssetValidationInput): Promise<AssetValidation> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const prompt = "Validate this uploaded asset against the expected design. Return only JSON. AI may recommend APPROVED or NEEDS_REVISION, but do not make a user decision. Score characterMatch when relevant, styleMatch, and composition from 0 to 100. If the character is cut off or the scene lacks required space, report a concrete issue and suggestion.";
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ file_data: { file_uri: input.assetUri, mime_type: input.mimeType } }, { text: `${prompt}\nAsset type: ${input.assetType}\nExpected design: ${JSON.stringify(input.expectedDesign)}\nProject context: ${JSON.stringify(input.projectContext ?? {})}` }] }], generationConfig: { responseMimeType: "application/json" } }) });
    if (!response.ok) throw new AIStructuredOutputError(this.name, { status: response.status, message: await readApiError(response) });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try { return assetValidationSchema.parse(parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "")); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  private async request<T>(instruction: string, input: unknown, schema: { parse(value: unknown): T }, normalize?: (value: unknown) => unknown, responseSchema?: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;
    const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents: [{ parts: [{ text: `${instruction}\n${JSON.stringify(input)}` }] }], generationConfig: { responseMimeType: "application/json", ...(responseSchema ? { responseSchema } : {}) } }) });
    if (!response.ok) throw new AIStructuredOutputError(this.name, { status: response.status, message: await readApiError(response) });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      const parsed = parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
      return schema.parse(normalize ? normalize(parsed) : parsed);
    } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
}

async function readApiError(response: Response) {
  try {
    const body = await response.json() as { error?: { message?: string } };
    return body.error?.message ?? "Gemini API từ chối yêu cầu.";
  } catch {
    return "Gemini API từ chối yêu cầu.";
  }
}

const videoAnalysisResponseSchema: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "STRING" }, summary: { type: "STRING" }, hook: { type: "STRING" }, setup: { type: "STRING" }, conflict: { type: "STRING" }, escalation: { type: "STRING" }, twist: { type: "STRING" }, payoff: { type: "STRING" }, theGag: { type: "STRING" }, cameraPattern: { type: "STRING" }, editingRhythm: { type: "STRING" },
    characterInteractions: { type: "ARRAY", items: { type: "STRING" } }, soundPattern: { type: "STRING" }, retentionMechanism: { type: "STRING" }, whyItWorks: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["schemaVersion", "summary", "hook", "setup", "conflict", "escalation", "twist", "payoff", "theGag", "cameraPattern", "editingRhythm", "characterInteractions", "soundPattern", "retentionMechanism", "whyItWorks"],
};

function parseJsonText(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(trimmed); } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new Error("Gemini không trả về JSON.");
  }
}

function normalizeVideoAnalysis(value: unknown): unknown {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const text = (item: unknown, fallback = "Chưa có đủ dữ liệu để kết luận.") => {
    if (typeof item === "string") return item;
    if (item === undefined || item === null) return fallback;
    return typeof item === "object" ? JSON.stringify(item) : String(item);
  };
  const list = (item: unknown) => Array.isArray(item) ? item.map(entry => text(entry, "")) : item ? [text(item, "")] : [];
  return {
    schemaVersion: "1.0",
    summary: text(source.summary ?? source.videoSummary ?? source.overview),
    hook: text(source.hook ?? source.openingHook),
    setup: text(source.setup),
    conflict: text(source.conflict),
    escalation: text(source.escalation),
    twist: text(source.twist),
    payoff: text(source.payoff),
    theGag: text(source.theGag ?? source.visualGag),
    cameraPattern: text(source.cameraPattern),
    editingRhythm: text(source.editingRhythm),
    characterInteractions: list(source.characterInteractions ?? source.characters),
    soundPattern: text(source.soundPattern ?? source.audioPattern),
    retentionMechanism: text(source.retentionMechanism ?? source.whyItLikelyWorks),
    whyItWorks: list(source.whyItWorks ?? source.whyItLikelyWorks),
  };
}
