import { AIProviderNotConfiguredError, AIStructuredOutputError } from "./errors";
import { modelingIdeasSchema, videoAnalysisSchema } from "./schemas";
import { visualBreakdownSchema } from "./video-schemas";
import { finalReviewSchema } from "./review-schemas";
import { assetValidationSchema } from "./asset-schemas";
import type { AIInput, AIProvider, ModelingDirection, VideoAnalysis, VideoUnderstandingInput, VisualBreakdown, FinalReviewInput, FinalReview, AssetValidationInput, AssetValidation, DevelopedIdea } from "./types";

export class GeminiProvider implements AIProvider {
  readonly name = "gemini";
  constructor(
    private readonly apiKey = process.env.GEMINI_API_KEY,
    private readonly model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash",
    private readonly fallbackModel = process.env.GEMINI_FALLBACK_MODEL ?? "gemini-3.5-flash-lite",
  ) {}
  analyzeVideo(input: AIInput) {
    return this.request(
      "Analyze the video. Return exactly one JSON object, with no Markdown fences and no commentary. Use exactly these keys: schemaVersion (string \"1.0\"), summary, hook, setup, conflict, escalation, twist, payoff, theGag, cameraPattern, editingRhythm, soundPattern, retentionMechanism (all strings), characterInteractions and whyItWorks (arrays of strings). Write the analysis in Vietnamese. If evidence is missing, use a short honest explanation instead of inventing details.",
      input,
      videoAnalysisSchema,
      normalizeVideoAnalysis,
      videoAnalysisResponseSchema,
    );
  }
  generateIdeas(input: AIInput & { analysis: VideoAnalysis; artStyle?: string }) { return this.request(`Generate exactly ONE original modeling idea based on the source video's successful mechanism. Do not copy surface-level details, characters, setting, wording, or sequence. Return only JSON with one modelingDirections item containing title, coreConcept, script, characterDesign, setting, artStyle, sourceMechanism, whatIsPreserved, whatIsChanged, targetMarketAdaptation, similarityRisk, and whyWorthDeveloping. The selected art style is: ${input.artStyle ?? "Use the channel's existing art style"}. Write all content in Vietnamese.`, input, modelingIdeasSchema, normalizeModelingIdeas, modelingIdeasResponseSchema); }
  developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection; aspectRatio?: string }) { return this.request(`Develop this modeling idea into a production-ready package. Keep the same character identity and the same background continuity across every scene. Use the selected frame size ${input.aspectRatio ?? "9:16"}. Return only structured JSON with deconstruction, artDirection, characterDesign, backgroundDesign, storyboard, and safetyReview. In storyboard, write each scene clearly with visualBlock, actionBlock, audioBlock, and englishPrompt. The schemaVersion must be the string "1.0".`, input, { parse: (value: unknown) => normalizeDevelopedIdea(value) as DevelopedIdea }, normalizeDevelopedIdea); }
  async understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const systemPrompt = input.instruction ?? "Analyze this short-form competitor video. Do not propose a new idea yet. Return structured JSON with videoSummary, openingHook, timeline with MM:SS timestamps, characters, setting, visualGag, escalation, twist, payoff, cameraPattern, audioPattern, whyItLikelyWorks. Focus on observable evidence and distinguish evidence from inference.";
    const response = await this.generateContent({ contents: [{ parts: [{ file_data: { file_uri: input.videoFileUri, mime_type: input.mimeType } }, { text: `${systemPrompt}\nChannel DNA context:\n${JSON.stringify(input.channelDNA ?? {})}` }] }], generationConfig: { responseMimeType: "application/json" } });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try { return visualBreakdownSchema.parse(parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "")); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  async reviewProject(input: FinalReviewInput): Promise<FinalReview> {
    return this.request("Review this draft content package. Do not rewrite it and do not generate a new package. Return only structured JSON listing missing details, continuity problems, ambiguities, prompt improvements, safety concerns, location, severity, and suggested corrections. The user will decide Apply or Ignore.", input, finalReviewSchema);
  }
  async validateAsset(input: AssetValidationInput): Promise<AssetValidation> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const prompt = "Validate this uploaded asset against the expected design. Return only JSON. AI may recommend APPROVED or NEEDS_REVISION, but do not make a user decision. Score characterMatch when relevant, styleMatch, and composition from 0 to 100. If the character is cut off or the scene lacks required space, report a concrete issue and suggestion.";
    const response = await this.generateContent({ contents: [{ parts: [{ file_data: { file_uri: input.assetUri, mime_type: input.mimeType } }, { text: `${prompt}\nAsset type: ${input.assetType}\nExpected design: ${JSON.stringify(input.expectedDesign)}\nProject context: ${JSON.stringify(input.projectContext ?? {})}` }] }], generationConfig: { responseMimeType: "application/json" } });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try { return assetValidationSchema.parse(parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "")); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  async generateImage(prompt: string, aspectRatio: string) {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1/models/${process.env.GEMINI_IMAGE_MODEL ?? "gemini-3.1-flash-image"}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": this.apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${prompt}\nOutput aspect ratio: ${aspectRatio}.` }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }),
    });
    if (!response.ok) throw new AIStructuredOutputError(this.name, await readApiError(response));
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { mimeType?: string; data?: string } }> } }> };
    const image = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!image?.data) throw new AIStructuredOutputError(this.name, { message: "Gemini không trả về dữ liệu ảnh. Kiểm tra quyền truy cập model tạo ảnh của API key." });
    return { mimeType: image.mimeType ?? "image/png", data: image.data };
  }
  private async request<T>(instruction: string, input: unknown, schema: { parse(value: unknown): T }, normalize?: (value: unknown) => unknown, responseSchema?: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const response = await this.generateContent({ contents: [{ parts: [{ text: `${instruction}\n${JSON.stringify(input)}` }] }], generationConfig: { responseMimeType: "application/json", ...(responseSchema ? { responseSchema } : {}) } });
    const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    try {
      const parsed = parseJsonText(body.candidates?.[0]?.content?.parts?.[0]?.text ?? "");
      return schema.parse(normalize ? normalize(parsed) : parsed);
    } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
  private async generateContent(body: unknown): Promise<Response> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);

    const models = [...new Set([this.model, this.fallbackModel])];
    let lastError = { status: 503, message: "Gemini đang quá tải. App đã tự thử lại nhưng chưa nhận được phản hồi." };

    for (const [modelIndex, model] of models.entries()) {
      // Ưu tiên chuyển ngay sang model nhẹ hơn khi model chính báo quá tải.
      const attempts = modelIndex === 0 ? 1 : 3;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.apiKey}`;
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (response.ok) return response;

        const message = await readApiError(response);
        lastError = { status: response.status, message };
        if (!isTransientGeminiError(response.status)) {
          throw new AIStructuredOutputError(this.name, lastError);
        }
        if (attempt < attempts - 1) await delay(1_000 * (attempt + 1));
      }
    }

    throw new AIStructuredOutputError(this.name, lastError);
  }
}

function isTransientGeminiError(status: number) {
  return [429, 500, 502, 503, 504].includes(status);
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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

const modelingIdeasResponseSchema: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    schemaVersion: { type: "STRING" },
    modelingDirections: { type: "ARRAY", minItems: 1, maxItems: 1, items: { type: "OBJECT", properties: { title: { type: "STRING" }, coreConcept: { type: "STRING" }, script: { type: "STRING" }, characterDesign: { type: "STRING" }, setting: { type: "STRING" }, artStyle: { type: "STRING" }, sourceMechanism: { type: "STRING" }, whatIsPreserved: { type: "ARRAY", items: { type: "STRING" } }, whatIsChanged: { type: "ARRAY", items: { type: "STRING" } }, targetMarketAdaptation: { type: "STRING" }, similarityRisk: { type: "STRING" }, whyWorthDeveloping: { type: "STRING" } }, required: ["title", "coreConcept", "script", "characterDesign", "setting", "artStyle", "sourceMechanism", "whatIsPreserved", "whatIsChanged", "targetMarketAdaptation", "similarityRisk", "whyWorthDeveloping"] } },
  },
  required: ["schemaVersion", "modelingDirections"],
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

function normalizeModelingIdeas(value: unknown): unknown {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawDirections = Array.isArray(source.modelingDirections) ? source.modelingDirections : Array.isArray(source.ideas) ? source.ideas : [];
  const sourceItem = rawDirections[0] && typeof rawDirections[0] === "object" ? rawDirections[0] as Record<string, unknown> : {};
  const text = (...items: unknown[]) => {
    const item = items.find((candidate) => typeof candidate === "string" && candidate.trim());
    return typeof item === "string" ? item : "Chưa có đủ dữ liệu để kết luận.";
  };
  const list = (item: unknown) => Array.isArray(item) ? item.map((entry) => String(entry)) : [];
  return {
    schemaVersion: "1.0",
    modelingDirections: [{
      title: text(sourceItem.title, sourceItem.name),
      coreConcept: text(sourceItem.coreConcept, sourceItem.concept, sourceItem.idea),
      script: text(sourceItem.script, sourceItem.story, sourceItem.storyline),
      characterDesign: text(sourceItem.characterDesign, sourceItem.characters, sourceItem.character),
      setting: text(sourceItem.setting, sourceItem.background, sourceItem.environment),
      artStyle: text(sourceItem.artStyle, sourceItem.style),
      sourceMechanism: text(sourceItem.sourceMechanism, sourceItem.mechanism),
      whatIsPreserved: list(sourceItem.whatIsPreserved),
      whatIsChanged: list(sourceItem.whatIsChanged),
      targetMarketAdaptation: text(sourceItem.targetMarketAdaptation),
      similarityRisk: sourceItem.similarityRisk === "high" || sourceItem.similarityRisk === "medium" ? sourceItem.similarityRisk : "low",
      whyWorthDeveloping: text(sourceItem.whyWorthDeveloping, sourceItem.reason),
    }],
  };
}

function normalizeDevelopedIdea(value: unknown): unknown {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = raw.content && typeof raw.content === "object" ? raw.content as Record<string, unknown> : raw;
  const record = (item: unknown) => item && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : {};
  const text = (item: unknown, fallback: string) => typeof item === "string" && item.trim() ? item : fallback;
  const storyboard = Array.isArray(source.storyboard) ? source.storyboard.map((scene, index) => {
    const item = record(scene);
    const parsedNumber = typeof item.sceneNumber === "number" && Number.isFinite(item.sceneNumber) ? item.sceneNumber : index + 1;
    return {
      sceneNumber: parsedNumber > 0 ? Math.trunc(parsedNumber) : index + 1,
      visualBlock: text(item.visualBlock ?? item.visual ?? item.image, "Chưa có mô tả hình ảnh cho cảnh này."),
      actionBlock: text(item.actionBlock ?? item.action, "Chưa có mô tả hành động cho cảnh này."),
      audioBlock: text(item.audioBlock ?? item.audio, "Không có âm thanh đặc biệt."),
      englishPrompt: text(item.englishPrompt ?? item.prompt, "Create a consistent scene using the approved character and background designs."),
    };
  }) : [];
  return {
    schemaVersion: "1.0",
    deconstruction: record(source.deconstruction),
    artDirection: record(source.artDirection),
    characterDesign: record(source.characterDesign ?? source.characters),
    backgroundDesign: record(source.backgroundDesign ?? source.background),
    storyboard,
    safetyReview: record(source.safetyReview),
  };
}
