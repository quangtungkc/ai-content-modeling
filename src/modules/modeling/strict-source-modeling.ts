import { z } from "zod";

export const CANONICAL_DEFAULT_MODELING_POLICY = "STRICT_MODELING" as const;
export const CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET = 0.9 as const;
export const CANONICAL_DEFAULT_TIMING_TOLERANCE: number = 0.1;
export const CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS = [
  "approved main character identity reference",
  "background/environment",
  "selected art/rendering style",
] as const;
export const CANONICAL_MODELING_DIFFERENCE_POLICY = [
  "CONTENT AND PROGRESSION LOCK: preserve the source video's content, story meaning, scene count and order, major beats, action order, character roles, key props, camera intent, timing/rhythm, gag and ending.",
  "ALLOWED DIFFERENCE 1 — MAIN CHARACTER: use only the approved main character identity reference/Character Identity Pack; preserve the protagonist's role, number, pose, action, continuity and spatial logic.",
  "ALLOWED DIFFERENCE 2 — BACKGROUND/ENVIRONMENT: redesign the background or environment appearance only; preserve source spatial relationships, composition, prop logic and action affordances.",
  "ALLOWED DIFFERENCE 3 — ART/RENDERING STYLE: apply the selected art or rendering style only; do not change the source meaning, action, camera, timing, gag or ending.",
] as const;

export function assertStrictModelingIdeaChangeScope(direction: { whatIsChanged?: unknown }) {
  const changes = Array.isArray(direction.whatIsChanged)
    ? direction.whatIsChanged.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];
  if (changes.length !== 3) throw new StrictModelingError("STRICT_MODELING_ILLEGAL_CHANGE_SCOPE", "whatIsChanged phải chỉ có đúng ba khác biệt được phép: bối cảnh, nhân vật chính và phong cách mỹ thuật.", { changes });
  const categories = changes.map((item) => {
    const value = item.toLocaleLowerCase("vi");
    if (/bối cảnh|môi trường|background|environment|nền/.test(value)) return "environment";
    if (/nhân vật|character|identity|nhận diện/.test(value)) return "character";
    if (/phong cách|mỹ thuật|rendering|art style|visual style/.test(value)) return "style";
    return "illegal";
  });
  if (categories.includes("illegal") || new Set(categories).size !== 3) {
    throw new StrictModelingError("STRICT_MODELING_ILLEGAL_CHANGE_SCOPE", "Modeling idea đang cho phép thay đổi đạo cụ, vật thể hoặc diễn biến ngoài phạm vi strict.", { changes });
  }
}
export const MODELING_POLICIES = [CANONICAL_DEFAULT_MODELING_POLICY, "BALANCED_MODELING", "LOOSE_ADAPTATION"] as const;
export const modelingPolicySchema = z.enum(MODELING_POLICIES);
export type ModelingPolicy = z.infer<typeof modelingPolicySchema>;

const nonEmptyString = z.string().trim().min(1);
const positiveNumber = z.number().finite().positive();

export const sourceModelingEvidenceItemSchema = z.object({
  timestamp: z.string().nullable(),
  description: z.string().nullable(),
  frameReference: z.string().nullable(),
}).strict();
export const sourceModelingEvidenceSchema = z.array(sourceModelingEvidenceItemSchema).default([]);

const sourceModelingSceneBaseSchema = z.object({
  sourceSceneId: nonEmptyString,
  order: z.number().int().positive(),
  sourceStartTime: z.number().finite().nonnegative(),
  sourceEndTime: positiveNumber,
  duration: positiveNumber,
  storyBeat: nonEmptyString,
  cameraType: nonEmptyString,
  shotSize: nonEmptyString,
  cameraAngle: nonEmptyString,
  cameraMovement: z.string().trim().nullable().default(null),
  framing: nonEmptyString,
  subjectPosition: nonEmptyString,
  poseOrientation: z.string().trim().nullable().default(null),
  gazeTarget: z.string().trim().nullable().default(null),
  relativeObjectPositions: z.array(nonEmptyString).default([]),
  characterAction: nonEmptyString,
  actionSequence: z.array(nonEmptyString).min(1),
  propAction: z.string().trim().nullable().default(null),
  startState: nonEmptyString,
  endState: nonEmptyString,
  transitionIn: nonEmptyString,
  transitionOut: nonEmptyString,
  timingNotes: nonEmptyString,
  rhythmNotes: nonEmptyString,
  mustPreserve: z.array(nonEmptyString).min(1),
  allowedTransformations: z.array(nonEmptyString).default([]),
  punchlineRole: z.string().trim().nullable().default(null),
  gagRole: z.string().trim().nullable().default(null),
  dialogueRole: z.string().trim().nullable().default(null),
  textRole: z.string().trim().nullable().default(null),
});
export const sourceModelingSceneSchema = sourceModelingSceneBaseSchema.superRefine((scene, context) => {
  if (scene.sourceEndTime <= scene.sourceStartTime) context.addIssue({ code: "custom", path: ["sourceEndTime"], message: "sourceEndTime phải lớn hơn sourceStartTime." });
  if (Math.abs(scene.duration - (scene.sourceEndTime - scene.sourceStartTime)) > 0.05) context.addIssue({ code: "custom", path: ["duration"], message: "duration phải khớp khoảng thời gian source scene." });
});

export type SourceModelingScene = z.infer<typeof sourceModelingSceneSchema>;

const sourceModelingSpecBaseSchema = z.object({
  specVersion: nonEmptyString,
  sourceVideoId: nonEmptyString,
  sourceVideoUrl: z.string().url(),
  sourceVideoMetadata: z.record(z.string(), z.unknown()),
  sourceDuration: positiveNumber,
  sourcePlatform: z.string().trim().nullable().default(null),
  modelingPolicy: modelingPolicySchema.default(CANONICAL_DEFAULT_MODELING_POLICY),
  modelingFidelityTarget: z.number().finite().min(CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET).max(1).default(CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET),
  timingTolerance: z.number().finite().positive().max(0.5).default(CANONICAL_DEFAULT_TIMING_TOLERANCE),
  scenes: z.array(sourceModelingSceneSchema).min(1),
  sourceEvidence: sourceModelingEvidenceSchema,
  createdAt: z.string().datetime().optional(),
});
export const sourceModelingSpecSchema = sourceModelingSpecBaseSchema.superRefine((spec, context) => {
  const orders = spec.scenes.map((scene) => scene.order);
  const ids = spec.scenes.map((scene) => scene.sourceSceneId);
  if (new Set(orders).size !== orders.length || orders.some((order, index) => order !== index + 1)) context.addIssue({ code: "custom", path: ["scenes"], message: "source scene order phải duy nhất và liên tục." });
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["scenes"], message: "sourceSceneId phải duy nhất." });
});

export type SourceVideoModelingSpec = z.infer<typeof sourceModelingSpecSchema>;

export const CANONICAL_SPEC_VERSION = "1.0.0" as const;

export type SourceModelingSpecAssembly = {
  candidate: Record<string, unknown>;
  geminiSpecVersion: unknown;
  geminiSourceVideoId: unknown;
  geminiSourceVideoUrl: unknown;
  geminiSourceVideoMetadata: unknown;
  geminiSourceDuration: unknown;
  geminiSourcePlatform: unknown;
  geminiModelingPolicy: unknown;
  geminiModelingFidelityTarget: unknown;
  geminiTimingTolerance: unknown;
  geminiSourceEvidence: unknown;
  metadataMismatch: MetadataMismatch | null;
  metadataMismatches: MetadataMismatch[];
  canonicalizationApplied: boolean;
  canonicalizedFields: string[];
  canonicalizationChanges: SourceModelingSpecCanonicalizationChange[];
};

export type SourceModelingSpecCanonicalizationChange = { path: string; originalType: "string"; canonicalType: "array" };

const CANONICALIZABLE_SCENE_LIST_FIELDS = ["mustPreserve", "allowedTransformations"] as const;

export function canonicalizeSourceModelingSpec(input: unknown): { candidate: Record<string, unknown>; applied: boolean; fields: string[]; changes: SourceModelingSpecCanonicalizationChange[] } {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const candidate: Record<string, unknown> = { ...source };
  const changes: SourceModelingSpecCanonicalizationChange[] = [];
  if (Array.isArray(source.scenes)) {
    candidate.scenes = source.scenes.map((scene, sceneIndex) => {
      if (!scene || typeof scene !== "object" || Array.isArray(scene)) return scene;
      const canonicalScene = { ...(scene as Record<string, unknown>) };
      for (const field of CANONICALIZABLE_SCENE_LIST_FIELDS) {
        const value = canonicalScene[field];
        if (typeof value === "string" && value.trim()) {
          canonicalScene[field] = [value.trim()];
          changes.push({ path: `scenes[${sceneIndex}].${field}`, originalType: "string", canonicalType: "array" });
        }
      }
      return canonicalScene;
    });
  }
  return { candidate, applied: changes.length > 0, fields: changes.map((change) => change.path), changes };
}

type MetadataMismatch = { field: "specVersion" | "sourceVideoId" | "sourceVideoUrl" | "sourceVideoMetadata" | "sourceDuration" | "sourcePlatform" | "modelingPolicy" | "modelingFidelityTarget" | "timingTolerance"; expected: unknown; received: unknown };

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => deepEqual(value, right[index]));
  if (left && right && typeof left === "object" && typeof right === "object") {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return leftKeys.length === rightKeys.length && leftKeys.every((key, index) => key === rightKeys[index] && deepEqual(leftRecord[key], rightRecord[key]));
  }
  return false;
}

export function assembleSourceModelingSpec(input: unknown, authoritative: { sourceVideoId?: unknown; sourceVideoUrl?: unknown; sourceVideoMetadata?: unknown; sourceDuration?: unknown; sourcePlatform?: unknown; modelingPolicy?: unknown; modelingFidelityTarget?: unknown; timingTolerance?: unknown; alternateSourceDuration?: { value?: unknown; source?: string; sourceVideoId?: string } | null } = {}): SourceModelingSpecAssembly {
  const hasAuthoritativeSourceVideoId = Object.prototype.hasOwnProperty.call(authoritative, "sourceVideoId");
  const hasAuthoritativeSourceVideoUrl = Object.prototype.hasOwnProperty.call(authoritative, "sourceVideoUrl");
  const hasAuthoritativeSourceVideoMetadata = Object.prototype.hasOwnProperty.call(authoritative, "sourceVideoMetadata");
  const hasAuthoritativeSourceDuration = Object.prototype.hasOwnProperty.call(authoritative, "sourceDuration");
  const hasAuthoritativeSourcePlatform = Object.prototype.hasOwnProperty.call(authoritative, "sourcePlatform");
  const hasAuthoritativeModelingPolicy = Object.prototype.hasOwnProperty.call(authoritative, "modelingPolicy");
  if (hasAuthoritativeSourceVideoId && (typeof authoritative.sourceVideoId !== "string" || !authoritative.sourceVideoId.trim())) throw new StrictModelingError("SOURCE_VIDEO_ID_NOT_AVAILABLE", "Không có sourceVideoId authoritative để lắp ráp SourceVideoModelingSpec.");
  if (hasAuthoritativeSourceVideoUrl && (typeof authoritative.sourceVideoUrl !== "string" || !authoritative.sourceVideoUrl.trim())) throw new StrictModelingError("SOURCE_VIDEO_URL_NOT_AVAILABLE", "Không có sourceVideoUrl authoritative để lắp ráp SourceVideoModelingSpec.");
  if (hasAuthoritativeSourceVideoMetadata && (!authoritative.sourceVideoMetadata || typeof authoritative.sourceVideoMetadata !== "object" || Array.isArray(authoritative.sourceVideoMetadata))) throw new StrictModelingError("SOURCE_VIDEO_METADATA_NOT_AVAILABLE", "Không có sourceVideoMetadata authoritative để lắp ráp SourceVideoModelingSpec.");
  if (hasAuthoritativeSourcePlatform && authoritative.sourcePlatform !== null && (typeof authoritative.sourcePlatform !== "string" || !authoritative.sourcePlatform.trim())) throw new StrictModelingError("SOURCE_PLATFORM_NOT_AVAILABLE", "Không có sourcePlatform authoritative để lắp ráp SourceVideoModelingSpec.");
  const authoritativeModelingPolicy = hasAuthoritativeModelingPolicy ? authoritative.modelingPolicy : CANONICAL_DEFAULT_MODELING_POLICY;
  if (!MODELING_POLICIES.includes(authoritativeModelingPolicy as typeof MODELING_POLICIES[number])) throw new StrictModelingError("INVALID_MODELING_POLICY", "modelingPolicy application không thuộc enum canonical.");
  const authoritativeModelingFidelityTarget = authoritative.modelingFidelityTarget === undefined ? CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET : authoritative.modelingFidelityTarget;
  if (typeof authoritativeModelingFidelityTarget !== "number" || !Number.isFinite(authoritativeModelingFidelityTarget) || authoritativeModelingFidelityTarget < CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET || authoritativeModelingFidelityTarget > 1) throw new StrictModelingError("INVALID_MODELING_FIDELITY_TARGET", "modelingFidelityTarget application phải là số hữu hạn trong khoảng 0.9 đến 1.0.");
  const authoritativeTimingTolerance = authoritative.timingTolerance === undefined ? CANONICAL_DEFAULT_TIMING_TOLERANCE : authoritative.timingTolerance;
  if (typeof authoritativeTimingTolerance !== "number" || !Number.isFinite(authoritativeTimingTolerance) || authoritativeTimingTolerance <= 0 || authoritativeTimingTolerance > 0.5) throw new StrictModelingError("INVALID_TIMING_TOLERANCE", "timingTolerance application phải là số hữu hạn lớn hơn 0 và không vượt quá 0.5.");
  const directDuration = authoritative.sourceDuration;
  const alternateIsBoundToSource = !hasAuthoritativeSourceVideoId || authoritative.alternateSourceDuration?.sourceVideoId === authoritative.sourceVideoId;
  const alternateDuration = alternateIsBoundToSource ? authoritative.alternateSourceDuration?.value : undefined;
  const validDuration = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
  const effectiveSourceDuration = validDuration(directDuration) ? directDuration : validDuration(alternateDuration) ? alternateDuration : undefined;
  if (hasAuthoritativeSourceDuration && effectiveSourceDuration === undefined) throw new StrictModelingError("SOURCE_VIDEO_DURATION_NOT_AVAILABLE", "Không có sourceDuration authoritative để lắp ráp SourceVideoModelingSpec.");
  const rawCandidate = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>) } : {};
  const geminiSpecVersion = rawCandidate.specVersion;
  const geminiSourceVideoId = rawCandidate.sourceVideoId;
  const geminiSourceVideoUrl = rawCandidate.sourceVideoUrl;
  const geminiSourceVideoMetadata = rawCandidate.sourceVideoMetadata;
  const geminiSourceDuration = rawCandidate.sourceDuration;
  const geminiSourcePlatform = rawCandidate.sourcePlatform;
  const geminiModelingPolicy = rawCandidate.modelingPolicy;
  const geminiModelingFidelityTarget = rawCandidate.modelingFidelityTarget;
  const geminiTimingTolerance = rawCandidate.timingTolerance;
  const geminiSourceEvidence = rawCandidate.sourceEvidence;
  const canonicalization = canonicalizeSourceModelingSpec(rawCandidate);
  const candidate = canonicalization.candidate;
  const sourceVideoId = hasAuthoritativeSourceVideoId ? authoritative.sourceVideoId as string : geminiSourceVideoId;
  const sourceVideoUrl = hasAuthoritativeSourceVideoUrl ? authoritative.sourceVideoUrl as string : geminiSourceVideoUrl;
  const sourceVideoMetadata = hasAuthoritativeSourceVideoMetadata ? authoritative.sourceVideoMetadata : geminiSourceVideoMetadata;
  const metadataMismatch: MetadataMismatch[] = [];
  if (geminiSpecVersion !== undefined && geminiSpecVersion !== CANONICAL_SPEC_VERSION) metadataMismatch.push({ field: "specVersion", expected: CANONICAL_SPEC_VERSION, received: geminiSpecVersion });
  if (hasAuthoritativeSourceVideoId && geminiSourceVideoId !== undefined && geminiSourceVideoId !== authoritative.sourceVideoId) metadataMismatch.push({ field: "sourceVideoId", expected: authoritative.sourceVideoId as string, received: geminiSourceVideoId });
  if (hasAuthoritativeSourceVideoUrl && geminiSourceVideoUrl !== undefined && geminiSourceVideoUrl !== authoritative.sourceVideoUrl) metadataMismatch.push({ field: "sourceVideoUrl", expected: authoritative.sourceVideoUrl as string, received: geminiSourceVideoUrl });
  if (hasAuthoritativeSourceVideoMetadata && geminiSourceVideoMetadata !== undefined && !deepEqual(geminiSourceVideoMetadata, authoritative.sourceVideoMetadata)) metadataMismatch.push({ field: "sourceVideoMetadata", expected: authoritative.sourceVideoMetadata, received: geminiSourceVideoMetadata });
  if (hasAuthoritativeSourceDuration && geminiSourceDuration !== undefined && !Object.is(geminiSourceDuration, effectiveSourceDuration)) metadataMismatch.push({ field: "sourceDuration", expected: effectiveSourceDuration, received: geminiSourceDuration });
  if (hasAuthoritativeSourcePlatform && geminiSourcePlatform !== undefined && !Object.is(geminiSourcePlatform, authoritative.sourcePlatform)) metadataMismatch.push({ field: "sourcePlatform", expected: authoritative.sourcePlatform, received: geminiSourcePlatform });
  if (geminiModelingPolicy !== undefined && !Object.is(geminiModelingPolicy, authoritativeModelingPolicy)) metadataMismatch.push({ field: "modelingPolicy", expected: authoritativeModelingPolicy, received: geminiModelingPolicy });
  if (geminiModelingFidelityTarget !== undefined && !Object.is(geminiModelingFidelityTarget, authoritativeModelingFidelityTarget)) metadataMismatch.push({ field: "modelingFidelityTarget", expected: authoritativeModelingFidelityTarget, received: geminiModelingFidelityTarget });
  if (geminiTimingTolerance !== undefined && !Object.is(geminiTimingTolerance, authoritativeTimingTolerance)) metadataMismatch.push({ field: "timingTolerance", expected: authoritativeTimingTolerance, received: geminiTimingTolerance });
  const metadataDuration = hasAuthoritativeSourceVideoMetadata && authoritative.sourceVideoMetadata && typeof authoritative.sourceVideoMetadata === "object" ? (authoritative.sourceVideoMetadata as Record<string, unknown>).duration : undefined;
  if (hasAuthoritativeSourceDuration && validDuration(metadataDuration) && metadataDuration !== effectiveSourceDuration) throw new StrictModelingError("SOURCE_VIDEO_DURATION_METADATA_MISMATCH", "sourceVideoMetadata.duration không nhất quán với sourceDuration authoritative.");
  return {
    candidate: { ...candidate, specVersion: CANONICAL_SPEC_VERSION, ...(hasAuthoritativeSourceVideoId ? { sourceVideoId } : {}), ...(hasAuthoritativeSourceVideoUrl ? { sourceVideoUrl } : {}), ...(hasAuthoritativeSourceVideoMetadata ? { sourceVideoMetadata } : {}), ...(hasAuthoritativeSourceDuration ? { sourceDuration: effectiveSourceDuration } : {}), ...(hasAuthoritativeSourcePlatform ? { sourcePlatform: authoritative.sourcePlatform === undefined ? null : authoritative.sourcePlatform } : {}), modelingPolicy: authoritativeModelingPolicy, modelingFidelityTarget: authoritativeModelingFidelityTarget, timingTolerance: authoritativeTimingTolerance },
    geminiSpecVersion,
    geminiSourceVideoId,
    geminiSourceVideoUrl,
    geminiSourceVideoMetadata,
    geminiSourceDuration,
    geminiSourcePlatform,
    geminiModelingPolicy,
    geminiModelingFidelityTarget,
    geminiTimingTolerance,
    geminiSourceEvidence,
    metadataMismatch: metadataMismatch[0] ?? null,
    metadataMismatches: metadataMismatch,
    canonicalizationApplied: canonicalization.applied,
    canonicalizedFields: canonicalization.fields,
    canonicalizationChanges: canonicalization.changes,
  };
}

export type GeneratedSceneForMapping = {
  sceneNumber: number;
  sourceSceneId?: string | null;
  targetDuration?: number | null;
};

export type GeneratedSceneMapping = GeneratedSceneForMapping & {
  sourceSceneId: string;
  sourceSceneOrder: number;
  sourceSceneStartTime: number;
  sourceSceneEndTime: number;
  sourceDuration: number;
  targetDuration: number;
  durationDelta: number;
  durationRatio: number;
  timingStatus: "PASS" | "SOURCE_TIMING_DRIFT";
  cameraSpec: Pick<SourceModelingScene, "cameraType" | "shotSize" | "cameraAngle" | "cameraMovement" | "framing" | "subjectPosition">;
  actionSequence: string[];
  spatialSpec: { subjectPosition: string; relativeObjectPositions: string[] };
  mustPreserve: string[];
  allowedTransformations: string[];
};

export type StrictModelingSetupInput = {
  sourceVideoId?: unknown;
  sourceVideoUrl?: unknown;
  sourceDuration?: unknown;
  modelingPolicy?: unknown;
  sourceModelingSpec?: unknown;
  generatedScenes?: GeneratedSceneForMapping[];
};

export type StrictModelingSetupResult = {
  ok: boolean;
  errors: string[];
  spec?: SourceVideoModelingSpec;
  mappings?: GeneratedSceneMapping[];
};

export class StrictModelingError extends Error {
  constructor(public readonly code: string, message = code, public readonly details?: unknown) {
    super(message === code ? code : `${code}: ${message}`);
    this.name = "StrictModelingError";
  }
}

export function buildSourceVideoModelingSpec(input: z.input<typeof sourceModelingSpecSchema>): SourceVideoModelingSpec {
  return sourceModelingSpecSchema.parse({
    ...input,
    modelingPolicy: input.modelingPolicy ?? CANONICAL_DEFAULT_MODELING_POLICY,
    modelingFidelityTarget: input.modelingFidelityTarget ?? CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET,
    timingTolerance: input.timingTolerance ?? CANONICAL_DEFAULT_TIMING_TOLERANCE,
  });
}

export function validateGeneratedSceneMapping(spec: SourceVideoModelingSpec, generatedScenes: GeneratedSceneForMapping[]): GeneratedSceneMapping[] {
  const sourceScenes = [...spec.scenes].sort((left, right) => left.order - right.order);
  const orderedGenerated = [...generatedScenes].sort((left, right) => left.sceneNumber - right.sceneNumber);
  if (orderedGenerated.length !== sourceScenes.length) {
    throw new StrictModelingError("SOURCE_SCENE_ORDER_MISMATCH", "Số phân cảnh generated phải trùng số source scene trong STRICT_MODELING.", { sourceCount: sourceScenes.length, generatedCount: orderedGenerated.length });
  }
  const expectedSceneNumbers = orderedGenerated.map((scene) => scene.sceneNumber);
  if (expectedSceneNumbers.some((number, index) => number !== index + 1)) {
    throw new StrictModelingError("SOURCE_SCENE_ORDER_MISMATCH", "Scene generated phải liên tục và giữ đúng thứ tự source.", { sceneNumbers: expectedSceneNumbers });
  }
  return orderedGenerated.map((generated, index) => {
    const source = sourceScenes[index];
    if (generated.sourceSceneId && generated.sourceSceneId !== source.sourceSceneId) {
      throw new StrictModelingError("SOURCE_SCENE_MAPPING_MISSING", `Cảnh ${generated.sceneNumber} đang trỏ sai sourceSceneId.`);
    }
    const targetDuration = generated.targetDuration ?? 4;
    const timing = computeTimingFidelity(source.duration, targetDuration, spec.timingTolerance);
    return {
      ...generated,
      sourceSceneId: source.sourceSceneId,
      sourceSceneOrder: source.order,
      sourceSceneStartTime: source.sourceStartTime,
      sourceSceneEndTime: source.sourceEndTime,
      sourceDuration: source.duration,
      targetDuration,
      durationDelta: timing.durationDelta,
      durationRatio: timing.durationRatio,
      timingStatus: timing.status,
      cameraSpec: {
        cameraType: source.cameraType,
        shotSize: source.shotSize,
        cameraAngle: source.cameraAngle,
        cameraMovement: source.cameraMovement,
        framing: source.framing,
        subjectPosition: source.subjectPosition,
      },
      actionSequence: source.actionSequence,
      spatialSpec: { subjectPosition: source.subjectPosition, relativeObjectPositions: source.relativeObjectPositions },
      mustPreserve: source.mustPreserve,
      allowedTransformations: source.allowedTransformations,
    };
  });
}

export function computeTimingFidelity(sourceDuration: number, targetDuration: number, tolerance = CANONICAL_DEFAULT_TIMING_TOLERANCE) {
  const durationDelta = targetDuration - sourceDuration;
  const durationRatio = targetDuration / sourceDuration;
  return { durationDelta, durationRatio, status: Math.abs(durationRatio - 1) <= tolerance ? "PASS" as const : "SOURCE_TIMING_DRIFT" as const };
}

export function validateStrictModelingSetup(input: StrictModelingSetupInput): StrictModelingSetupResult {
  const errors: string[] = [];
  if (typeof input.sourceVideoId !== "string" || !input.sourceVideoId.trim() || typeof input.sourceVideoUrl !== "string" || !input.sourceVideoUrl.trim() || typeof input.sourceDuration !== "number" || !Number.isFinite(input.sourceDuration) || input.sourceDuration <= 0) errors.push("STRICT_SOURCE_VIDEO_MISSING");
  if (input.modelingPolicy !== undefined && input.modelingPolicy !== "STRICT_MODELING") errors.push("STRICT_MODELING_POLICY_REQUIRED");
  if (input.sourceModelingSpec === null || input.sourceModelingSpec === undefined) errors.push("SOURCE_MODELING_SPEC_MISSING");
  let spec: SourceVideoModelingSpec | undefined;
  if (input.sourceModelingSpec !== null && input.sourceModelingSpec !== undefined) {
    const parsed = sourceModelingSpecSchema.safeParse(input.sourceModelingSpec);
    if (!parsed.success) {
      const issueCodes = parsed.error.issues.map((issue) => {
        const path = issue.path.map(String);
        if (path.includes("storyBeat")) return "SOURCE_BEAT_MISSING";
        if (path.includes("sourceSceneId")) return "SOURCE_SCENE_MAPPING_MISSING";
        if (path[0] === "scenes" && issue.message.includes("order")) return "SOURCE_SCENE_ORDER_MISMATCH";
        return "SOURCE_MODELING_SPEC_MISSING";
      });
      errors.push(...issueCodes);
    }
    else {
      spec = parsed.data;
      if (spec.modelingPolicy !== "STRICT_MODELING") errors.push("STRICT_MODELING_POLICY_REQUIRED");
      if (spec.modelingFidelityTarget < CANONICAL_DEFAULT_MODELING_FIDELITY_TARGET) errors.push("MODELING_FIDELITY_TARGET_TOO_LOW");
      if (typeof input.sourceVideoId === "string" && spec.sourceVideoId !== input.sourceVideoId) errors.push("SOURCE_VIDEO_MISMATCH");
    }
  }
  let mappings: GeneratedSceneMapping[] | undefined;
  if (!errors.length && spec && input.generatedScenes) {
    try { mappings = validateGeneratedSceneMapping(spec, input.generatedScenes); }
    catch (error) { errors.push(error instanceof StrictModelingError ? error.code : "SOURCE_SCENE_MAPPING_MISSING"); }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], spec, mappings };
}

export function assertStrictModelingReady(input: StrictModelingSetupInput): SourceVideoModelingSpec {
  const result = validateStrictModelingSetup(input);
  if (!result.ok || !result.spec) throw new StrictModelingError(result.errors[0] ?? "SOURCE_MODELING_SPEC_MISSING", "STRICT_MODELING chưa đủ source video/spec/mapping.", result.errors);
  return result.spec;
}

export function compileStrictModelingConstraints(spec: SourceVideoModelingSpec, sourceSceneId?: string) {
  const scene = sourceSceneId ? spec.scenes.find((item) => item.sourceSceneId === sourceSceneId) : undefined;
  const lines = [
    "SOURCE MODELING MODE: STRICT_MODELING",
    `SOURCE VIDEO: ${spec.sourceVideoId} (${spec.sourceVideoUrl})`,
    `TARGET SOURCE FIDELITY: ${Math.round(spec.modelingFidelityTarget * 100)}–100% for structure, motion, camera and rhythm`,
    "MUST PRESERVE: scene order, major beats, shot purpose, camera intent, framing, action order, spatial relationships, prop logic, start/end state, transition intent and source timing/rhythm.",
    `ALLOWED TRANSFORMATIONS ONLY: ${CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS.join("; ")}`,
    ...CANONICAL_MODELING_DIFFERENCE_POLICY,
    "FORBIDDEN MODELING CHANGES: do not change source content, progression, scene count/order, action order, character roles, key props, camera intent, timing/rhythm, gag or ending. Do not add, remove, reorder or merge beats; do not use equivalent props, localization or unrelated setting changes as extra permissions.",
    "DO NOT silently downgrade to BALANCED_MODELING or LOOSE_ADAPTATION. Do not invent, add, remove or reorder scenes/beats.",
  ];
  if (scene) lines.push(`SOURCE SCENE ${scene.order} (${scene.sourceSceneId}) ${scene.sourceStartTime}s–${scene.sourceEndTime}s: ${scene.storyBeat}`, `CAMERA: ${JSON.stringify(scene.cameraType)} / ${scene.shotSize} / ${scene.cameraAngle} / ${scene.cameraMovement ?? "none"}`, `FRAMING/SPATIAL: ${scene.framing}; subject=${scene.subjectPosition}; pose=${scene.poseOrientation ?? "not specified"}; gaze=${scene.gazeTarget ?? "not specified"}; objects=${scene.relativeObjectPositions.join("; ") || "none"}`, `ACTION SEQUENCE (authoritative): ${scene.actionSequence.map((action, index) => `${index + 1}. ${action}`).join(" ")}`, `START → END: ${scene.startState} → ${scene.endState}`, `TIMING/RHYTHM: ${scene.timingNotes}; ${scene.rhythmNotes}`);
  return lines.join("\n");
}

export function buildStrictSceneExpectedState(spec: SourceVideoModelingSpec, sourceSceneId: string) {
  const scene = spec.scenes.find((item) => item.sourceSceneId === sourceSceneId);
  if (!scene) throw new StrictModelingError("SOURCE_SCENE_MAPPING_MISSING", `Không tìm thấy source scene ${sourceSceneId}.`);
  return { sourceSceneId: scene.sourceSceneId, sourceSceneOrder: scene.order, storyBeat: scene.storyBeat, camera: { type: scene.cameraType, shotSize: scene.shotSize, angle: scene.cameraAngle, movement: scene.cameraMovement, framing: scene.framing, subjectPosition: scene.subjectPosition }, actionSequence: scene.actionSequence, spatial: { subjectPosition: scene.subjectPosition, poseOrientation: scene.poseOrientation, gazeTarget: scene.gazeTarget, relativeObjectPositions: scene.relativeObjectPositions }, startState: scene.startState, endState: scene.endState, transitionIn: scene.transitionIn, transitionOut: scene.transitionOut, timingNotes: scene.timingNotes, rhythmNotes: scene.rhythmNotes, mustPreserve: scene.mustPreserve, allowedTransformations: [...CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS] };
}
