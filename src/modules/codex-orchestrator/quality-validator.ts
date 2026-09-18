import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { decryptSecret } from "@/lib/secrets";
import { readProjectImage, readProjectVideo, readProjectFinalVideo } from "@/modules/assets/image-generation-service";
import { redactSecrets } from "./policy";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { waitForBridgeJob } from "@/modules/generation/browser-flow-bridge";
import type { CodexStage, ExpectedState, SceneExpectedState, ValidationIssue, ValidationOutput } from "./types";
import { adaptImageSourceObservationVerdicts, validateFinalVideoSource, validateImageSource, validateSceneVideoSource, type FinalVideoObservation, type GeneratedImageObservation, type GeneratedSceneVideoObservation, type SourceValidationResult } from "@/modules/source-validation/multi-stage";

type GeminiFile = { name?: string; uri?: string; state?: string; mimeType?: string };
type ProviderVerdict = { verdict?: string; issues?: ValidationIssue[]; summary?: string; sourceObservation?: Record<string, unknown>; sourceObservations?: Array<Record<string, unknown>> };
type RepairTarget = { sceneId: string; sceneNumber: number };
type RepairPrompt = { sceneNumber: number; prompt: string };

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function repairFingerprint(expected: ExpectedState, issues: ValidationIssue[], targets: number[]) {
  return createHash("sha256").update(JSON.stringify({ projectId: expected.projectId, candidateId: expected.candidateId, targets, issues: redactSecrets(issues) })).digest("hex").slice(0, 16);
}

export function parseRepairResponse(value: unknown, requested: RepairTarget[]): RepairPrompt[] {
  const response = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const repairs = Array.isArray(response.repairs) ? response.repairs : [];
  if (repairs.length !== requested.length) throw new Error("GEMINI_REPAIR_PROMPT_MISSING_OR_DUPLICATE");
  const resolved = repairs.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("GEMINI_REPAIR_PROMPT_INVALID_MAPPING");
    const item = value as Record<string, unknown>;
    const sceneId = typeof item.sceneId === "string" ? item.sceneId : undefined;
    const sceneNumber = typeof item.sceneNumber === "number" && Number.isInteger(item.sceneNumber) ? item.sceneNumber : undefined;
    const byId = sceneId ? requested.find((target) => target.sceneId === sceneId) : undefined;
    const byNumber = sceneNumber !== undefined ? requested.find((target) => target.sceneNumber === sceneNumber) : undefined;
    if (!byId && !byNumber) throw new Error("GEMINI_REPAIR_PROMPT_INVALID_MAPPING");
    if (byId && byNumber && byId.sceneNumber !== byNumber.sceneNumber) throw new Error("GEMINI_REPAIR_PROMPT_INVALID_MAPPING");
    const target = byId ?? byNumber;
    const prompt = typeof item.repairedPrompt === "string" ? item.repairedPrompt : item.correctedPrompt;
    if (!target || typeof prompt !== "string" || !prompt.trim() || prompt.length > 12_000) throw new Error("GEMINI_REPAIR_PROMPT_INVALID");
    return { target, prompt: prompt.trim() };
  });
  return requested.map((target) => {
    const matches = resolved.filter((item) => item.target.sceneId === target.sceneId && item.target.sceneNumber === target.sceneNumber);
    if (matches.length !== 1) throw new Error("GEMINI_REPAIR_PROMPT_MISSING_OR_DUPLICATE");
    return { sceneNumber: target.sceneNumber, prompt: matches[0].prompt };
  });
}

function isRepairStructureFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /GEMINI_REPAIR_PROMPT_(?:MISSING_OR_DUPLICATE|INVALID_MAPPING|INVALID)|QUALITY_BROWSER_INVALID_JSON/i.test(message);
}

async function requestRepairPrompt(userId: string, expected: ExpectedState, issues: ValidationIssue[], targets: RepairTarget[], mode: "batch" | "single") {
  const project = await db.contentProject.findFirst({ where: { id: expected.projectId, channel: { userId } }, select: { channelId: true } });
  if (!project) throw new Error("QUALITY_PROJECT_NOT_FOUND");
  const automationRun = await db.automationRun.findFirst({ where: { projectId: expected.projectId }, orderBy: { startedAt: "desc" }, select: { id: true } });
  const targetNumbers = targets.map((target) => target.sceneNumber);
  const fingerprint = repairFingerprint(expected, issues, targetNumbers);
  const queued = await new LocalJobQueue().enqueue("desktop.flow.quality", {
    userId, projectId: expected.projectId, channelId: project.channelId, stage: "ASSETS", purpose: "REPAIR_PROMPT", automationRunId: automationRun?.id ?? null,
    expectedState: redactSecrets(expected), repairContext: { targets: targetNumbers, targetSceneIds: targets.map((target) => target.sceneId), issues: redactSecrets(issues), mode },
  }, `repair-prompts:${expected.projectId}:${mode}:${targetNumbers.join(",")}:${fingerprint}`);
  return waitForBridgeJob(queued.jobId);
}

export async function repairAssetPrompts(userId: string, expected: ExpectedState, issues: ValidationIssue[], targets: number[]) {
  if (!expected.projectId || !targets.length || !issues.length) throw new Error("ASSET_REPAIR_EVIDENCE_REQUIRED");
  const requested = targets.map((sceneNumber) => {
    const scene = expected.scenes?.find((item) => item.sceneNumber === sceneNumber);
    if (!scene) throw new Error("GEMINI_REPAIR_PROMPT_TARGET_MISSING");
    return { sceneId: scene.sceneId, sceneNumber };
  });
  try {
    const result = await requestRepairPrompt(userId, expected, issues, requested, "batch");
    return parseRepairResponse(result, requested);
  } catch (error) {
    if (!isRepairStructureFailure(error) || requested.length === 1) throw error;
    // A malformed batch response must not be retried forever. Repair each
    // target independently so one truncated/duplicated scene cannot poison
    // the whole recovery attempt.
    const repaired: RepairPrompt[] = [];
    for (const target of requested) {
      const targetIssues = issues.filter((issue) => issue.sceneNumber === target.sceneNumber || issue.targetId === target.sceneId);
      const result = await requestRepairPrompt(userId, expected, targetIssues.length ? targetIssues : issues, [target], "single");
      repaired.push(...parseRepairResponse(result, [target]));
    }
    return repaired;
  }
}

function parseJson(text: string): ProviderVerdict {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  return JSON.parse(cleaned) as ProviderVerdict;
}

async function geminiKey(userId: string) {
  const connection = await db.aIConnection.findFirst({ where: { userId, provider: "GEMINI", kind: "AI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
  return connection ? decryptSecret(connection.encryptedKey) : null;
}

async function uploadFile(apiKey: string, data: Buffer, mimeType: string, displayName: string) {
  const start = await fetch("https://generativelanguage.googleapis.com/upload/v1beta/files", {
    method: "POST",
    signal: AbortSignal.timeout(5 * 60_000),
    headers: {
      "x-goog-api-key": apiKey,
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(data.length),
      "X-Goog-Upload-Header-Content-Type": mimeType,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: displayName } }),
  });
  if (!start.ok) throw new Error(`GEMINI_FILE_UPLOAD_START_${start.status}`);
  const uploadUrl = start.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("GEMINI_FILE_UPLOAD_URL_MISSING");
  const uploaded = await fetch(uploadUrl, { method: "POST", signal: AbortSignal.timeout(5 * 60_000), headers: { "Content-Length": String(data.length), "X-Goog-Upload-Offset": "0", "X-Goog-Upload-Command": "upload, finalize" }, body: new Uint8Array(data) });
  if (!uploaded.ok) throw new Error(`GEMINI_FILE_UPLOAD_${uploaded.status}`);
  let file = ((await uploaded.json()) as { file?: GeminiFile }).file;
  if (!file?.name) throw new Error("GEMINI_FILE_METADATA_MISSING");
  for (let attempt = 0; file.state === "PROCESSING" && attempt < 30; attempt += 1) {
    await delay(2_000);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { signal: AbortSignal.timeout(5 * 60_000), headers: { "x-goog-api-key": apiKey } });
    if (!response.ok) throw new Error(`GEMINI_FILE_STATUS_${response.status}`);
    file = await response.json() as GeminiFile;
  }
  if (file.state === "FAILED" || file.state === "PROCESSING" || !file.uri) throw new Error(`GEMINI_FILE_NOT_ACTIVE_${file.state ?? "UNKNOWN"}`);
  return file;
}

async function deleteFile(apiKey: string, file?: GeminiFile) {
  if (!file?.name) return;
  try { await fetch(`https://generativelanguage.googleapis.com/v1beta/${file.name}`, { method: "DELETE", headers: { "x-goog-api-key": apiKey } }); } catch { /* Files expire automatically; do not hide the validation result. */ }
}

async function generateVerdict(apiKey: string, parts: Array<Record<string, unknown>>, instruction: string): Promise<ProviderVerdict> {
  const model = process.env.GEMINI_MODEL ?? "gemini-3.6-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(5 * 60_000),
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({ contents: [{ parts: [...parts, { text: instruction }] }], generationConfig: { responseMimeType: "application/json" } }),
  });
  if (!response.ok) throw new Error(`GEMINI_QUALITY_VALIDATION_${response.status}`);
  const body = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  return parseJson(body.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text ?? "{}");
}

function normalizeProviderVerdict(value: ProviderVerdict): ValidationOutput {
  const verdict = value.verdict === "PASS" || value.verdict === "FAIL" || value.verdict === "UNCERTAIN" ? value.verdict : "UNCERTAIN";
  return { verdict, ...(verdict !== "PASS" ? { failureKind: "SEMANTIC_FAILURE" as const } : {}), issues: Array.isArray(value.issues) ? redactSecrets(value.issues) : verdict === "PASS" ? [] : [{ code: "QUALITY_VALIDATOR_UNCERTAIN", message: value.summary ?? "Quality Validator chưa thể kết luận." }] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sourceIssues(result: SourceValidationResult): ValidationIssue[] {
  return result.findings.map((item) => ({ code: item.validatorId, message: item.message, sceneNumber: item.sceneNumber ?? undefined, expected: item.expected, actual: item.actual }));
}

function mergeSourceValidation(base: ValidationOutput, source: SourceValidationResult): ValidationOutput {
  if (source.status === "FAIL") return { verdict: "FAIL", failureKind: "SEMANTIC_FAILURE", issues: [...base.issues, ...sourceIssues(source)] };
  if (source.status === "ERROR" || source.status === "NOT_EVALUATED") return { verdict: base.verdict === "FAIL" ? "FAIL" : "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [...base.issues, ...sourceIssues(source)] };
  return base;
}

function sourceContextForScene(expected: ExpectedState, scene: SceneExpectedState, validationStage: "START_FRAME" | "SCENE_VIDEO") {
  return expected.sourceValidation ? { ...expected.sourceValidation, sourceSceneId: scene.sourceSceneId ?? null, generatedSceneId: scene.sceneId, generatedAssetType: validationStage, validationStage } : undefined;
}

export function applyImageSourceValidation(base: ValidationOutput, expected: ExpectedState, scene: SceneExpectedState, rawObservation: unknown): ValidationOutput {
  const context = sourceContextForScene(expected, scene, "START_FRAME");
  if (!context) return base;
  const raw = asRecord(rawObservation);
  const adapted = adaptImageSourceObservationVerdicts(raw);
  const observation = { ...adapted.observation, technicalStatus: raw.technicalStatus ?? (base.verdict === "PASS" ? true : base.verdict === "FAIL" ? false : null) } as GeneratedImageObservation;
  return {
    ...mergeSourceValidation(base, validateImageSource(context, observation)),
    ...(Object.keys(raw).length ? { sourceObservation: raw } : {}),
    ...(adapted.diagnostic.verdictCanonicalizationApplied ? { verdictCanonicalization: adapted.diagnostic } : {}),
  };
}

const SCENE_VIDEO_BOOLEAN_VERDICT_FIELDS = [
  "actionMatch",
  "actionOrderMatch",
  "cameraMatch",
  "propInteractionMatch",
  "spatialMatch",
  "timingMatch",
  "startStateMatch",
  "endStateMatch",
  "beatMatch",
  "temporalContinuity",
  "characterIdentityMatch",
  "technicalStatus",
] as const;

function adaptSceneVideoVerdicts(rawObservation: Record<string, unknown>) {
  const observation = { ...rawObservation };
  for (const field of SCENE_VIDEO_BOOLEAN_VERDICT_FIELDS) {
    if (observation[field] === "PASS") observation[field] = true;
    else if (observation[field] === "FAIL") observation[field] = false;
  }
  return observation;
}

function applySceneVideoSourceValidation(base: ValidationOutput, expected: ExpectedState, scene: SceneExpectedState, rawObservation: unknown): ValidationOutput {
  const context = sourceContextForScene(expected, scene, "SCENE_VIDEO");
  if (!context) return base;
  const raw = asRecord(rawObservation);
  const adapted = adaptSceneVideoVerdicts(raw);
  const observation = { ...adapted, technicalStatus: adapted.technicalStatus ?? (base.verdict === "PASS" ? true : base.verdict === "FAIL" ? false : null) } as GeneratedSceneVideoObservation;
  return { ...mergeSourceValidation(base, validateSceneVideoSource(context, observation)), ...(Object.keys(raw).length ? { sourceObservation: raw } : {}) };
}

function applyFinalSourceValidation(base: ValidationOutput, expected: ExpectedState, rawObservation: unknown): ValidationOutput {
  if (!expected.sourceValidation) return base;
  const raw = asRecord(rawObservation);
  return { ...mergeSourceValidation(base, validateFinalVideoSource({ ...expected.sourceValidation, validationStage: "FINAL_VIDEO", generatedAssetType: "FINAL_VIDEO" }, raw as FinalVideoObservation)), ...(Object.keys(raw).length ? { sourceObservation: raw } : {}) };
}

function applyBrowserSourceValidation(base: ValidationOutput, expected: ExpectedState, stage: CodexStage, rawResult: unknown): ValidationOutput {
  if (!expected.sourceValidation || stage === "FINAL_AUDIT") return stage === "FINAL_AUDIT" ? applyFinalSourceValidation(base, expected, asRecord(rawResult).sourceObservation) : base;
  const payload = asRecord(rawResult);
  const observations = Array.isArray(payload.sourceObservations) ? payload.sourceObservations : [];
  const scenes = expected.scenes ?? [];
  if (!observations.length || observations.length < scenes.length) return { verdict: base.verdict === "FAIL" ? "FAIL" : "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [...base.issues, { code: "SOURCE_VALIDATION_NOT_EVALUATED", message: "Browser Quality Validator không trả đủ source observation cho mọi scene." }] };
  return scenes.reduce((current, scene, index) => stage === "ASSETS" ? applyImageSourceValidation(current, expected, scene, observations[index]) : applySceneVideoSourceValidation(current, expected, scene, observations[index]), base);
}

async function validateScene(apiKey: string, userId: string, expected: ExpectedState, scene: SceneExpectedState) {
  let file: GeminiFile | undefined;
  try {
    file = await uploadFile(apiKey, await readProjectVideo(expected.projectId!, userId, scene.sceneNumber), "video/mp4", `scene-${scene.sceneNumber}.mp4`);
    const result = await generateVerdict(apiKey, [{ file_data: { file_uri: file.uri, mime_type: "video/mp4" } }], `You are a strict video quality validator. Compare the actual 4-second scene with Expected State and source scene. Check character identity, background, required props, primary action, ordered action sequence, camera, duration, dialogue/audio intent, emotion, continuity, forbidden elements, source modeling intent, and whether the gag/action actually occurs. Return sourceObservation with actionMatch, actionSequence, actionOrderMatch, cameraMatch, propInteractionMatch, spatialMatch, timingMatch, generatedDuration, startStateMatch, endStateMatch, beatMatch, temporalContinuity and characterIdentityMatch; use null when evidence is insufficient. Return JSON only with verdict PASS|FAIL|UNCERTAIN, issues and summary. Do not pass merely because the file renders. Expected State: ${JSON.stringify(scene)}`);
    return applySceneVideoSourceValidation(normalizeProviderVerdict(result), expected, scene, result.sourceObservation);
  } finally {
    await deleteFile(apiKey, file);
  }
}

export async function validateQuality(userId: string, stage: CodexStage, expected: ExpectedState): Promise<ValidationOutput> {
  if (process.env.DESKTOP_MODE === "1" && expected.projectId) {
    try {
      const project = await db.contentProject.findFirst({ where: { id: expected.projectId, channel: { userId } }, select: { channelId: true } });
      if (!project) throw new Error("QUALITY_PROJECT_NOT_FOUND");
      const automationRun = await db.automationRun.findFirst({ where: { projectId: expected.projectId }, orderBy: { startedAt: "desc" }, select: { id: true } });
      const queued = await new LocalJobQueue().enqueue("desktop.flow.quality", {
        userId, projectId: expected.projectId, channelId: project.channelId, stage, automationRunId: automationRun?.id ?? null,
        expectedState: redactSecrets(expected),
      }, `browser-quality:${expected.projectId}:${stage}:${crypto.randomUUID()}`);
      const result = await waitForBridgeJob(queued.jobId);
      const normalized = normalizeProviderVerdict(result as ProviderVerdict);
      return applyBrowserSourceValidation(normalized, expected, stage, result);
    } catch (error) {
      return { verdict: "UNCERTAIN", failureKind: "TECHNICAL_FAILURE", issues: [{ code: "QUALITY_BROWSER_FAILURE", message: redactSecrets(error instanceof Error ? error.message : "Kiểm tra chất lượng trình duyệt thất bại.") }] };
    }
  }
  const apiKey = await geminiKey(userId);
  if (!apiKey) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [{ code: "GEMINI_QUALITY_CONNECTION_REQUIRED", message: "Cần kết nối Gemini để kiểm tra chất lượng hình/video thực tế." }] };
  if (!expected.projectId) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [{ code: "PROJECT_ID_MISSING", message: "Expected State thiếu projectId." }] };
  try {
    if (stage === "ASSETS") {
      const results: ValidationOutput[] = [];
      const background = await readProjectImage(expected.projectId, userId, "background", 0, expected.candidateId);
      results.push(normalizeProviderVerdict(await generateVerdict(apiKey, [{ inline_data: { mime_type: background.mimeType, data: background.data.toString("base64") } }], `Validate this approved background plate. It must be one coherent empty full-frame environment, preserve the expected location, layout, lighting and landmarks, and contain no character, collage, storyboard, split panel, caption, label or logo. Return JSON only with verdict PASS|FAIL|UNCERTAIN and issues. Expected backgrounds: ${JSON.stringify((expected.scenes ?? []).map((scene) => scene.expectedBackground))}`)));
      for (const scene of expected.scenes ?? []) {
        const image = await readProjectImage(expected.projectId, userId, "scene", scene.sceneNumber, expected.candidateId);
        const providerResult = await generateVerdict(apiKey, [{ inline_data: { mime_type: image.mimeType, data: image.data.toString("base64") } }], `Validate this scene start-frame against Expected State. Check CHARACTER IDENTITY separately from SCENE APPEARANCE and SOURCE SHOT separately. Return sourceObservation with cameraType, shotSize, cameraAngle, cameraMovement, subjectPosition, poseOrientationMatch, gazeTargetMatch when relevant, relativeObjectPositions, startStateMatch, keyPropPresenceMatch, framingIntentMatch and characterIdentityMatch; use null when evidence is insufficient. Identity means face, facial structure, base hairstyle, skin tone, body proportions, height/build, age appearance and distinctive physical traits. Scene Appearance means this scene's wardrobe, accessories, temporary condition and required props; the canonical reference outfit must not override it. Use CHARACTER_IDENTITY_MISMATCH only for wrong identity and SCENE_APPEARANCE_MISMATCH only for wrong clothing/accessories/props when identity is correct. It must be one full-frame image showing the exact frozen initial state, with no collage, storyboard, split panels, labels, captions, logos or unrelated elements. Return JSON only with verdict PASS|FAIL|UNCERTAIN and issues. Expected State: ${JSON.stringify(scene)}`);
        const verdict = applyImageSourceValidation(normalizeProviderVerdict(providerResult), expected, scene, providerResult.sourceObservation);
        results.push({ ...verdict, issues: verdict.issues.map((issue) => ({ ...issue, sceneNumber: scene.sceneNumber })) });
      }
      const issues = results.flatMap((result) => result.issues);
      if (results.some((result) => result.verdict === "FAIL")) return { verdict: "FAIL", failureKind: "SEMANTIC_FAILURE", issues };
      if (results.some((result) => result.verdict === "UNCERTAIN")) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues };
      return { verdict: "PASS", issues: [] };
    }
    if (stage === "SCENES") {
      const sceneResults: ValidationOutput[] = [];
      // Provider-aware batch size: two independent validations in parallel. Flow
      // generation itself remains sequential because it uses one browser session.
      for (let index = 0; index < (expected.scenes ?? []).length; index += 2) sceneResults.push(...await Promise.all((expected.scenes ?? []).slice(index, index + 2).map((scene) => validateScene(apiKey, userId, expected, scene))));
      const issues = sceneResults.flatMap((result) => result.issues);
      if (sceneResults.some((result) => result.verdict === "FAIL")) return { verdict: "FAIL", failureKind: "SEMANTIC_FAILURE", issues };
      if (sceneResults.some((result) => result.verdict === "UNCERTAIN")) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues };
      return { verdict: "PASS", issues: [] };
    }
    if (stage === "FINAL_AUDIT") {
      let file: GeminiFile | undefined;
      try {
        file = await uploadFile(apiKey, await readProjectFinalVideo(expected.projectId, userId), "video/mp4", "final-modeling-video.mp4");
        const providerResult = await generateVerdict(apiKey, [{ file_data: { file_uri: file.uri, mime_type: "video/mp4" } }], `Perform the mandatory Final Audit of this modeling video. Verify technical playability, all scenes and correct order, no duplicate scene, CHARACTER IDENTITY continuity separately from each scene's SCENE APPEARANCE continuity, background/prop continuity, action and audio, expected pacing and ending, source fidelity, modeling mechanism, core gag, and final storytelling goal. Return sourceObservation with sceneOrder, structureMatch, beatMatch, timingMatch, rhythmMatch, transitionMatch, punchlineMatch, cameraPatternMatch and actionPatternMatch; use null when evidence is insufficient. Wardrobe and accessories are scene-specific and must come from each Scene Expected State, not blindly from the canonical reference. Use CHARACTER_IDENTITY_MISMATCH only for identity divergence and SCENE_APPEARANCE_MISMATCH for clothing/accessory/prop divergence when identity remains correct. Do not pass only because rendering succeeded. Return JSON only with verdict PASS|FAIL|UNCERTAIN and concrete issues including sceneNumber when known. Expected State: ${JSON.stringify(expected)}`);
        return applyFinalSourceValidation(normalizeProviderVerdict(providerResult), expected, providerResult.sourceObservation);
      } finally {
        await deleteFile(apiKey, file);
      }
    }
    return { verdict: "PASS", issues: [] };
  } catch (error) {
    return { verdict: "UNCERTAIN", failureKind: "TECHNICAL_FAILURE", issues: [{ code: "QUALITY_PROVIDER_FAILURE", message: redactSecrets(error instanceof Error ? error.message : "Quality provider failed.") }] };
  }
}
