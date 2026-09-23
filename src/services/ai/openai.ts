import { z } from "zod";
import { AIProviderNotConfiguredError, AIStructuredOutputError } from "./errors";
import { developedIdeaSchema, modelingIdeasSchema, videoAnalysisSchema } from "./schemas";
import type { AIInput, AIProvider, ModelingDirection, VideoAnalysis, VideoUnderstandingInput, VisualBreakdown, FinalReviewInput, FinalReview, AssetValidationInput, AssetValidation } from "./types";
import { finalReviewSchema } from "./review-schemas";

const nullableString = { type: ["string", "null"] };
const sourceModelingSceneResponseSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    sourceSceneId: { type: "string" }, order: { type: "integer" }, sourceStartTime: { type: "number" }, sourceEndTime: { type: "number" }, duration: { type: "number" }, storyBeat: { type: "string" }, cameraType: { type: "string" }, shotSize: { type: "string" }, cameraAngle: { type: "string" }, cameraMovement: nullableString, framing: { type: "string" }, subjectPosition: { type: "string" }, poseOrientation: nullableString, gazeTarget: nullableString, relativeObjectPositions: { type: "array", items: { type: "string" } }, characterAction: { type: "string" }, actionSequence: { type: "array", items: { type: "string" } }, propAction: nullableString, startState: { type: "string" }, endState: { type: "string" }, transitionIn: { type: "string" }, transitionOut: { type: "string" }, timingNotes: { type: "string" }, rhythmNotes: { type: "string" }, mustPreserve: { type: "array", items: { type: "string" } }, allowedTransformations: { type: "array", items: { type: "string" } }, punchlineRole: nullableString, gagRole: nullableString, dialogueRole: nullableString, textRole: nullableString,
  },
  required: ["sourceSceneId", "order", "sourceStartTime", "sourceEndTime", "duration", "storyBeat", "cameraType", "shotSize", "cameraAngle", "cameraMovement", "framing", "subjectPosition", "poseOrientation", "gazeTarget", "relativeObjectPositions", "characterAction", "actionSequence", "propAction", "startState", "endState", "transitionIn", "transitionOut", "timingNotes", "rhythmNotes", "mustPreserve", "allowedTransformations", "punchlineRole", "gagRole", "dialogueRole", "textRole"],
};
const sourceModelingSpecResponseSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    specVersion: { type: "string" }, sourceVideoId: { type: "string" }, sourceVideoUrl: { type: "string" }, sourceVideoMetadata: { type: "object", additionalProperties: false, properties: { id: { type: "string" }, url: { type: "string" }, caption: nullableString, thumbnailUrl: nullableString, publishedAt: nullableString, duration: { type: ["number", "null"] }, platform: { type: "string" } }, required: ["id", "url", "caption", "thumbnailUrl", "publishedAt", "duration", "platform"] }, sourceDuration: { type: "number" }, sourcePlatform: nullableString, modelingPolicy: { type: "string", enum: ["STRICT_MODELING"] }, modelingFidelityTarget: { type: "number" }, timingTolerance: { type: "number" }, scenes: { type: "array", minItems: 1, items: sourceModelingSceneResponseSchema }, sourceEvidence: { type: "array", items: { type: "object", additionalProperties: false, properties: { timestamp: nullableString, description: nullableString, frameReference: nullableString }, required: ["timestamp", "description", "frameReference"] } },
  },
  required: ["specVersion", "sourceVideoId", "sourceVideoUrl", "sourceVideoMetadata", "sourceDuration", "sourcePlatform", "modelingPolicy", "modelingFidelityTarget", "timingTolerance", "scenes", "sourceEvidence"],
};

const developedIdeaResponseSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  properties: {
    schemaVersion: { type: "string", enum: ["1.0"] },
    deconstruction: { type: "object", additionalProperties: false, properties: { description: { type: "string" } }, required: ["description"] },
    artDirection: { type: "object", additionalProperties: false, properties: { description: { type: "string" } }, required: ["description"] },
    characterDesign: { type: "object", additionalProperties: false, properties: { description: { type: "string" } }, required: ["description"] },
    backgroundDesign: { type: "object", additionalProperties: false, properties: { description: { type: "string" } }, required: ["description"] },
    sourceModelingSpec: sourceModelingSpecResponseSchema,
    storyboard: {
      type: "array",
      minItems: 1,
      items: { type: "object", additionalProperties: false, properties: { sceneNumber: { type: "integer" }, sourceSceneId: { type: "string" }, sourceBeat: { type: "string" }, actionSequence: { type: "array", items: { type: "string" } }, cameraSpec: { type: "object", additionalProperties: false, properties: { cameraType: { type: "string" }, shotSize: { type: "string" }, cameraAngle: { type: "string" }, cameraMovement: nullableString, framing: { type: "string" }, subjectPosition: { type: "string" } }, required: ["cameraType", "shotSize", "cameraAngle", "cameraMovement", "framing", "subjectPosition"] }, spatialSpec: { type: "object", additionalProperties: false, properties: { subjectPosition: { type: "string" }, relativeObjectPositions: { type: "array", items: { type: "string" } } }, required: ["subjectPosition", "relativeObjectPositions"] }, startState: { type: "string" }, endState: { type: "string" }, targetDuration: { type: "number" }, visualBlock: { type: "string" }, actionBlock: { type: "string" }, audioBlock: { type: "string" }, startFramePrompt: { type: "string" }, englishPrompt: { type: "string" } }, required: ["sceneNumber", "sourceSceneId", "sourceBeat", "actionSequence", "cameraSpec", "spatialSpec", "startState", "endState", "targetDuration", "visualBlock", "actionBlock", "audioBlock", "startFramePrompt", "englishPrompt"] },
    },
    safetyReview: { type: "object", additionalProperties: false, properties: { description: { type: "string" } }, required: ["description"] },
  },
  required: ["schemaVersion", "deconstruction", "artDirection", "characterDesign", "backgroundDesign", "sourceModelingSpec", "storyboard", "safetyReview"],
};

export class OpenAIProvider implements AIProvider {
  readonly name = "openai";
  constructor(private readonly apiKey = process.env.OPENAI_API_KEY, private readonly model = process.env.OPENAI_MODEL ?? "gpt-4.1-mini") {}
  analyzeVideo(input: AIInput) { return this.request("Analyze the video and return only JSON matching the analysis schema.", input, videoAnalysisSchema, false); }
  generateIdeas(input: AIInput & { analysis: VideoAnalysis; artStyle?: string }) { return this.request(`Generate exactly ONE faithful modeling idea in Vietnamese. Preserve the source video's content, meaning, progression, event order, main action, character roles, key props, camera rhythm, gag, and ending. The only allowed differences are exactly: (1) background/environment appearance, (2) approved main-character identity reference, and (3) selected art/rendering style. Do not change the source story or add/remove/reorder beats, characters, props, actions, camera movement, timing, gag, or ending. If a main-character reference image is attached, inspect it before writing and use that exact recurring protagonist in every scene; never invent a replacement. Return one modelingDirections item with title, coreConcept, script, characterDesign, setting, artStyle, sourceMechanism, whatIsPreserved, whatIsChanged, targetMarketAdaptation, similarityRisk, whyWorthDeveloping, and postText. The script must use one primary action per scene and must not combine multiple sequential actions into one still image. postText must be a short ready-to-publish caption written in channelDNA.language, culturally suitable for channelDNA.targetCountry, based on the faithful adaptation, and must not contain hashtags. Selected art style: ${input.artStyle ?? "Use the channel's existing art style"}.`, input, modelingIdeasSchema); }
  developIdea(input: AIInput & { analysis: VideoAnalysis; idea: ModelingDirection; aspectRatio?: string }) { return this.request(`Develop this faithful modeling idea into a production-ready package in Vietnamese under STRICT_MODELING. First produce sourceModelingSpec from observable source-video evidence; do not invent timestamps, beats, camera or actions that are not supported by the source context. sourceModelingSpec must contain a version, source video identity/metadata, source duration, one ordered source scene per actual major scene/shot, exact source time bounds, storyBeat, cameraType, shotSize, cameraAngle, cameraMovement, framing, subjectPosition, relativeObjectPositions, characterAction, ordered actionSequence, startState, endState, transitions, timing/rhythm notes, mustPreserve and allowedTransformations. Preserve the source content, meaning, progression, event order, primary action, character roles, key props, camera rhythm, gag, and ending. The only allowed differences are exactly background/environment appearance, the approved main-character identity reference, and the selected art/rendering style. Do not add or remove a plot, character, prop, action, camera movement, timing change, gag or ending. If a main-character reference image is attached, inspect it before writing and preserve that exact protagonist in every scene; the same image will also be attached to Flow. Keep identity and continuity across scenes. Each scene must contain one clear primary action and fit a 4-second clip. Every storyboard scene must also return sourceSceneId, sourceBeat, actionSequence, cameraSpec, spatialSpec, startState, endState and targetDuration as structured evidence. For every scene, write two separate English production prompts: startFramePrompt for one frozen 9:16 starting image based on the initial state, approved character reference, and approved background; and englishPrompt for the 4-second video motion that starts from that image and preserves the source meaning, action order, gag, camera rhythm, and ending. Do not merge the still-image prompt into the video prompt. Selected frame size: ${input.aspectRatio ?? "9:16"}. Return only JSON matching the development schema with sourceModelingSpec, deconstruction, artDirection, characterDesign, backgroundDesign, storyboard, and safetyReview.`, input, developedIdeaSchema, true, true, developedIdeaResponseSchema); }
  async understandVideo(input: VideoUnderstandingInput): Promise<VisualBreakdown> { void input; throw new AIStructuredOutputError(this.name, "Video understanding trực tiếp dùng Gemini ở phase này."); }
  async reviewProject(input: FinalReviewInput): Promise<FinalReview> { return this.request("Review the draft package. Return issues and suggestions only; do not rewrite the package.", input, finalReviewSchema); }
  async validateAsset(input: AssetValidationInput): Promise<AssetValidation> { void input; throw new AIStructuredOutputError(this.name, "Asset visual validation dùng Gemini ở phase này."); }
  private async request<T>(instruction: string, input: unknown, schema: z.ZodType<T>, includeMainCharacterImage = true, strictSchema = true, responseSchema?: Record<string, unknown>): Promise<T> {
    if (!this.apiKey) throw new AIProviderNotConfiguredError(this.name);
    const source = input && typeof input === "object" ? input as Record<string, unknown> : {};
    const media = source.mainCharacterImage && typeof source.mainCharacterImage === "object" ? source.mainCharacterImage as { mimeType?: unknown; data?: unknown } : undefined;
    const context = { ...source };
    delete context.mainCharacterImage;
    const userContent: Array<Record<string, unknown>> = [{ type: "input_text", text: JSON.stringify(context) }];
    if (includeMainCharacterImage && typeof media?.mimeType === "string" && typeof media.data === "string" && media.data.length > 0) {
      userContent.push({ type: "input_image", image_url: `data:${media.mimeType};base64,${media.data}` });
    }
    const jsonSchema = responseSchema ?? z.toJSONSchema(schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const format = strictSchema
      ? { type: "json_schema", name: "structured_response", schema: jsonSchema, strict: true }
      : { type: "json_object" };
    const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` }, body: JSON.stringify({ model: this.model, input: [{ role: "system", content: [{ type: "input_text", text: instruction }] }, { role: "user", content: userContent }], text: { format } }) });
    const body = await response.json() as {
      output_text?: string;
      output?: Array<{ content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
      error?: { message?: string };
      status?: string;
    };
    if (!response.ok) throw new AIStructuredOutputError(this.name, { status: response.status, message: body.error?.message });
    const outputText = body.output_text ?? body.output
      ?.flatMap((item) => item.content ?? [])
      .filter((content) => content.type === "output_text" && typeof content.text === "string")
      .map((content) => content.text)
      .join("");
    if (!outputText) {
      const refusal = body.output?.flatMap((item) => item.content ?? []).find((content) => typeof content.refusal === "string")?.refusal;
      throw new AIStructuredOutputError(this.name, refusal || `OpenAI response không có output text (status: ${body.status ?? "unknown"}).`);
    }
    try { return schema.parse(JSON.parse(outputText)); } catch (error) { throw new AIStructuredOutputError(this.name, error); }
  }
}
