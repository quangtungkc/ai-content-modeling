import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { AppError } from "@/lib/errors";
import { db } from "@/lib/db";
import { assertCharacterIdentityPackReady } from "@/modules/assets/character-identity";
import { getCharacterIdentityPack } from "@/modules/channels/identity-pack";
import { assertStrictModelingReady, CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS } from "@/modules/modeling/strict-source-modeling";
import { buildIncidentFingerprint } from "@/modules/troubleshooting/fingerprint";
import { incidentSchema } from "@/modules/troubleshooting/incident-schema";
import { TroubleshootingIncidentRepository } from "@/modules/troubleshooting/incident-repository";
import { ensureTroubleshootingStorage } from "@/modules/troubleshooting/storage";
import { boundedPromptRecompile, compileStrictPrompt, compileStrictVideoPrompt, promptFidelityGate, validatePromptFidelity, type PromptExpectedState, type PromptTextPolicy, type PromptType } from "./validator";

export type PreparedPrompt = { promptId: string; promptType: PromptType; compiledPromptHash: string; validatedPrompt: string; promptHash: string; validationResults: ReturnType<typeof validatePromptFidelity>; expected: PromptExpectedState };

let traceStorageReady: Promise<void> | null = null;
function ensurePromptFidelityStorage() {
  if (!traceStorageReady) traceStorageReady = (async () => {
    await db.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS "PromptFidelityTrace" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "sceneId" TEXT, "sourceSceneId" TEXT, "promptType" TEXT NOT NULL, "sourceSpecVersion" TEXT NOT NULL, "expectedStateVersion" TEXT NOT NULL, "characterIdentityPackVersion" TEXT NOT NULL, "geminiDraftPrompt" TEXT NOT NULL, "validatedPrompt" TEXT NOT NULL, "validationResults" JSONB NOT NULL, "validationEvidence" JSONB NOT NULL, "promptHash" TEXT NOT NULL, "actualSentPromptHash" TEXT, "validatedAt" DATETIME NOT NULL, "sentAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)');
    await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PromptFidelityTrace_projectId_sceneId_promptType_createdAt_idx" ON "PromptFidelityTrace"("projectId", "sceneId", "promptType", "createdAt")');
    await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "PromptFidelityTrace_projectId_promptHash_idx" ON "PromptFidelityTrace"("projectId", "promptHash")');
  })();
  return traceStorageReady;
}

function hashPrompt(prompt: string) {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

function inferTextPolicy(prompt: string): PromptTextPolicy {
  const required = prompt.match(/REQUIRED_TEXT\s*(?:is\s+exactly|exactly|:)\s*["“]([^"”]+)["”]/i)?.[1]?.trim();
  if (required) return { mode: "REQUIRED_TEXT", requiredText: required };
  return { mode: "NO_READABLE_TEXT" };
}

function textPolicyFromInput(prompt: string, policy?: PromptTextPolicy) {
  return policy ?? inferTextPolicy(prompt);
}

async function recordPromptValidationFailure(expected: PromptExpectedState, validation: ReturnType<typeof validatePromptFidelity>) {
  try {
    await ensureTroubleshootingStorage();
    const failedValidators = validation.checks.filter((check) => check.status !== "PASS").map((check) => check.validatorId);
    const first = failedValidators[0] ?? "PROMPT_VALIDATION";
    const firstDivergence = first.includes("CHARACTER") ? "PROMPT_CHARACTER_IDENTITY_MISMATCH" : first.includes("SOURCE_BEAT") || first.includes("ACTION") || first.includes("CAMERA") || first.includes("SPATIAL") || first.includes("TIMING") || first.includes("STATE") ? "GEMINI_PROMPT_COMPILATION" : "PROMPT_VALIDATION";
    const incident = incidentSchema.parse({ projectId: expected.projectId, sceneNumber: expected.sourceScene?.order ?? null, stage: "PROMPT_COMPILATION", component: "prompt-fidelity-validator", symptoms: [`Prompt Fidelity Gate failed: ${first}`], errorMessages: failedValidators, errorCodes: failedValidators, firstDivergence, expectedState: { sourceSpecVersion: expected.sourceSpecVersion, sourceSceneId: expected.sourceSceneId, promptType: expected.promptType }, actualState: { failedValidators, validationStatus: validation.status }, evidence: [{ kind: "prompt-validation", source: "app-prompt-fidelity-validator", value: { failedValidators, validationEvidence: validation.validationEvidence } }], runtimeState: { generationStatus: "NOT_STARTED", outputReady: false }, checkpoint: { expectedStateVersion: expected.expectedStateVersion, characterIdentityPackVersion: expected.characterIdentityPackVersion }, attemptCount: 0, previousRepairAttempts: [], affectedFiles: [], preserveRequirements: ["Không gửi prompt chưa đạt gate xuống generation model.", "Giữ nguyên SourceVideoModelingSpec và Character Identity Pack."] });
    const fingerprint = buildIncidentFingerprint(incident);
    const existing = await db.troubleshootingIncident.findFirst({ where: { fingerprint: fingerprint.id }, orderBy: { updatedAt: "desc" }, select: { id: true, attemptCount: true } });
    const persisted = existing ? { ...incident, incidentId: existing.id, attemptCount: existing.attemptCount } : incident;
    const repository = new TroubleshootingIncidentRepository();
    await repository.record(persisted, fingerprint.id, "NEEDS_REVIEW");
    await repository.audit(persisted.incidentId, "PROMPT_FIDELITY_VALIDATION_FAILED", { failedValidators, promptType: expected.promptType, sourceSceneId: expected.sourceSceneId });
  } catch { /* Prompt gate remains the authority even if incident telemetry is unavailable. */ }
}

async function loadExpectedState(input: { projectId: string; userId: string; sceneNumber?: number; promptType: PromptType; draftPrompt: string; textPolicy?: PromptTextPolicy }) {
  await ensurePromptFidelityStorage();
  const project = await db.contentProject.findFirst({ where: { id: input.projectId, channel: { userId: input.userId } }, include: { scenes: { orderBy: { sceneNumber: "asc" } } } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy Content Project.", 404);
  const spec = assertStrictModelingReady({ sourceVideoId: project.sourceVideoId, sourceVideoUrl: project.sourceVideoUrl, sourceDuration: project.sourceDuration, modelingPolicy: project.modelingPolicy, sourceModelingSpec: project.sourceModelingSpec, generatedScenes: project.scenes.map((scene) => ({ sceneNumber: scene.sceneNumber, sourceSceneId: scene.sourceSceneId, targetDuration: scene.targetDuration })) });
  const scene = input.sceneNumber === undefined ? undefined : project.scenes.find((item) => item.sceneNumber === input.sceneNumber);
  if (input.sceneNumber !== undefined && !scene) throw new AppError("SCENE_NOT_FOUND", `Không tìm thấy cảnh ${input.sceneNumber}.`, 404);
  const sourceScene = scene?.sourceSceneId ? spec.scenes.find((item) => item.sourceSceneId === scene.sourceSceneId) : undefined;
  if (input.sceneNumber !== undefined && !sourceScene) throw new AppError("SOURCE_SCENE_MAPPING_MISSING", "Scene chưa có sourceSceneId hợp lệ.", 409);
  const pack = assertCharacterIdentityPackReady(await getCharacterIdentityPack(project.channelId, input.userId));
  const expected: PromptExpectedState = { projectId: project.id, sceneId: scene?.id ?? null, sourceSceneId: sourceScene?.sourceSceneId ?? null, sourceSpecVersion: project.sourceModelingSpecVersion ?? spec.specVersion, expectedStateVersion: `${project.sourceModelingSpecVersion ?? spec.specVersion}:${scene?.sourceSceneId ?? "background"}`, characterIdentityPackVersion: pack.characterId, timingTolerance: spec.timingTolerance, sourceScene, identityPack: { name: pack.name, lockedTraits: pack.lockedTraits, allowedVariations: pack.allowedVariations, negativeRules: pack.negativeRules }, sceneAppearance: scene ? [scene.visualBlock, scene.startFramePrompt ?? ""].filter(Boolean).join("\n") : "Apply only the approved environment/background transformation.", textPolicy: textPolicyFromInput(input.draftPrompt, input.textPolicy), allowedTransformations: [...CANONICAL_ALLOWED_MODELING_TRANSFORMATIONS], promptType: input.promptType };
  return { expected, pack, project, scene };
}

export async function preparePromptForGeneration(input: { projectId: string; userId: string; sceneNumber?: number; promptType: PromptType; draftPrompt: string; textPolicy?: PromptTextPolicy; recompilePrompt?: (input: { expected: PromptExpectedState; failedValidators: string[]; actualPrompt: string }) => Promise<string> }): Promise<PreparedPrompt> {
  const loaded = await loadExpectedState(input);
  const authoritativeDraftPrompt = input.promptType === "VIDEO" ? compileStrictVideoPrompt(loaded.expected, input.draftPrompt) : input.draftPrompt;
  const draftAttempt = await boundedPromptRecompile({ initialPrompt: authoritativeDraftPrompt, expected: loaded.expected, maxAttempts: 2, recompile: input.recompilePrompt });
  const draftValidation = draftAttempt.result;
  const draftGate = promptFidelityGate(draftValidation);
  if (!draftGate.generationAllowed) { await recordPromptValidationFailure(loaded.expected, draftValidation); throw new AppError("PROMPT_FIDELITY_GATE_FAILED", "Gemini draft prompt không đạt Prompt Fidelity Gate.", 409, { failedValidators: draftValidation.checks.filter((check) => check.status !== "PASS").map((check) => check.validatorId), validationResults: draftValidation }); }
  const validatedSeed = input.promptType === "VIDEO" ? draftAttempt.prompt : compileStrictPrompt(loaded.expected, draftAttempt.prompt);
  const validatedAttempt = await boundedPromptRecompile({ initialPrompt: validatedSeed, expected: loaded.expected, maxAttempts: 2 });
  const validatedPrompt = validatedAttempt.prompt;
  const validationResults = validatedAttempt.result;
  const gate = promptFidelityGate(validationResults);
  if (!gate.generationAllowed) { await recordPromptValidationFailure(loaded.expected, validationResults); throw new AppError("PROMPT_FIDELITY_GATE_FAILED", "Validated prompt không đạt Prompt Fidelity Gate.", 409, { failedValidators: validationResults.checks.filter((check) => check.status !== "PASS").map((check) => check.validatorId), validationResults }); }
  const promptId = randomUUID();
  const promptHash = hashPrompt(validatedPrompt);
  const compiledPromptHash = hashPrompt(draftAttempt.prompt);
  await db.promptFidelityTrace.create({ data: { id: promptId, projectId: loaded.project.id, sceneId: loaded.scene?.id ?? null, sourceSceneId: loaded.expected.sourceSceneId, promptType: input.promptType, sourceSpecVersion: loaded.expected.sourceSpecVersion, expectedStateVersion: loaded.expected.expectedStateVersion, characterIdentityPackVersion: loaded.expected.characterIdentityPackVersion, geminiDraftPrompt: draftAttempt.prompt, validatedPrompt, validationResults: validationResults as unknown as Prisma.InputJsonValue, validationEvidence: validationResults.validationEvidence as Prisma.InputJsonValue, promptHash, validatedAt: new Date() } });
  return { promptId, promptType: input.promptType, compiledPromptHash, validatedPrompt, promptHash, validationResults, expected: loaded.expected };
}

export async function verifyPersistedPromptForScene(input: { promptId: string; projectId: string; sceneId: string | null; promptType: PromptType; prompt: string; promptHash?: string }) {
  await ensurePromptFidelityStorage();
  const trace = await db.promptFidelityTrace.findUnique({ where: { id: input.promptId } });
  const actualHash = hashPrompt(input.prompt);
  if (!trace || trace.projectId !== input.projectId || trace.sceneId !== input.sceneId || trace.promptType !== input.promptType || trace.promptHash !== actualHash || (input.promptHash && input.promptHash !== actualHash)) throw new AppError("PROMPT_MUTATED_AFTER_VALIDATION", "Prompt thực tế khác validated prompt hoặc trace không thuộc scene hiện tại.", 409, { promptId: input.promptId, validatedPromptHash: trace?.promptHash ?? null, actualSentPromptHash: actualHash });
  return trace;
}

export async function verifyPersistedPromptByScene(input: { promptId: string; projectId: string; userId: string; sceneNumber?: number; promptType: PromptType; prompt: string; promptHash?: string }) {
  const project = await db.contentProject.findFirst({ where: { id: input.projectId, channel: { userId: input.userId } }, select: { id: true, scenes: { where: input.sceneNumber === undefined ? undefined : { sceneNumber: input.sceneNumber }, select: { id: true }, take: 1 } } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy Content Project.", 404);
  // A background prompt intentionally has no scene number and its trace has
  // sceneId=null. Do not select the first scene as a surrogate identity.
  const sceneId = input.sceneNumber === undefined ? null : project.scenes[0]?.id ?? null;
  if (input.sceneNumber !== undefined && !sceneId) throw new AppError("SCENE_NOT_FOUND", "Không tìm thấy scene.", 404);
  return verifyPersistedPromptForScene({ promptId: input.promptId, projectId: input.projectId, sceneId, promptType: input.promptType, prompt: input.prompt, promptHash: input.promptHash });
}

export async function markPromptSent(promptId: string, actualPrompt: string) {
  await ensurePromptFidelityStorage();
  const actualSentPromptHash = hashPrompt(actualPrompt);
  const trace = await db.promptFidelityTrace.findUnique({ where: { id: promptId }, select: { id: true, promptHash: true } });
  if (!trace || trace.promptHash !== actualSentPromptHash) throw new AppError("PROMPT_MUTATED_AFTER_VALIDATION", "Prompt bị thay đổi sau validation.", 409, { promptId, validatedPromptHash: trace?.promptHash ?? null, actualSentPromptHash });
  await db.promptFidelityTrace.update({ where: { id: promptId }, data: { actualSentPromptHash, sentAt: new Date() } });
  return actualSentPromptHash;
}

export { hashPrompt };
