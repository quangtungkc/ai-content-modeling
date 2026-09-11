import { createHash } from "node:crypto";
import type { CodexAction, CodexStage, CodexStageSnapshot, ExpectedState, FailureKind, SceneExpectedState, ValidationIssue, ValidationOutput } from "./types";

const stageAction: Record<CodexStage, CodexAction["name"]> = {
  ANALYSIS: "runAnalysisStage",
  MODELING: "runModelingStage",
  PROJECT: "runProjectDevelopmentStage",
  ASSETS: "runAssetStage",
  SCENES: "runSceneGenerationStage",
  FINAL_ASSEMBLY: "runFinalAssembly",
  FINAL_AUDIT: "runFinalAudit",
  POST_RUN_REVIEW: "runPostRunReview",
};

const secretPatterns = [
  /\b(?:sk|sess|pat|ghp|AIza)[-_A-Za-z0-9]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi,
  /\b(?:api[_-]?key|access[_-]?token|password|client[_-]?secret|encryption[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi,
];

export function redactSecrets<T>(value: T): T {
  if (typeof value === "string") {
    let redacted: string = value;
    for (const pattern of secretPatterns) redacted = redacted.replace(pattern, "[REDACTED]");
    return redacted as unknown as T;
  }
  if (Array.isArray(value)) return value.map(redactSecrets) as T;
  if (value && typeof value === "object") {
    const sensitiveName = /^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|client[_-]?secret|encryption[_-]?key|encryptedKey|credential|credentials)$/i;
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, sensitiveName.test(key) ? "[REDACTED]" : redactSecrets(item)])) as T;
  }
  return value;
}

export function classifyFailure(message: string, validationFailure = false): FailureKind {
  if (validationFailure) return "SEMANTIC_FAILURE";
  if (/\binvalid_(?:type|value|input)\b|expected .*received|path.*storyboard|structured output/i.test(message)) return "TECHNICAL_FAILURE";
  if (/\b(?:TypeError|ReferenceError|SyntaxError)\b|cannot find module|prisma.*validation|schema.*(?:parse|invalid)|structured output.*(?:invalid|không hợp lệ)|code defect|invariant/i.test(message)) return "ENGINEERING_FAILURE";
  return /wrong|mismatch|missing (?:character|prop|scene|action|background)|continuity|deviation|gag|semantic/i.test(message)
    ? "SEMANTIC_FAILURE"
    : "TECHNICAL_FAILURE";
}

export function createErrorSignature(stage: CodexStage, message: string) {
  const normalized = redactSecrets(message).toLowerCase().replace(/https?:\/\/\S+/g, "<url>").replace(/[a-f0-9]{16,}/g, "<id>").replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
  return `${stage}:${createHash("sha256").update(normalized).digest("hex").slice(0, 16)}`;
}

export function nextPendingAction(stages: CodexStageSnapshot[]): CodexAction {
  const stage = stages.find((item) => item.status === "RUNNING" || item.status === "RETRYING") ?? stages.find((item) => item.status === "PENDING");
  if (!stage) return { name: "jobComplete", reason: "Không còn stage chờ chạy." };
  return { name: stageAction[stage.stage], stage: stage.stage, strategy: stage.lastStrategy };
}

export function recoveryStrategies(stage: CodexStage, kind: FailureKind, errorMessage: string): string[] {
  if (kind === "ENGINEERING_FAILURE") return ["codex-guarded-code-repair"];
  const message = errorMessage.toLowerCase();
  if (kind === "TECHNICAL_FAILURE" && /invalid_(?:type|value|input)|expected .*received|structured output/.test(message)) return ["retry-structured-output", "switch-ai-provider", "resume-from-checkpoint"];
  if (/reference.*(?:reject|invalid)|unsupported.*image/.test(message)) return ["normalize-reference-image", "convert-reference-to-png", "use-single-start-frame-reference"];
  if (/rate.?limit|429|quota/.test(message)) return ["provider-backoff", "reduce-batch-size", "resume-from-checkpoint"];
  if (/timeout|network|fetch|connection/.test(message)) return ["retry-with-jitter", "refresh-provider-session", "resume-from-checkpoint"];
  if (stage === "ASSETS") return kind === "SEMANTIC_FAILURE" ? ["strengthen-asset-constraints", "regenerate-failed-assets-only", "request-human-asset-review"] : ["refresh-flow-page", "retry-failed-assets-only", "resume-from-checkpoint"];
  if (stage === "SCENES") return kind === "SEMANTIC_FAILURE" ? ["strengthen-scene-expected-state", "regenerate-failed-scenes-only", "request-human-scene-review"] : ["refresh-flow-page", "retry-failed-scenes-only", "resume-from-checkpoint"];
  if (stage === "FINAL_ASSEMBLY" || stage === "FINAL_AUDIT") return ["reassemble-failed-scene-set", "reencode-final-output", "request-human-final-review"];
  return ["retry-stage-once", "resume-from-checkpoint", "request-human-review"];
}

export function chooseRecoveryStrategy(strategies: string[], attempted: string[], successfulExperience?: string | null) {
  if (successfulExperience && !attempted.includes(successfulExperience)) return successfulExperience;
  return strategies.find((strategy) => !attempted.includes(strategy)) ?? null;
}

export function planSceneBatches(sceneNumbers: number[], maxConcurrency: number) {
  const unique = [...new Set(sceneNumbers)].sort((a, b) => a - b);
  const limit = Math.max(1, Math.floor(maxConcurrency));
  const batches: number[][] = [];
  for (let index = 0; index < unique.length; index += limit) batches.push(unique.slice(index, index + limit));
  return batches;
}

export const hasReachedRetryLimit = (retryCount: number, maxRetries: number) => retryCount >= maxRetries;
export const shouldCreateImprovementCandidate = (occurrenceCount: number, rootCauseConfirmedInCode = false) => rootCauseConfirmedInCode || occurrenceCount >= 2;
export const shouldUseCodexPipeline = (enabled: boolean) => enabled;
export const findIncompleteFinalAuditPrerequisite = (stages: Array<{ stage: string; status: string }>) => ["ANALYSIS", "MODELING", "PROJECT", "ASSETS", "SCENES", "FINAL_ASSEMBLY"].map((name) => stages.find((stage) => stage.stage === name)).find((stage) => !stage || stage.status !== "COMPLETED");

const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const numbers = (value: unknown) => Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : [];
const sameNumbers = (left: number[], right: number[]) => left.length === right.length && left.every((item, index) => item === right[index]);

export function validateExpectedActual(expected: ExpectedState | undefined, actual: Record<string, unknown> | undefined): ValidationOutput {
  if (!expected || !actual) return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [{ code: "STATE_MISSING", message: "Thiếu Expected State hoặc Actual State." }] };
  const issues: ValidationIssue[] = [];
  if (expected.requiredAssetKeys) {
    const generated = new Set(strings(actual.generatedAssetKeys));
    for (const key of expected.requiredAssetKeys) if (!generated.has(key)) issues.push({ code: "ASSET_MISSING", message: `Thiếu asset ${key}.`, targetId: key });
  }
  if (expected.expectedSceneNumbers) {
    const generated = new Set(numbers(actual.generatedSceneNumbers));
    for (const sceneNumber of expected.expectedSceneNumbers) if (!generated.has(sceneNumber)) issues.push({ code: "SCENE_MISSING", message: `Thiếu video cảnh ${sceneNumber}.`, sceneNumber });
  }
  if (expected.expectedSceneOrder) {
    const actualOrder = numbers(actual.sceneOrder);
    if (!sameNumbers(expected.expectedSceneOrder, actualOrder)) issues.push({ code: "SCENE_ORDER_MISMATCH", message: "Thứ tự cảnh không đúng Expected State.", expected: expected.expectedSceneOrder, actual: actualOrder });
  }
  if (expected.expectedAspectRatio && actual.aspectRatio !== expected.expectedAspectRatio) issues.push({ code: "ASPECT_RATIO_MISMATCH", message: "Sai tỷ lệ khung hình.", expected: expected.expectedAspectRatio, actual: actual.aspectRatio });
  if (expected.requireAudio && actual.hasAudio !== true) issues.push({ code: "AUDIO_MISSING", message: "Video cuối chưa xác nhận có âm thanh." });
  if (expected.requireFinalVideo && actual.finalVideoAvailable !== true) issues.push({ code: "FINAL_VIDEO_MISSING", message: "Chưa có video cuối hợp lệ." });
  if (actual.semanticVerdict === "FAIL") issues.push(...((Array.isArray(actual.semanticIssues) ? actual.semanticIssues : []) as ValidationIssue[]));
  if (issues.length) return { verdict: "FAIL", failureKind: "SEMANTIC_FAILURE", issues };
  if (expected.scenes?.length && actual.semanticVerdict !== "PASS" && (expected.stage === "SCENES" || expected.stage === "FINAL_AUDIT")) {
    return { verdict: "UNCERTAIN", failureKind: "SEMANTIC_FAILURE", issues: [{ code: "SEMANTIC_AUDIT_REQUIRED", message: "Cần Quality Validator xác nhận nội dung hình ảnh/video." }] };
  }
  return { verdict: "PASS", issues: [] };
}

function extractList(text: string) {
  return text.split(/[\n,;•]/).map((item) => item.replace(/^\s*\d+[.)-]?\s*/, "").trim()).filter(Boolean).slice(0, 20);
}

export function buildSceneExpectedState(input: {
  sceneId: string;
  sceneNumber: number;
  visualBlock: string;
  actionBlock: string;
  audioBlock: string;
  startFramePrompt?: string | null;
  englishPrompt?: string | null;
  characterDesign: unknown;
  backgroundDesign: unknown;
  sourceModelingIntent: string;
}): SceneExpectedState {
  return {
    sceneId: input.sceneId,
    sceneNumber: input.sceneNumber,
    expectedCharacter: input.characterDesign,
    characterVersion: 1,
    expectedBackground: input.backgroundDesign,
    requiredProps: extractList(input.visualBlock).filter((item) => /prop|vật|đạo cụ|cầm|trên bàn|trên tay/i.test(item)),
    expectedAction: input.actionBlock,
    expectedCamera: input.visualBlock,
    expectedDuration: 4,
    expectedDialogue: input.audioBlock,
    expectedEmotion: input.visualBlock,
    requiredVisualElements: extractList(input.visualBlock),
    forbiddenElements: ["unrelated character", "unrelated prop", "collage", "storyboard", "split panel", "caption", "logo"],
    sourceModelingIntent: input.sourceModelingIntent,
    startFramePrompt: input.startFramePrompt ?? "",
    videoPrompt: input.englishPrompt ?? "",
  };
}
