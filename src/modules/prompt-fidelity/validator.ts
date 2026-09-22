import type { SourceModelingScene } from "@/modules/modeling/strict-source-modeling";

export type PromptType = "IMAGE" | "VIDEO";
export type PromptValidationStatus = "PASS" | "FAIL" | "NOT_EVALUATED" | "ERROR";
export type PromptFidelityGate = { status: "PASS" | "FAIL" | "NEEDS_REVIEW"; generationAllowed: boolean; result: PromptValidationResult };
export type PromptTextPolicy = { mode: "NO_READABLE_TEXT" | "REQUIRED_TEXT" | "FORBIDDEN_TEXT"; requiredText?: string; forbiddenText?: string[] };
export type PromptIdentityPack = { name: string; lockedTraits: Record<string, unknown>; allowedVariations: string[]; negativeRules: string[] };
export type PromptExpectedState = {
  projectId: string;
  sceneId: string | null;
  sourceSceneId: string | null;
  sourceSpecVersion: string;
  expectedStateVersion: string;
  characterIdentityPackVersion: string;
  timingTolerance: number;
  sourceScene?: SourceModelingScene;
  identityPack: PromptIdentityPack;
  sceneAppearance: string;
  textPolicy: PromptTextPolicy;
  allowedTransformations: string[];
  promptType: PromptType;
};
export type PromptValidationCheck = { validatorId: string; status: PromptValidationStatus; expected: unknown; actual: unknown; evidence: string[]; severity: "HIGH" | "CRITICAL" | "LOW"; message: string };
export type PromptValidationResult = { status: PromptValidationStatus; checks: PromptValidationCheck[]; validationEvidence: string[]; selfCheckAuthoritative: false };

export const STRICT_GEMINI_PROMPT_COMPILER_SYSTEM_INSTRUCTION = [
  "ROLE: STRICT SOURCE-FAITHFUL PROMPT COMPILER",
  "SOURCE FIDELITY TARGET: 90–100% for source structure, beats, action, camera, timing and spatial intent.",
  "SOURCE OF TRUTH PRIORITY: SourceVideoModelingSpec > Scene Expected State > Character Identity Pack > Scene Appearance State > Text Policy > Allowed Transformations.",
  "If creative wording conflicts with source evidence, source evidence always wins.",
  "Only translate the supplied constraints into an executable prompt. Do not write a new story or improve the source.",
].join("\n");

const normalize = (value: string) => value.toLowerCase().replace(/[“”‘’]/g, "\"").replace(/[^\p{L}\p{N}]+/gu, " ").replace(/\s+/g, " ").trim();
const contains = (prompt: string, value: string) => normalize(prompt).includes(normalize(value));
const authoritativePromptLine = (line: string) => /^\s*(?:PROMPT TYPE|SOURCE MODELING MODE|SOURCE VIDEO|TARGET SOURCE FIDELITY|MUST PRESERVE|ALLOWED TRANSFORMATIONS ONLY|DO NOT SILENTLY|SOURCE SCENE|CAMERA|FRAMING\/SPATIAL|ACTION SEQUENCE(?: \(authoritative\))?|START\s*[→-]\s*END|TIMING\/RHYTHM|SOURCE SPEC VERSION|TIMING TOLERANCE|CHARACTER IDENTITY PACK|LOCKED TRAITS|PRESERVE IDENTITY|SCENE APPEARANCE STATE|TEXT POLICY|ALLOWED TRANSFORMATIONS|EXECUTION|SCENE ACTION \/ FROZEN INITIAL STATE|BACKGROUND \/ CAMERA \/ COMPOSITION|DRAFT PROMPT FROM GEMINI|VIDEO CONTRACT|VIDEO SOURCE BEAT|VIDEO ACTION PROGRESSION|VIDEO CAMERA \/ FRAMING|VIDEO CAMERA MOVEMENT|VIDEO SPATIAL RELATIONSHIP|VIDEO TIMING \/ RHYTHM|VIDEO START STATE|VIDEO END STATE|VIDEO MOTION CONTINUITY|VIDEO CHARACTER IDENTITY LOCK|VIDEO SCENE APPEARANCE|VIDEO MUST PRESERVE|VIDEO ALLOWED TRANSFORMATIONS|VIDEO TEXT POLICY|VIDEO CREATIVE BOUNDARY)(?:\s*\([^)]*\))?\s*:/i.test(line);
const positiveLines = (prompt: string) => {
  let inApprovedSceneAppearance = false;
  return prompt.split(/\r?\n/).filter((line) => {
    if (/^\s*(?:SCENE APPEARANCE STATE|VIDEO SCENE APPEARANCE)(?:\s*\([^)]*\))?\s*:/i.test(line)) { inApprovedSceneAppearance = true; return false; }
    if (inApprovedSceneAppearance && authoritativePromptLine(line)) inApprovedSceneAppearance = false;
    if (inApprovedSceneAppearance || authoritativePromptLine(line)) return false;
    return !/\b(?:do not|don't|never|must not|forbidden|without|no readable|không|khong|cấm)\b/i.test(line);
  }).join("\n");
};
const statusOf = (ok: boolean, actual: unknown): PromptValidationStatus => actual === undefined || actual === null ? "NOT_EVALUATED" : ok ? "PASS" : "FAIL";
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function makeCheck(validatorId: string, status: PromptValidationStatus, expected: unknown, actual: unknown, message: string, severity: PromptValidationCheck["severity"] = "HIGH", evidence: string[] = []): PromptValidationCheck {
  return { validatorId, status, expected, actual, message, severity, evidence };
}

function sourceChecks(expected: PromptExpectedState, prompt: string): PromptValidationCheck[] {
  const source = expected.sourceScene;
  if (!source) return [makeCheck("PROMPT_SOURCE_BEAT_MATCH", "PASS", "background prompt has no scene beat", "not applicable", "Background prompt không có scene beat riêng.", "LOW")];
  const checks: PromptValidationCheck[] = [];
  const beatPresent = contains(prompt, source.storyBeat);
  checks.push(makeCheck("PROMPT_SOURCE_BEAT_MATCH", statusOf(beatPresent, beatPresent), source.storyBeat, beatPresent, "Prompt phải giữ source beat đầy đủ.", "CRITICAL"));
  const actions = source.actionSequence;
  const actionMarker = normalize(prompt).indexOf(normalize("ACTION SEQUENCE (authoritative)"));
  const actionRegion = actionMarker >= 0 ? normalize(prompt).slice(actionMarker) : normalize(prompt);
  const positions = actions.map((action) => actionRegion.indexOf(normalize(action)));
  const actionPresence = positions.every((position) => position >= 0);
  const orderOk = actionPresence && positions.every((position, index) => index === 0 || position > positions[index - 1]);
  checks.push(makeCheck("PROMPT_ACTION_ORDER_MATCH", orderOk ? "PASS" : "FAIL", actions, positions.map((position) => position >= 0), "Prompt phải chứa đủ action và đúng thứ tự.", "CRITICAL", actions.map((action, index) => `${index + 1}: ${action} @${positions[index]}`)));
  const cameraExpected = [source.cameraType, source.shotSize, source.cameraAngle, source.cameraMovement ?? "none", source.framing, source.subjectPosition];
  const cameraPresent = cameraExpected.every((item) => contains(prompt, item));
  const creative = positiveLines(prompt);
  const forbiddenMovement = source.cameraMovement === null || /^(none|static|locked)$/i.test(source.cameraMovement ?? "") ? /\b(?:dynamic\s+)?(?:orbit|orbits|dolly|tracking|handheld|whip[- ]?pan|pan(?:\s+(?:left|right))?|crash\s+zoom|camera spin|xoay quanh|orbit camera)\b/i.test(creative) : false;
  const shotConflict = /medium/i.test(source.shotSize) ? /\b(?:close[- ]?up|extreme close|macro)\b/i.test(creative) : /close/i.test(source.shotSize) ? /\b(?:wide shot|full shot)\b/i.test(creative) : false;
  checks.push(makeCheck("PROMPT_CAMERA_MATCH", cameraPresent && !forbiddenMovement && !shotConflict ? "PASS" : "FAIL", cameraExpected, { cameraPresent, forbiddenMovement, shotConflict }, "Prompt phải giữ camera type, shot size, angle, movement và framing.", "CRITICAL"));
  const expectedSpatial = [source.subjectPosition, ...source.relativeObjectPositions];
  const opposite = source.subjectPosition.toLowerCase() === "left" ? /\bsubject(?:\s+position)?\s*(?:is|=|:)\s*(?:on\s+the\s+)?(?:right|bên phải)\b/i : source.subjectPosition.toLowerCase() === "right" ? /\bsubject(?:\s+position)?\s*(?:is|=|:)\s*(?:on\s+the\s+)?(?:left|bên trái)\b/i : /$a/;
  const spatialPresent = expectedSpatial.every((item) => contains(prompt, item)) && !opposite.test(creative);
  checks.push(makeCheck("PROMPT_SPATIAL_MATCH", statusOf(spatialPresent, spatialPresent), expectedSpatial, { present: expectedSpatial.map((item) => contains(prompt, item)), oppositeConflict: opposite.test(creative) }, "Prompt phải giữ semantic spatial relationship.", "CRITICAL"));
  const durationActuals = [...prompt.matchAll(/(?:target duration|duration|lasts|for)\s*(?:is|of|:)?\s*(\d+(?:\.\d+)?)\s*(?:seconds?|s)\b/gi)].map((match) => Number(match[1]));
  const durationOk = durationActuals.length === 0 || durationActuals.every((actual) => Math.abs(actual / source.duration - 1) <= expected.timingTolerance);
  checks.push(makeCheck("PROMPT_TIMING_MATCH", durationOk ? "PASS" : "FAIL", source.duration, durationActuals.length ? durationActuals : undefined, "Prompt phải giữ timing intent trong Strict Modeling tolerance.", "CRITICAL"));
  const labeledLine = (label: string) => prompt.split(/\r?\n/).find((line) => normalize(line).startsWith(normalize(label)));
  const startLine = labeledLine("START STATE:");
  const endLine = labeledLine("END STATE:");
  const startStatePresent = startLine ? contains(startLine, source.startState) : contains(prompt, source.startState);
  const endStatePresent = endLine ? contains(endLine, source.endState) : contains(prompt, source.endState);
  checks.push(makeCheck("PROMPT_START_STATE_MATCH", statusOf(startStatePresent, startStatePresent), source.startState, startStatePresent, "Prompt phải giữ start state.", "CRITICAL"));
  checks.push(makeCheck("PROMPT_END_STATE_MATCH", statusOf(endStatePresent, endStatePresent), source.endState, endStatePresent, "Prompt phải giữ end state.", "CRITICAL"));
  return checks;
}

function identityChecks(expected: PromptExpectedState, prompt: string): PromptValidationCheck[] {
  const creative = positiveLines(prompt);
  const hasIdentity = /\bPRESERVE IDENTITY\b/i.test(prompt) && contains(prompt, expected.identityPack.name) && contains(prompt, "LOCKED TRAITS");
  const identityReplacement = /\b(?:similar to|similar character|inspired by|replace the main character|new protagonist|nhân vật tương tự|thay nhân vật chính)\b/i.test(creative);
  return [makeCheck("PROMPT_CHARACTER_IDENTITY_LOCK", hasIdentity && !identityReplacement ? "PASS" : "FAIL", { pack: expected.identityPack.name, preserve: true }, { hasIdentity, identityReplacement }, "Prompt phải khóa Character Identity Pack và không mô tả nhân vật tương tự.", "CRITICAL")];
}

function transformationCheck(expected: PromptExpectedState, prompt: string): PromptValidationCheck {
  const hasAllowedBlock = /ALLOWED (?:TRANSFORMATIONS|SCENE VARIATIONS)/i.test(prompt);
  const allowed = expected.allowedTransformations.length === 0 || expected.allowedTransformations.some((item) => contains(prompt, item));
  return makeCheck("PROMPT_ALLOWED_TRANSFORMATION_COMPLIANCE", hasAllowedBlock && allowed ? "PASS" : "FAIL", expected.allowedTransformations, { hasAllowedBlock, allowed }, "Allowed Transformations chỉ là phạm vi cho phép, không phải quyền sáng tạo tự do.", "HIGH");
}

function textCheck(expected: PromptExpectedState, prompt: string): PromptValidationCheck {
  const creative = positiveLines(prompt);
  if (expected.textPolicy.mode === "REQUIRED_TEXT") { const requiredPresent = expected.textPolicy.requiredText ? contains(prompt, expected.textPolicy.requiredText) : undefined; return makeCheck("PROMPT_TEXT_POLICY_MATCH", statusOf(Boolean(requiredPresent), requiredPresent), expected.textPolicy.requiredText ?? null, requiredPresent ?? null, "REQUIRED_TEXT phải giữ đúng nguyên văn.", "CRITICAL"); }
  if (expected.textPolicy.mode === "FORBIDDEN_TEXT") {
    const forbidden = (expected.textPolicy.forbiddenText ?? []).filter((text) => contains(creative, text));
    return makeCheck("PROMPT_TEXT_POLICY_MATCH", forbidden.length ? "FAIL" : "PASS", expected.textPolicy.forbiddenText ?? [], forbidden, "FORBIDDEN_TEXT không được xuất hiện như yêu cầu tạo text.", "CRITICAL");
  }
  const asksForText = /\b(?:include|show|display|add|write|render|hiển thị|thêm|viết)\b[^\n]*(?:readable\s+)?(?:text|words|letters|numbers|caption|logo|chữ|văn bản)/i.test(creative);
  return makeCheck("PROMPT_TEXT_POLICY_MATCH", asksForText ? "FAIL" : "PASS", "NO_READABLE_TEXT", asksForText ? "positive text instruction" : "explicit prohibition", "NO_READABLE_TEXT phải được nêu rõ và không yêu cầu text.", "CRITICAL");
}

function unauthorizedAdditionCheck(prompt: string, source?: SourceModelingScene): PromptValidationCheck {
  const creative = positiveLines(prompt);
  const allowedActions = new Set((source?.actionSequence ?? []).map(normalize));
  const sourceCameraMovement = source?.cameraMovement?.trim() ?? "";
  // The source movement is an authoritative camera contract, not creative
  // wording. Remove only that exact phrase (case/whitespace insensitive)
  // before scanning for unauthorized camera additions.
  const creativeWithoutAuthoritativeMovement = sourceCameraMovement
    ? creative.replace(new RegExp(escapeRegExp(sourceCameraMovement).replace(/\s+/g, "\\s+"), "gi"), " ")
    : creative;
  const additions = [
    /\b(?:jump|jumps|dance|dances|walks? away|stands? up|leaves?|explodes?|explosion|laughs?|cries?|smiles?|reacts?|introduce|introduces|adds?|new (?:character|prop|joke|ending|effect|transition)|make it more cinematic|make it funnier|dramatic reaction|new transition|dolly|orbit|pan(?:\s+(?:left|right))?|crash\s+zoom|zoom in|spark|flash|xoay quanh|đứng dậy|bỏ đi|nổ tung)\b/gi,
  ].flatMap((pattern) => [...creativeWithoutAuthoritativeMovement.matchAll(pattern)].map((match) => match[0])).filter((value) => {
    const normalizedValue = normalize(value);
    return ![...allowedActions].some((action) => action.includes(normalizedValue));
  });
  return makeCheck("PROMPT_NO_UNAUTHORIZED_CREATIVE_ADDITION", additions.length ? "FAIL" : "PASS", "no unapproved new action/camera/effect/ending", [...new Set(additions)], "Prompt không được thêm action, gag, camera, effect, transition, dialogue hoặc ending mới.", "CRITICAL");
}

export function compileStrictPrompt(expected: PromptExpectedState, geminiDraftPrompt: string): string {
  const source = expected.sourceScene;
  const sourceBlock = source ? [
    `SOURCE SCENE: ${source.sourceSceneId} · order ${source.order}`,
    `SOURCE BEAT: ${source.storyBeat}`,
    `ACTION SEQUENCE (authoritative): ${source.actionSequence.map((action, index) => `${index + 1}. ${action}`).join(" ")}`,
    `CAMERA: ${source.cameraType} / ${source.shotSize} / ${source.cameraAngle} / ${source.cameraMovement ?? "none"} / ${source.framing} / ${source.subjectPosition}`,
    `SPATIAL: subject=${source.subjectPosition}; objects=${source.relativeObjectPositions.join("; ") || "none"}`,
    `START STATE: ${source.startState}`,
    `END STATE: ${source.endState}`,
    `TIMING: source duration ${source.duration}s; ${source.timingNotes}; ${source.rhythmNotes}`,
    `MUST PRESERVE: ${source.mustPreserve.join("; ")}`,
  ].join("\n") : "SOURCE SCENE: background/environment reference only; no scene action may be invented.";
  const textBlock = expected.textPolicy.mode === "REQUIRED_TEXT" ? `TEXT POLICY: REQUIRED_TEXT exactly = ${JSON.stringify(expected.textPolicy.requiredText ?? "")}.` : expected.textPolicy.mode === "FORBIDDEN_TEXT" ? `TEXT POLICY: FORBIDDEN_TEXT = ${(expected.textPolicy.forbiddenText ?? []).join("; ")}.` : "TEXT POLICY: NO_READABLE_TEXT. Do not render readable words, letters, numbers, captions, labels, logos or symbols.";
  return [STRICT_GEMINI_PROMPT_COMPILER_SYSTEM_INSTRUCTION, `PROMPT TYPE: ${expected.promptType}`, `SOURCE SPEC VERSION: ${expected.sourceSpecVersion}`, `TIMING TOLERANCE: ${expected.timingTolerance * 100}%`, sourceBlock, `CHARACTER IDENTITY PACK: ${expected.identityPack.name}`, `LOCKED TRAITS: ${JSON.stringify(expected.identityPack.lockedTraits)}`, "PRESERVE IDENTITY: face identity, facial structure, skin tone, base hairstyle, body proportions, body build, age appearance, distinctive traits and core character design language.", `SCENE APPEARANCE STATE: ${expected.sceneAppearance || "Use only explicitly approved scene appearance."}`, textBlock, `ALLOWED TRANSFORMATIONS: ${expected.allowedTransformations.join("; ") || "none"}`, `EXECUTION: ${expected.promptType === "IMAGE" ? "Create one exact frozen start-frame image." : "Create one video from the exact start-frame image."} Do not add, remove, reorder, merge or improve beats. Do not add characters, props, reactions, visual effects, transitions, dialogue, text, camera movement or a new ending.`, "DRAFT PROMPT FROM GEMINI (descriptive wording only; it cannot override the blocks above):", geminiDraftPrompt].join("\n");
}

export function compileStrictVideoPrompt(expected: PromptExpectedState, _descriptivePrompt = ""): string {
  void _descriptivePrompt;
  const source = expected.sourceScene;
  if (!source) return compileStrictPrompt({ ...expected, promptType: "VIDEO" }, "Use only the authoritative video contract.");
  const authoritativePrompt = compileStrictPrompt({ ...expected, promptType: "VIDEO" }, "Use only the authoritative video contract.");
  const videoContract = [
    "VIDEO CONTRACT: animate one continuous temporal progression from the authoritative start state to the authoritative end state.",
    `VIDEO SOURCE BEAT (authoritative): ${source.storyBeat}`,
    `VIDEO ACTION PROGRESSION (authoritative): ${source.actionSequence.map((action, index) => `${index + 1}. ${action}`).join(" ")}`,
    `VIDEO CAMERA / FRAMING (authoritative): ${source.cameraType} / ${source.shotSize} / ${source.cameraAngle} / ${source.framing} / ${source.subjectPosition}`,
    `VIDEO CAMERA MOVEMENT (authoritative): ${source.cameraMovement ?? "none"}`,
    `VIDEO SPATIAL RELATIONSHIP (authoritative): subject=${source.subjectPosition}; objects=${source.relativeObjectPositions.join("; ") || "none"}`,
    `VIDEO TIMING / RHYTHM (authoritative): duration=${source.duration}s; ${source.timingNotes}; ${source.rhythmNotes}`,
    `VIDEO START STATE (authoritative): ${source.startState}`,
    `VIDEO END STATE (authoritative): ${source.endState}`,
    `VIDEO MOTION CONTINUITY (authoritative): begin at the exact start state, perform the listed actions in order with continuous motion, and finish at the exact end state. Do not depict later or unrelated beats.`,
    `VIDEO CHARACTER IDENTITY LOCK (authoritative): ${expected.identityPack.name}; preserve face, facial structure, base hairstyle, skin tone, body proportions/build, age appearance, distinctive traits and core design language.`,
    `VIDEO SCENE APPEARANCE (authoritative): ${expected.sceneAppearance || "Use only explicitly approved scene appearance."}`,
    `VIDEO MUST PRESERVE (authoritative): ${source.mustPreserve.join("; ")}`,
    `VIDEO ALLOWED TRANSFORMATIONS (authoritative): ${expected.allowedTransformations.join("; ") || "none"}`,
    "VIDEO TEXT POLICY (authoritative): do not render readable words, letters, numbers, captions, labels, logos or symbols unless an explicit required-text contract exists.",
    "VIDEO CREATIVE BOUNDARY (authoritative): do not add characters, props, actions, camera movements, effects, transitions, dialogue or an ending outside this contract.",
  ].join("\n");
  return `${authoritativePrompt}\n${videoContract}`;
}

export function validatePromptFidelity(prompt: string, expected: PromptExpectedState, _geminiSelfCheck?: Record<string, unknown>): PromptValidationResult {
  void _geminiSelfCheck;
  if (!prompt.trim()) return { status: "NOT_EVALUATED", checks: [makeCheck("PROMPT_SOURCE_BEAT_MATCH", "NOT_EVALUATED", "non-empty prompt", prompt, "Prompt rỗng.", "CRITICAL")], validationEvidence: ["Prompt is empty."], selfCheckAuthoritative: false };
  const checks = [...sourceChecks(expected, prompt), ...identityChecks(expected, prompt), transformationCheck(expected, prompt), textCheck(expected, prompt), unauthorizedAdditionCheck(prompt, expected.sourceScene)];
  const status: PromptValidationStatus = checks.some((item) => item.status === "FAIL") ? "FAIL" : checks.some((item) => item.status === "ERROR") ? "ERROR" : checks.some((item) => item.status === "NOT_EVALUATED") ? "NOT_EVALUATED" : "PASS";
  return { status, checks, validationEvidence: checks.flatMap((item) => item.evidence), selfCheckAuthoritative: false };
}

export function promptFidelityGate(result: PromptValidationResult): PromptFidelityGate {
  if (result.status === "PASS") return { status: "PASS", generationAllowed: true, result };
  return { status: result.status === "FAIL" ? "FAIL" : "NEEDS_REVIEW", generationAllowed: false, result };
}

export async function boundedPromptRecompile(input: { initialPrompt: string; expected: PromptExpectedState; maxAttempts?: number; recompile?: (input: { expected: PromptExpectedState; failedValidators: string[]; actualPrompt: string }) => Promise<string> }): Promise<{ prompt: string; result: PromptValidationResult; attempts: number }> {
  const maxAttempts = Math.max(1, Math.min(2, input.maxAttempts ?? 2));
  let prompt = input.initialPrompt;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const result = validatePromptFidelity(prompt, input.expected);
    if (result.status === "PASS" || !input.recompile || attempt === maxAttempts) return { prompt, result, attempts: attempt };
    prompt = await input.recompile({ expected: input.expected, failedValidators: result.checks.filter((check) => check.status !== "PASS").map((check) => check.validatorId), actualPrompt: prompt });
  }
  return { prompt, result: validatePromptFidelity(prompt, input.expected), attempts: maxAttempts };
}
