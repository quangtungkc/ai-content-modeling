import type { GeneratedSceneMapping, SourceModelingScene, SourceVideoModelingSpec } from "@/modules/modeling/strict-source-modeling";

export const SOURCE_VALIDATION_STAGES = ["STORYBOARD", "START_FRAME", "SCENE_VIDEO", "FINAL_VIDEO"] as const;
export type SourceValidationStage = typeof SOURCE_VALIDATION_STAGES[number];
export type SourceValidationStatus = "PASS" | "FAIL" | "NOT_EVALUATED" | "ERROR";

export type SourceValidationContext = {
  projectId: string;
  sourceVideoId: string;
  sourceVideoPath?: string | null;
  sourceVideoUrl?: string | null;
  sourceModelingSpecVersion: string;
  sourceSpec: SourceVideoModelingSpec;
  generatedSceneId?: string | null;
  sourceSceneId?: string | null;
  sourceStartTime?: number | null;
  sourceEndTime?: number | null;
  sourceEvidence?: unknown[];
  sourceFrameReferences?: string[];
  mustPreserve: string[];
  allowedTransformations: string[];
  characterIdentityPack?: unknown;
  generatedAssetPath?: string | null;
  generatedAssetType?: "STORYBOARD" | "START_FRAME" | "SCENE_VIDEO" | "FINAL_VIDEO";
  validationStage: SourceValidationStage;
  generatedScenePlans?: GeneratedSourceScene[];
  finalObservation?: FinalVideoObservation;
};

export type GeneratedSourceScene = {
  sceneNumber: number;
  generatedSceneId?: string | null;
  sourceSceneId?: string | null;
  storyBeat?: string | null;
  actionSequence?: string[] | null;
  camera?: Record<string, unknown> | null;
  subjectPosition?: string | null;
  relativeObjectPositions?: string[] | null;
  targetDuration?: number | null;
  startState?: string | null;
  endState?: string | null;
};

export function buildAuthoritativeStoryboardValidationPlans(spec: SourceVideoModelingSpec, mappings: GeneratedSceneMapping[]): GeneratedSourceScene[] {
  const sourceById = new Map(spec.scenes.map((scene) => [scene.sourceSceneId, scene]));
  return mappings.map((mapping) => {
    const source = sourceById.get(mapping.sourceSceneId);
    if (!source) return { sceneNumber: mapping.sceneNumber, generatedSceneId: `pending-scene-${mapping.sceneNumber}`, sourceSceneId: mapping.sourceSceneId, targetDuration: mapping.targetDuration };
    return {
      sceneNumber: mapping.sceneNumber,
      generatedSceneId: `pending-scene-${mapping.sceneNumber}`,
      sourceSceneId: mapping.sourceSceneId,
      storyBeat: source.storyBeat,
      actionSequence: mapping.actionSequence,
      camera: mapping.cameraSpec,
      subjectPosition: mapping.spatialSpec.subjectPosition,
      relativeObjectPositions: mapping.spatialSpec.relativeObjectPositions,
      targetDuration: mapping.targetDuration,
      startState: source.startState,
      endState: source.endState,
    };
  });
}

export type GeneratedImageObservation = {
  characterIdentityMatch?: boolean | SourceValidationStatus | null;
  cameraType?: string | null;
  shotSize?: string | null;
  cameraAngle?: string | null;
  cameraMovement?: string | null;
  subjectPosition?: string | null;
  poseOrientation?: string | null;
  poseOrientationMatch?: boolean | SourceValidationStatus | null;
  gazeTargetMatch?: boolean | SourceValidationStatus | null;
  relativeObjectPositions?: string[] | null;
  startStateMatch?: boolean | SourceValidationStatus | null;
  keyPropPresenceMatch?: boolean | SourceValidationStatus | null;
  framingIntentMatch?: boolean | SourceValidationStatus | null;
  technicalStatus?: boolean | SourceValidationStatus | null;
  evidence?: unknown[];
};

export type GeneratedSceneVideoObservation = GeneratedImageObservation & {
  actionSequence?: string[] | null;
  propInteractionMatch?: boolean | SourceValidationStatus | null;
  actionMatch?: boolean | SourceValidationStatus | null;
  actionOrderMatch?: boolean | SourceValidationStatus | null;
  cameraMatch?: boolean | SourceValidationStatus | null;
  spatialMatch?: boolean | SourceValidationStatus | null;
  timingMatch?: boolean | SourceValidationStatus | null;
  endStateMatch?: boolean | SourceValidationStatus | null;
  beatMatch?: boolean | SourceValidationStatus | null;
  temporalContinuity?: boolean | SourceValidationStatus | null;
  generatedDuration?: number | null;
};

export type FinalVideoObservation = {
  sceneOrder?: number[] | null;
  generatedDuration?: number | null;
  structureMatch?: boolean | SourceValidationStatus | null;
  beatMatch?: boolean | SourceValidationStatus | null;
  timingMatch?: boolean | SourceValidationStatus | null;
  rhythmMatch?: boolean | SourceValidationStatus | null;
  transitionMatch?: boolean | SourceValidationStatus | null;
  punchlineMatch?: boolean | SourceValidationStatus | null;
  cameraPatternMatch?: boolean | SourceValidationStatus | null;
  actionPatternMatch?: boolean | SourceValidationStatus | null;
  technicalStatus?: boolean | SourceValidationStatus | null;
  evidence?: unknown[];
};

export type SourceValidationCheck = {
  validatorId: string;
  status: SourceValidationStatus;
  expected: unknown;
  actual: unknown;
  confidence: number;
  evidence: unknown[];
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  sourceSceneId: string | null;
  generatedSceneId: string | null;
  sceneNumber: number | null;
  sourceTimestamp: number | null;
  generatedTimestamp: number | null;
  firstDivergenceCandidate: string | null;
  message: string;
};

export type SourceValidationResult = {
  stage: SourceValidationStage;
  status: SourceValidationStatus;
  characterFidelity: SourceValidationStatus;
  sourceFidelity: SourceValidationStatus;
  technicalQuality: SourceValidationStatus;
  checks: SourceValidationCheck[];
  findings: SourceValidationCheck[];
  criticalFailCount: number;
  overallModelingFidelityScore: number | null;
  breakdown: { structureFidelity: number | null; actionFidelity: number | null; cameraFidelity: number | null; timingFidelity: number | null; spatialFidelity: number | null; transitionFidelity: number | null; overallFidelity: number | null };
  firstDivergenceCandidate: string | null;
};

export type VerdictCanonicalizationChange = {
  path: string;
  originalValue: unknown;
  originalType: string;
  canonicalValue: boolean;
  canonicalType: "boolean";
};

export type ImageSourceVerdictCanonicalization = {
  verdictCanonicalizationApplied: boolean;
  canonicalizedVerdictFields: string[];
  changes: VerdictCanonicalizationChange[];
};

export type ImageSourceObservationAdapterResult = {
  observation: GeneratedImageObservation;
  diagnostic: ImageSourceVerdictCanonicalization;
};

const normalize = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ");
const comparable = (value: unknown): unknown => Array.isArray(value) ? value.map(comparable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, comparable(item)])) : typeof value === "string" ? normalize(value) : value;
const sameValue = (left: unknown, right: unknown) => JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
const statusValue = (value: unknown): SourceValidationStatus => {
  if (value === true || value === "PASS") return "PASS";
  if (value === false || value === "FAIL") return "FAIL";
  if (value === "ERROR") return "ERROR";
  return "NOT_EVALUATED";
};

const IMAGE_SOURCE_BOOLEAN_VERDICT_FIELDS = ["startStateMatch", "keyPropPresenceMatch", "framingIntentMatch"] as const;

function valueType(value: unknown) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Adapt only provider verdict tokens whose Image Source Validation contract is
 * boolean. The raw provider object is never mutated.
 */
export function adaptImageSourceObservationVerdicts(rawObservation: unknown): ImageSourceObservationAdapterResult {
  const raw = rawObservation && typeof rawObservation === "object" && !Array.isArray(rawObservation)
    ? rawObservation as Record<string, unknown>
    : {};
  const observation = { ...raw } as GeneratedImageObservation;
  const changes: VerdictCanonicalizationChange[] = [];
  for (const field of IMAGE_SOURCE_BOOLEAN_VERDICT_FIELDS) {
    const value = raw[field];
    if (value !== "PASS" && value !== "FAIL") continue;
    const canonicalValue = value === "PASS";
    observation[field] = canonicalValue;
    changes.push({
      path: `sourceObservation.${field}`,
      originalValue: value,
      originalType: valueType(value),
      canonicalValue,
      canonicalType: "boolean",
    });
  }
  return {
    observation,
    diagnostic: {
      verdictCanonicalizationApplied: changes.length > 0,
      canonicalizedVerdictFields: changes.map((change) => change.path),
      changes,
    },
  };
}
const stageDivergence = (stage: SourceValidationStage) => stage === "STORYBOARD" ? "SOURCE_STORYBOARD" : stage === "START_FRAME" ? "START_FRAME_OUTPUT" : stage === "SCENE_VIDEO" ? "SCENE_VIDEO_OUTPUT" : "FINAL_ASSEMBLY_OUTPUT";

function check(context: SourceValidationContext, validatorId: string, status: SourceValidationStatus, expected: unknown, actual: unknown, message: string, options: Partial<Pick<SourceValidationCheck, "sourceSceneId" | "generatedSceneId" | "sceneNumber" | "sourceTimestamp" | "generatedTimestamp" | "severity" | "confidence" | "evidence">> = {}): SourceValidationCheck {
  return { validatorId, status, expected, actual, message, sourceSceneId: options.sourceSceneId ?? context.sourceSceneId ?? null, generatedSceneId: options.generatedSceneId ?? context.generatedSceneId ?? null, sceneNumber: options.sceneNumber ?? null, sourceTimestamp: options.sourceTimestamp ?? context.sourceStartTime ?? null, generatedTimestamp: options.generatedTimestamp ?? null, firstDivergenceCandidate: status === "FAIL" ? stageDivergence(context.validationStage) : null, confidence: options.confidence ?? (status === "NOT_EVALUATED" || status === "ERROR" ? 0 : 1), severity: options.severity ?? (status === "FAIL" ? "HIGH" : "LOW"), evidence: options.evidence ?? context.sourceEvidence ?? [] };
}

function compare(context: SourceValidationContext, validatorId: string, expected: unknown, actual: unknown, message: string, options: Partial<Pick<SourceValidationCheck, "sourceSceneId" | "generatedSceneId" | "sourceTimestamp" | "severity" | "evidence">> = {}) {
  if (actual === undefined || actual === null) return check(context, validatorId, "NOT_EVALUATED", expected, actual, `${message}: thiếu evidence.`, options);
  const equal = sameValue(expected, actual);
  return check(context, validatorId, equal ? "PASS" : "FAIL", expected, actual, equal ? message : `${message}: expected và actual khác nhau.`, options);
}

function comparePartialObject(context: SourceValidationContext, validatorId: string, expected: Record<string, unknown>, actual: unknown, message: string, options: Partial<Pick<SourceValidationCheck, "sourceSceneId" | "generatedSceneId" | "sourceTimestamp" | "severity" | "evidence">> = {}) {
  if (!actual || typeof actual !== "object" || Array.isArray(actual)) return check(context, validatorId, "NOT_EVALUATED", expected, actual, `${message}: thiếu object camera/spatial.`, options);
  const observed = actual as Record<string, unknown>;
  const mismatches = Object.entries(expected).filter(([key, value]) => !sameValue(value, observed[key])).map(([key]) => key);
  return check(context, validatorId, mismatches.length ? "FAIL" : "PASS", expected, observed, mismatches.length ? `${message}: mismatch ở ${mismatches.join(", ")}.` : message, options);
}

function aggregate(checks: SourceValidationCheck[]): SourceValidationStatus {
  if (checks.some((item) => item.status === "FAIL")) return "FAIL";
  if (checks.some((item) => item.status === "ERROR")) return "ERROR";
  if (checks.some((item) => item.status === "NOT_EVALUATED") || !checks.length) return "NOT_EVALUATED";
  return "PASS";
}

function result(context: SourceValidationContext, sourceChecks: SourceValidationCheck[], characterChecks: SourceValidationCheck[] = [], technicalChecks: SourceValidationCheck[] = [], requiredDomains: Array<"source" | "character" | "technical"> = ["source"]): SourceValidationResult {
  const characterFidelity = aggregate(characterChecks);
  const sourceFidelity = aggregate(sourceChecks);
  const technicalQuality = aggregate(technicalChecks);
  const domains = { source: sourceFidelity, character: characterFidelity, technical: technicalQuality };
  const status: SourceValidationStatus = Object.values(domains).some((value) => value === "FAIL") ? "FAIL" : requiredDomains.some((domain) => domains[domain] === "ERROR") ? "ERROR" : requiredDomains.some((domain) => domains[domain] === "NOT_EVALUATED") ? "NOT_EVALUATED" : "PASS";
  const checks = [...sourceChecks, ...characterChecks, ...technicalChecks];
  const evaluatedSource = sourceChecks.filter((item) => item.status === "PASS" || item.status === "FAIL");
  const overall = evaluatedSource.length ? evaluatedSource.filter((item) => item.status === "PASS").length / evaluatedSource.length : null;
  const criticalFailCount = checks.filter((item) => item.status === "FAIL" && item.severity === "CRITICAL").length;
  return { stage: context.validationStage, status, characterFidelity, sourceFidelity, technicalQuality, checks, findings: checks.filter((item) => item.status !== "PASS"), criticalFailCount, overallModelingFidelityScore: overall, breakdown: { structureFidelity: null, actionFidelity: null, cameraFidelity: null, timingFidelity: null, spatialFidelity: null, transitionFidelity: null, overallFidelity: overall }, firstDivergenceCandidate: checks.find((item) => item.status === "FAIL")?.firstDivergenceCandidate ?? null };
}

function sourceScene(context: SourceValidationContext, sourceSceneId?: string | null): SourceModelingScene | undefined {
  return context.sourceSpec.scenes.find((scene) => scene.sourceSceneId === (sourceSceneId ?? context.sourceSceneId));
}

export function validateStoryboardSource(context: SourceValidationContext, generatedScenes: GeneratedSourceScene[]): SourceValidationResult {
  const sourceScenes = [...context.sourceSpec.scenes].sort((left, right) => left.order - right.order);
  const generated = [...generatedScenes].sort((left, right) => left.sceneNumber - right.sceneNumber);
  const checks: SourceValidationCheck[] = [];
  checks.push(check(context, "SOURCE_SCENE_COUNT_MATCH", generated.length === sourceScenes.length ? "PASS" : "FAIL", sourceScenes.length, generated.length, "Số source scene phải trùng storyboard scene.", { severity: "CRITICAL" }));
  checks.push(check(context, "SOURCE_SCENE_ORDER_MATCH", generated.every((item, index) => item.sceneNumber === index + 1 && item.sourceSceneId === sourceScenes[index]?.sourceSceneId) ? "PASS" : "FAIL", sourceScenes.map((item) => item.sourceSceneId), generated.map((item) => item.sourceSceneId ?? null), "Thứ tự và mapping source scene phải giữ nguyên.", { severity: "CRITICAL" }));
  checks.push(check(context, "SOURCE_SCENE_MAPPING_MISSING", generated.every((item) => typeof item.sourceSceneId === "string" && item.sourceSceneId.length > 0) ? "PASS" : "FAIL", sourceScenes.map((item) => item.sourceSceneId), generated.map((item) => item.sourceSceneId ?? null), "Mỗi generated scene phải có sourceSceneId.", { severity: "CRITICAL" }));
  generated.forEach((item, index) => {
    const source = sourceScenes[index];
    if (!source) return;
    const options = { sourceSceneId: source.sourceSceneId, generatedSceneId: item.generatedSceneId ?? `scene-${item.sceneNumber}`, sceneNumber: item.sceneNumber, sourceTimestamp: source.sourceStartTime };
    checks.push(compare(context, "SOURCE_BEAT_COMPLETENESS", source.storyBeat, item.storyBeat, "Source beat được giữ đủ.", options));
    const actionCheck = compare(context, "SOURCE_ACTION_SEQUENCE_MATCH", source.actionSequence, item.actionSequence, "Action sequence giữ đúng thứ tự.", { ...options, severity: "CRITICAL" });
    checks.push(actionCheck);
    if (actionCheck.status === "FAIL") checks.push(check(context, "SOURCE_ACTION_ORDER_MISMATCH", "FAIL", source.actionSequence, item.actionSequence, "Action order bị đảo hoặc thay đổi.", { ...options, severity: "CRITICAL" }));
    checks.push(comparePartialObject(context, "SOURCE_CAMERA_INTENT_MATCH", { cameraType: source.cameraType, shotSize: source.shotSize, cameraAngle: source.cameraAngle, cameraMovement: source.cameraMovement, framing: source.framing }, item.camera, "Camera intent được giữ nguyên.", { ...options, severity: "CRITICAL" }));
    checks.push(compare(context, "SOURCE_SPATIAL_RELATION_MATCH", { subjectPosition: source.subjectPosition, relativeObjectPositions: source.relativeObjectPositions }, { subjectPosition: item.subjectPosition, relativeObjectPositions: item.relativeObjectPositions }, "Quan hệ không gian semantic được giữ nguyên.", options));
    const timing = item.targetDuration === undefined || item.targetDuration === null ? check(context, "SOURCE_TIMING_PLAN_MATCH", "NOT_EVALUATED", source.duration, item.targetDuration, "Timing plan chưa có duration generated.", options) : check(context, "SOURCE_TIMING_PLAN_MATCH", Math.abs(item.targetDuration / source.duration - 1) <= context.sourceSpec.timingTolerance ? "PASS" : "FAIL", source.duration, item.targetDuration, "Timing plan nằm trong tolerance của Strict Modeling.", { ...options, severity: "CRITICAL" });
    checks.push(timing);
    checks.push(compare(context, "SOURCE_START_END_STATE_MATCH", { startState: source.startState, endState: source.endState }, { startState: item.startState, endState: item.endState }, "Start/end state được giữ nguyên.", { ...options, severity: "CRITICAL" }));
  });
  const storyboardStatus = aggregate(checks);
  checks.push(check(context, "SOURCE_STORYBOARD_MATCH", storyboardStatus, "PASS", storyboardStatus, "Storyboard phải khớp SourceVideoModelingSpec."));
  return result(context, checks);
}

export function validateImageSource(context: SourceValidationContext, observation: GeneratedImageObservation): SourceValidationResult {
  const source = sourceScene(context);
  const sourceChecks: SourceValidationCheck[] = [];
  if (!source) sourceChecks.push(check(context, "SOURCE_SCENE_MAPPING_MISSING", "FAIL", context.sourceSceneId, null, "Không có mapping source scene cho start-frame.", { severity: "CRITICAL" }));
  else {
    const options = { sourceSceneId: source.sourceSceneId, generatedSceneId: context.generatedSceneId ?? null, sceneNumber: source.order, sourceTimestamp: source.sourceStartTime };
    sourceChecks.push(compare(context, "CAMERA_TYPE_MATCH", source.cameraType, observation.cameraType, "Camera type khớp source.", options));
    sourceChecks.push(compare(context, "SHOT_SIZE_MATCH", source.shotSize, observation.shotSize, "Shot size khớp source.", options));
    sourceChecks.push(compare(context, "CAMERA_ANGLE_MATCH", source.cameraAngle, observation.cameraAngle, "Camera angle khớp source.", options));
    sourceChecks.push(compare(context, "SUBJECT_POSITION_MATCH", source.subjectPosition, observation.subjectPosition, "Subject position khớp source.", options));
    sourceChecks.push(source.poseOrientation === null ? check(context, "POSE_ORIENTATION_MATCH", "PASS", "not specified", "not applicable", "Source không khai báo pose orientation.", options) : compare(context, "POSE_ORIENTATION_MATCH", true, observation.poseOrientationMatch, "Pose orientation khớp source.", options));
    sourceChecks.push(source.gazeTarget === null ? check(context, "GAZE_TARGET_MATCH", "PASS", "not specified", "not applicable", "Source không khai báo gaze target.", options) : compare(context, "GAZE_TARGET_MATCH", true, observation.gazeTargetMatch, "Gaze target khớp source.", options));
    sourceChecks.push(compare(context, "RELATIVE_OBJECT_POSITION_MATCH", source.relativeObjectPositions, observation.relativeObjectPositions, "Relative object positions khớp source.", options));
    sourceChecks.push(compare(context, "START_STATE_MATCH", true, observation.startStateMatch, "Start state khớp source.", { ...options, severity: "CRITICAL" }));
    sourceChecks.push(compare(context, "KEY_PROP_PRESENCE_MATCH", true, observation.keyPropPresenceMatch, "Key prop presence khớp source.", options));
    sourceChecks.push(compare(context, "FRAMING_INTENT_MATCH", true, observation.framingIntentMatch, "Framing intent khớp source.", { ...options, severity: "CRITICAL" }));
  }
  const shotStatus = aggregate(sourceChecks);
  sourceChecks.push(check(context, "SOURCE_SHOT_MATCH", shotStatus, "PASS", shotStatus, "Source shot phải khớp semantic camera/framing/spatial intent.", { severity: shotStatus === "FAIL" ? "CRITICAL" : "HIGH" }));
  const character = [check(context, "CHARACTER_IDENTITY_MATCH", statusValue(observation.characterIdentityMatch), "PASS", observation.characterIdentityMatch, "Character Identity Pack phải khớp.", { severity: "CRITICAL", evidence: observation.evidence })];
  const technical = [check(context, "TECHNICAL_IMAGE_VALID", statusValue(observation.technicalStatus), "PASS", observation.technicalStatus, "Generated image phải đọc được và hợp lệ.", { evidence: observation.evidence })];
  return result(context, sourceChecks, character, technical, ["source", "character", "technical"]);
}

export function imageGenerationGate(validation: SourceValidationResult): "PASS" | "BLOCKED" | "NEEDS_REVIEW" {
  if (validation.characterFidelity === "FAIL" || validation.sourceFidelity === "FAIL") return "BLOCKED";
  if (validation.characterFidelity !== "PASS" || validation.sourceFidelity !== "PASS" || validation.technicalQuality !== "PASS") return "NEEDS_REVIEW";
  return "PASS";
}

export function validateSceneVideoSource(context: SourceValidationContext, observation: GeneratedSceneVideoObservation): SourceValidationResult {
  const source = sourceScene(context);
  const sourceChecks: SourceValidationCheck[] = [];
  if (!source) sourceChecks.push(check(context, "SOURCE_SCENE_MAPPING_MISSING", "FAIL", context.sourceSceneId, null, "Không có mapping source scene cho scene video.", { severity: "CRITICAL" }));
  else {
    const options = { sourceSceneId: source.sourceSceneId, generatedSceneId: context.generatedSceneId ?? null, sceneNumber: source.order, sourceTimestamp: source.sourceStartTime };
    sourceChecks.push(compare(context, "SOURCE_ACTION_MATCH", true, observation.actionMatch, "Action chính khớp source.", { ...options, severity: "CRITICAL" }));
    sourceChecks.push(compare(context, "SOURCE_ACTION_ORDER_MATCH", source.actionSequence, observation.actionSequence, "Action sequence khớp source.", { ...options, severity: "CRITICAL" }));
    sourceChecks.push(compare(context, "SOURCE_CAMERA_MATCH", true, observation.cameraMatch, "Camera grammar khớp source.", { ...options, severity: "CRITICAL" }));
    sourceChecks.push(compare(context, "SOURCE_PROP_INTERACTION_MATCH", true, observation.propInteractionMatch, "Prop interaction khớp source.", options));
    sourceChecks.push(compare(context, "SOURCE_SPATIAL_MATCH", true, observation.spatialMatch, "Spatial relationship khớp source.", options));
    const sceneTiming = observation.timingMatch !== undefined && observation.timingMatch !== null ? compare(context, "SOURCE_TIMING_MATCH", true, observation.timingMatch, "Timing khớp source.", { ...options, severity: "CRITICAL" }) : typeof observation.generatedDuration === "number" ? check(context, "SOURCE_TIMING_MATCH", Math.abs(observation.generatedDuration / source.duration - 1) <= context.sourceSpec.timingTolerance ? "PASS" : "FAIL", source.duration, observation.generatedDuration, "Scene duration nằm trong tolerance của Strict Modeling.", { ...options, severity: "CRITICAL" }) : check(context, "SOURCE_TIMING_MATCH", "NOT_EVALUATED", source.duration, observation.generatedDuration, "Chưa có evidence scene duration/timing.", { ...options, severity: "CRITICAL" });
    sourceChecks.push(sceneTiming);
    sourceChecks.push(compare(context, "SOURCE_START_STATE_MATCH", true, observation.startStateMatch, "Start state khớp source.", { ...options, severity: "CRITICAL" }));
    sourceChecks.push(compare(context, "SOURCE_END_STATE_MATCH", true, observation.endStateMatch, "End state khớp source.", { ...options, severity: "CRITICAL" }));
    sourceChecks.push(compare(context, "SOURCE_BEAT_MATCH", true, observation.beatMatch, "Beat khớp source.", { ...options, severity: "CRITICAL" }));
    sourceChecks.push(compare(context, "TEMPORAL_CONTINUITY", true, observation.temporalContinuity, "Continuity thời gian được giữ.", options));
  }
  const character = [check(context, "CHARACTER_IDENTITY_MATCH", statusValue(observation.characterIdentityMatch), "PASS", observation.characterIdentityMatch, "Character Identity Pack phải khớp.", { severity: "CRITICAL", evidence: observation.evidence })];
  const technical = [check(context, "TECHNICAL_VIDEO_VALID", statusValue(observation.technicalStatus), "PASS", observation.technicalStatus, "Scene video phải hợp lệ kỹ thuật.", { evidence: observation.evidence })];
  return result(context, sourceChecks, character, technical, ["source", "character", "technical"]);
}

export function validateFinalVideoSource(context: SourceValidationContext, observation?: FinalVideoObservation): SourceValidationResult {
  if (!observation) return result(context, [check(context, "SOURCE_FINAL_VALIDATION_REQUIRED", "NOT_EVALUATED", "Final source evidence", null, "Chưa có evidence semantic của final video.", { severity: "HIGH" })], [], []);
  const sourceScenes = [...context.sourceSpec.scenes].sort((left, right) => left.order - right.order);
  const sourceChecks: SourceValidationCheck[] = [];
  sourceChecks.push(compare(context, "SOURCE_SCENE_ORDER_MATCH", sourceScenes.map((scene) => scene.order), observation.sceneOrder, "Final scene order khớp source.", { severity: "CRITICAL" }));
  sourceChecks.push(compare(context, "SOURCE_STRUCTURE_MATCH", true, observation.structureMatch, "Final structure khớp source.", { severity: "CRITICAL" }));
  sourceChecks.push(compare(context, "SOURCE_BEAT_MATCH", true, observation.beatMatch, "Final beats khớp source.", { severity: "CRITICAL" }));
  const finalTiming = observation.timingMatch !== undefined && observation.timingMatch !== null ? check(context, "SOURCE_TIMING_MATCH", statusValue(observation.timingMatch), true, observation.timingMatch, "Final timing khớp source.", { severity: "CRITICAL" }) : typeof observation.generatedDuration === "number" ? check(context, "SOURCE_TIMING_MATCH", Math.abs(observation.generatedDuration / context.sourceSpec.sourceDuration - 1) <= context.sourceSpec.timingTolerance ? "PASS" : "FAIL", context.sourceSpec.sourceDuration, observation.generatedDuration, "Final duration nằm trong tolerance của Strict Modeling.", { severity: "CRITICAL" }) : check(context, "SOURCE_TIMING_MATCH", "NOT_EVALUATED", context.sourceSpec.sourceDuration, observation.generatedDuration, "Chưa có evidence generated duration/timing.", { severity: "CRITICAL" });
  sourceChecks.push(finalTiming);
  sourceChecks.push(compare(context, "SOURCE_RHYTHM_MATCH", true, observation.rhythmMatch, "Final rhythm khớp source."));
  sourceChecks.push(compare(context, "SOURCE_TRANSITION_MATCH", true, observation.transitionMatch, "Final transitions khớp source."));
  const punchlineRelevant = sourceScenes.some((scene) => scene.punchlineRole || scene.gagRole);
  sourceChecks.push(punchlineRelevant ? compare(context, "SOURCE_PUNCHLINE_MATCH", true, observation.punchlineMatch, "Final punchline khớp source.", { severity: "CRITICAL" }) : check(context, "SOURCE_PUNCHLINE_MATCH", "PASS", "not relevant", "not relevant", "Source không khai báo punchline role."));
  sourceChecks.push(compare(context, "SOURCE_CAMERA_PATTERN_MATCH", true, observation.cameraPatternMatch, "Final camera pattern khớp source.", { severity: "CRITICAL" }));
  sourceChecks.push(compare(context, "SOURCE_ACTION_PATTERN_MATCH", true, observation.actionPatternMatch, "Final action pattern khớp source.", { severity: "CRITICAL" }));
  const technical = [check(context, "TECHNICAL_VIDEO_VALID", statusValue(observation.technicalStatus), "PASS", observation.technicalStatus, "Final video phải hợp lệ kỹ thuật.", { evidence: observation.evidence })];
  const final = result(context, sourceChecks, [], technical, ["source", "technical"]);
  const evaluated = sourceChecks.filter((item) => item.status === "PASS" || item.status === "FAIL");
  const scoreBy = (ids: string[]) => { const selected = evaluated.filter((item) => ids.includes(item.validatorId)); return selected.length ? selected.filter((item) => item.status === "PASS").length / selected.length : null; };
  final.breakdown = { structureFidelity: scoreBy(["SOURCE_SCENE_ORDER_MATCH", "SOURCE_STRUCTURE_MATCH"]), actionFidelity: scoreBy(["SOURCE_BEAT_MATCH", "SOURCE_ACTION_PATTERN_MATCH", "SOURCE_PUNCHLINE_MATCH"]), cameraFidelity: scoreBy(["SOURCE_CAMERA_PATTERN_MATCH"]), timingFidelity: scoreBy(["SOURCE_TIMING_MATCH", "SOURCE_RHYTHM_MATCH"]), spatialFidelity: null, transitionFidelity: scoreBy(["SOURCE_TRANSITION_MATCH"]), overallFidelity: final.overallModelingFidelityScore };
  return final;
}

export function finalSourceApproval(validation: SourceValidationResult): "APPROVED" | "NEEDS_REVIEW" | "FAIL" {
  if (validation.criticalFailCount > 0 || validation.sourceFidelity === "FAIL") return "FAIL";
  if (validation.status !== "PASS" || (validation.overallModelingFidelityScore !== null && validation.overallModelingFidelityScore < 0.9)) return "NEEDS_REVIEW";
  return "APPROVED";
}

export function traceFirstDivergence(results: SourceValidationResult[]): { stage: SourceValidationStage; firstDivergence: string } | null {
  const order = new Map(SOURCE_VALIDATION_STAGES.map((stage, index) => [stage, index]));
  const failure = [...results].sort((left, right) => (order.get(left.stage) ?? 99) - (order.get(right.stage) ?? 99)).find((item) => item.status === "FAIL");
  return failure ? { stage: failure.stage, firstDivergence: failure.firstDivergenceCandidate ?? stageDivergence(failure.stage) } : null;
}
