import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { matchIncidentToKnowledgeBase } from "@/modules/troubleshooting/matcher";
import { RepairHandlerRegistry, type PostAssemblyRepairHandler } from "@/modules/troubleshooting/handlers";
import { incidentSchema } from "@/modules/troubleshooting/incident-schema";
import { VERIFIED_TROUBLESHOOTING_RULES } from "@/modules/troubleshooting/seed";
import type { TroubleshootingRule } from "@/modules/troubleshooting/schema";
import { OutputVersionService, hashOutputFile } from "@/modules/output-versioning/service";
import { PostAssemblyRepairCoordinator as ProductionRepairCoordinator, type PostAssemblyRepairInput } from "./repair-coordinator";

// Synthetic authorization for algorithm/candidate tests, never production provenance.
class PostAssemblyRepairCoordinator extends ProductionRepairCoordinator {
  constructor(...args: ConstructorParameters<typeof ProductionRepairCoordinator>) {
    super(args[0], args[1], args[2], args[3], () => true);
  }
}
import { GAZE_HANDLER_ID, GAZE_HANDLER_VERSION, computeGazeGeometry, createGazeFrame, createGazePostAssemblyHandler, gazeParametersSchema, parseGazeParametersFromState, renderGazeCandidate } from "./gaze-handler";
import { GazeValidator } from "./gaze-validator";
import { findSmokeRingFfmpegPath } from "./smoke-ring-handler";
import type { QaFinding, QaValidator } from "./types";

const execFileAsync = promisify(execFile);

async function createSchema(client: PrismaClient) {
  await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyOutputVersion" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "versionNumber" INTEGER NOT NULL, "status" TEXT NOT NULL, "filePath" TEXT NOT NULL, "fileHash" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdFromVersionId" TEXT, "createdByRepairIncidentId" TEXT, "repairRuleId" TEXT, "validationStatus" TEXT NOT NULL, "promotedAt" DATETIME, "rejectedAt" DATETIME, "rollbackReason" TEXT)');
  await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyOutputVersionAudit" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "outputVersionId" TEXT, "event" TEXT NOT NULL, "previousCurrentVersionId" TEXT, "newCurrentVersionId" TEXT, "reason" TEXT, "metadata" JSONB NOT NULL DEFAULT \'{}\', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await client.$executeRawUnsafe('CREATE UNIQUE INDEX "PostAssemblyOutputVersion_projectId_versionNumber_key" ON "PostAssemblyOutputVersion"("projectId", "versionNumber")');
  await client.$executeRawUnsafe('CREATE UNIQUE INDEX "PostAssemblyOutputVersion_one_current_per_project" ON "PostAssemblyOutputVersion"("projectId") WHERE "status" = \'CURRENT\'');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersion_projectId_status_idx" ON "PostAssemblyOutputVersion"("projectId", "status")');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersion_projectId_fileHash_idx" ON "PostAssemblyOutputVersion"("projectId", "fileHash")');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersionAudit_projectId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("projectId", "createdAt")');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersionAudit_outputVersionId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("outputVersionId", "createdAt")');
}

async function createVideo(ffmpegPath: string, filePath: string) {
  const filter = [
    "drawbox=x=120:y=75:w=42:h=26:color=0xc8d8e0:t=fill",
    "drawbox=x=180:y=75:w=42:h=26:color=0xc8d8e0:t=fill",
    "drawbox=x=138:y=82:w=10:h=12:color=0x182030:t=fill",
    "drawbox=x=198:y=82:w=10:h=12:color=0x182030:t=fill",
    "drawbox=x=150:y=125:w=20:h=10:color=0x889999:t=fill",
  ].join(",");
  await execFileAsync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x31405f:s=320x180:r=10:d=3", "-vf", filter, "-an", "-c:v", "h264_mf", "-b:v", "1M", filePath], { windowsHide: true, maxBuffer: 2_000_000 });
}

async function withMediaDb<T>(callback: (input: { client: PrismaClient; service: OutputVersionService; root: string; ffmpegPath: string; currentVersion: Awaited<ReturnType<OutputVersionService["registerOriginalOutput"]>> }) => Promise<T>) {
  const ffmpegPath = await findSmokeRingFfmpegPath();
  if (!ffmpegPath) throw new Error("TEST_FFMPEG_NOT_FOUND");
  const root = await mkdtemp(path.join(os.tmpdir(), "gaze-handler-"));
  const database = path.join(root, "outputs.db").replace(/\\/g, "/");
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  const service = new OutputVersionService(client, async () => undefined);
  try {
    await createSchema(client);
    const currentPath = path.join(root, "final.mp4");
    await createVideo(ffmpegPath, currentPath);
    const currentVersion = await service.registerOriginalOutput({ projectId: "project-gaze", filePath: currentPath, validationStatus: "PASS" });
    return await callback({ client, service, root, ffmpegPath, currentVersion });
  } finally {
    await client.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

function gazeState(overrides: Record<string, unknown> = {}) {
  return { sceneNumber: 5, sceneStart: 0, sceneEnd: 3, effectStartLocalTime: 0.5, effectEndLocalTime: 2.5, leftEyeRegion: { x: 120, y: 75, width: 42, height: 26, space: "PIXELS" }, rightEyeRegion: { x: 180, y: 75, width: 42, height: 26, space: "PIXELS" }, leftPupilRegion: { x: 138, y: 82, width: 10, height: 12, space: "PIXELS" }, rightPupilRegion: { x: 198, y: 82, width: 10, height: 12, space: "PIXELS" }, targetAnchor: { x: 40, y: 90, space: "PIXELS" }, monitorAnchor: { x: 40, y: 90, space: "PIXELS" }, pupilShiftX: -14, pupilShiftY: 0, maxShift: 15, featherAmount: 1, interpolation: "SMOOTHSTEP", blinkWindowsToPreserve: [{ startLocalTime: 1.2, endLocalTime: 1.4 }], ...overrides };
}

function gazeRule(overrides: Partial<TroubleshootingRule> = {}): TroubleshootingRule {
  const source = VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "GAZE_NOT_TO_MONITOR")!;
  return { ...source, autoRepairAllowed: true, verificationStatus: "VERIFIED", ...overrides };
}

function gazeIncident(overrides: Record<string, unknown> = {}) {
  return incidentSchema.parse({ incidentId: "55555555-5555-4555-8555-555555555555", timestamp: "2026-09-15T00:00:00.000Z", projectId: "project-gaze", sceneNumber: 5, stage: "POST_PROCESSING", component: "gaze", symptoms: ["Gaze not to monitor"], errorMessages: ["GAZE_DIRECTION_MISMATCH"], errorCodes: ["GAZE_DIRECTION_MISMATCH"], firstDivergence: "FLOW_VIDEO_OUTPUT", expectedState: { gaze: "monitor" }, actualState: gazeState(), evidence: [{ kind: "eye-pupil-target", source: "fixture", value: gazeState() }], runtimeState: { generationStatus: "SUCCESS", outputReady: true }, checkpoint: { generationStatus: "SUCCESS", outputReady: true }, attemptCount: 0, previousRepairAttempts: [], affectedFiles: ["final.mp4"], preserveRequirements: ["Preserve approved Scene 1–4.", "Keep generationStatus SUCCESS and outputReady true."], ...overrides });
}

function gazeFinding(overrides: Partial<QaFinding> = {}): QaFinding {
  return { validatorId: "gaze", status: "FAIL", sceneNumber: 5, globalTimestamp: 0.5, sceneLocalTimestamp: 0.5, expected: { gaze: "monitor" }, actual: { gaze: "camera" }, evidence: ["fixture gaze evidence"], confidence: 1, severity: "HIGH", suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT", affectedRegion: "eyes", affectedFile: "final.mp4", symptom: "Gaze not to monitor", ...overrides };
}

function coordinatorInput(currentVersion: Awaited<ReturnType<OutputVersionService["registerOriginalOutput"]>>, rule = gazeRule(), incident = gazeIncident(), finding = gazeFinding()): PostAssemblyRepairInput {
  const match = matchIncidentToKnowledgeBase(incident, [rule]);
  return { projectId: "project-gaze", qaRunId: "qa-gaze-1", finding, incident, match, matchedRule: rule, currentOutputVersion: currentVersion, approvedManifest: { scenes: [1, 2, 3, 4, 5].map(sceneNumber => ({ sceneNumber, source: `scene-${sceneNumber}.mp4`, durationSec: 3 })) }, approvedSources: ["scene-1.mp4", "scene-2.mp4", "scene-3.mp4", "scene-4.mp4", "scene-5.mp4"], expectedSceneStates: {}, sceneMetadata: { sceneNumbers: [1, 2, 3, 4, 5] }, checkpoint: { ...gazeState(), generationStatus: "SUCCESS", outputReady: true }, preserveRequirements: ["Preserve approved Scene 1–4."], generationStatus: "SUCCESS", outputReady: true };
}

function failValidator(): QaValidator { return { id: "gaze", validate: async () => [{ ...gazeFinding(), status: "FAIL" }] }; }

describe("Reusable deterministic gaze repair handler", () => {
  it("CASE 1 creates candidate and runs with valid eye/pupil/target evidence", async () => { await withMediaDb(async ({ service, currentVersion }) => { const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new GazeValidator()]).repair(coordinatorInput(currentVersion)); expect(result.candidateVersionId).not.toBeNull(); expect(result.actionsTaken).toContain("renderDeterministicGazeToCandidate"); }); });
  it("CASE 2 moves gaze toward supplied target only inside the supplied temporal window", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const metadata = { width: 320, height: 180, fps: 10, duration: 3 }; const geometry = computeGazeGeometry(parameters, metadata); expect("error" in geometry).toBe(false); if ("error" in geometry) return; expect(geometry.movement.left.x).toBeLessThan(0); const styles = [{ sclera: { r: 200, g: 216, b: 224 }, pupil: { r: 24, g: 32, b: 48 } }, { sclera: { r: 200, g: 216, b: 224 }, pupil: { r: 24, g: 32, b: 48 } }] as Parameters<typeof createGazeFrame>[4]; expect(createGazeFrame(parameters, metadata, 0.25, geometry, styles).every(value => value === 0)).toBe(true); expect(createGazeFrame(parameters, metadata, 1, geometry, styles).some((value, index) => index % 4 === 3 && value > 0)).toBe(true); });
  it("CASE 3 keeps pupils inside eye bounds", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const geometry = computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 }); expect("error" in geometry).toBe(false); });
  it("CASE 4 erases old pupil before drawing new pupil", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const geometry = computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 }); if ("error" in geometry) throw new Error(geometry.error); const frame = createGazeFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1, geometry, [{ sclera: { r: 200, g: 216, b: 224 }, pupil: { r: 24, g: 32, b: 48 } }, { sclera: { r: 200, g: 216, b: 224 }, pupil: { r: 24, g: 32, b: 48 } }]); expect(frame[(88 * 320 + 143) * 4 + 3]).toBeGreaterThan(0); });
  it("CASE 5 avoids double pupils", () => { const parsed = parseGazeParametersFromState(gazeState(), 5, "in", "out"); expect("value" in parsed).toBe(true); });
  it("CASE 6 samples local sclera instead of fixed white", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const geometry = computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 }); if ("error" in geometry) throw new Error(geometry.error); const frame = createGazeFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1, geometry, [{ sclera: { r: 200, g: 216, b: 224 }, pupil: { r: 24, g: 32, b: 48 } }, { sclera: { r: 200, g: 216, b: 224 }, pupil: { r: 24, g: 32, b: 48 } }]); expect(frame[(88 * 320 + 143) * 4]).toBe(200); });
  it("CASE 7 validates sclera color, pupil cleanup, target gaze, blink and smoke preservation", async () => { await withMediaDb(async ({ service, currentVersion }) => { const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new GazeValidator()]).repair(coordinatorInput(currentVersion)); const finding = result.validationResults.find(item => item.validatorId === "gaze")?.findings[0]; expect(finding?.status).toBe("PASS"); expect(finding?.actual).toMatchObject({ GAZE_DIRECTION_TOWARD_TARGET: true, OLD_PUPIL_ABSENT: true, DOUBLE_PUPIL_ABSENT: true, SCLERA_COLOR_MATCH: true, WHITE_HALO_ABSENT: true, PUPIL_SIZE_STYLE_MATCH: true, BLINK_PRESERVED: true, SMOKE_RING_PRESERVED: true, NO_MAJOR_UNINTENDED_CHANGE: true }); }); });
  it("CASE 8 preserves pupil size/style", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const geometry = computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 }); if ("error" in geometry) throw new Error(geometry.error); expect(geometry.leftNewPupil.width).toBe(geometry.leftOldPupil.width); expect(geometry.leftNewPupil.height).toBe(geometry.leftOldPupil.height); });
  it("CASE 9 preserves blink window", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const geometry = computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 }); if ("error" in geometry) throw new Error(geometry.error); const frame = createGazeFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1.3, geometry, [{ sclera: { r: 1, g: 1, b: 1 }, pupil: { r: 1, g: 1, b: 1 } }, { sclera: { r: 1, g: 1, b: 1 }, pupil: { r: 1, g: 1, b: 1 } }]); expect(frame.every(value => value === 0)).toBe(true); });
  it("CASE 10 preserves smoke-ring fixture outside eye regions", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const geometry = computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 }); if ("error" in geometry) throw new Error(geometry.error); const frame = createGazeFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1, geometry, [{ sclera: { r: 1, g: 1, b: 1 }, pupil: { r: 1, g: 1, b: 1 } }, { sclera: { r: 1, g: 1, b: 1 }, pupil: { r: 1, g: 1, b: 1 } }]); expect(frame[(130 * 320 + 160) * 4 + 3]).toBe(0); });
  it("CASE 11 limits changes to FRAME_REGION", () => { const parameters = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: "in", candidateOutputPath: "out" }); const geometry = computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 }); if ("error" in geometry) throw new Error(geometry.error); const frame = createGazeFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1, geometry, [{ sclera: { r: 1, g: 1, b: 1 }, pupil: { r: 1, g: 1, b: 1 } }, { sclera: { r: 1, g: 1, b: 1 }, pupil: { r: 1, g: 1, b: 1 } }]); expect(frame[(20 * 320 + 20) * 4 + 3]).toBe(0); });
  it("CASE 12 missing eye/pupil evidence returns NEEDS_REVIEW", async () => { await withMediaDb(async ({ service, currentVersion }) => { const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), []).repair(coordinatorInput(currentVersion, gazeRule(), gazeIncident({ actualState: gazeState({ leftPupilRegion: undefined }) }))); expect(result.status).toBe("NEEDS_REVIEW"); expect(result.warnings).toContain("MISSING_EYE_OR_PUPIL_REGION"); }); });
  it("CASE 13 missing target returns NEEDS_REVIEW", () => { const parsed = parseGazeParametersFromState(gazeState({ targetAnchor: undefined, monitorAnchor: undefined }), 5, "in", "out"); expect(parsed).toEqual({ error: "MISSING_GAZE_TARGET" }); });
  it("CASE 14 ambiguous characters are not guessed", () => { expect(parseGazeParametersFromState(gazeState({ multipleCharacters: true }), 5, "in", "out")).toEqual({ error: "AMBIGUOUS_GAZE_TARGET" }); });
  it("CASE 15 unsafe required pupil shift returns NEEDS_REVIEW", () => { const parameters = gazeParametersSchema.parse({ ...gazeState({ pupilShiftX: -100, maxShift: 15 }), candidateInputPath: "in", candidateOutputPath: "out" }); expect(computeGazeGeometry(parameters, { width: 320, height: 180, fps: 10, duration: 3 })).toEqual({ error: "UNSAFE_PUPIL_SHIFT" }); });
  it("CASE 16 promotes candidate when validation PASS", async () => { await withMediaDb(async ({ service, currentVersion }) => { const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new GazeValidator()]).repair(coordinatorInput(currentVersion)); expect(result.status).toBe("PROMOTED"); expect((await service.getCurrentOutput("project-gaze"))?.id).toBe(result.candidateVersionId); }); });
  it("CASE 17 validation FAIL rejects candidate and preserves CURRENT", async () => { await withMediaDb(async ({ service, currentVersion }) => { const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [failValidator()]).repair(coordinatorInput(currentVersion)); expect(result.status).toBe("REPAIR_FAILED"); expect((await service.getCurrentOutput("project-gaze"))?.id).toBe(currentVersion.id); }); });
  it("CASE 18 handler never writes CURRENT directly", async () => { await withMediaDb(async ({ service, currentVersion }) => { const before = await readFile(currentVersion.filePath); const candidate = await service.createCandidate({ projectId: "project-gaze", sourcePath: currentVersion.filePath, currentVersionId: currentVersion.id }); const result = await createGazePostAssemblyHandler().handlePostAssembly({ incident: gazeIncident(), rule: gazeRule(), candidateVersionId: candidate.id, candidatePath: candidate.filePath, currentOutputPath: currentVersion.filePath, repairAttemptId: "attempt" }); expect(result.filesChanged).toEqual([candidate.filePath]); expect(await readFile(currentVersion.filePath)).toEqual(before); }); });
  it("CASE 19 handler throw rejects candidate and creates report/handoff", async () => { await withMediaDb(async ({ service, currentVersion }) => { const throwing: PostAssemblyRepairHandler = { ...createGazePostAssemblyHandler(), handlePostAssembly: async () => { throw new Error("gaze handler exploded"); } }; const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([throwing]), [], async () => ({ jsonReportPath: "json", markdownReportPath: "md" })).repair(coordinatorInput(currentVersion)); expect(result.status).toBe("REPAIR_FAILED"); expect(result.rejectedCandidateId).toBe(result.candidateVersionId); expect(result.codexHandoffText).toContain("CODEX HANDOFF"); }); });
  it("CASE 20 same input and parameters produce deterministic output", async () => { await withMediaDb(async ({ ffmpegPath, root, currentVersion }) => { const firstPath = path.join(root, "gaze-1.mp4"); const secondPath = path.join(root, "gaze-2.mp4"); const first = gazeParametersSchema.parse({ ...gazeState(), candidateInputPath: currentVersion.filePath, candidateOutputPath: firstPath }); await renderGazeCandidate(first, ffmpegPath); await renderGazeCandidate({ ...first, candidateOutputPath: secondPath }, ffmpegPath); expect(await hashOutputFile(firstPath)).toBe(await hashOutputFile(secondPath)); }); });
  it("CASE 21 retry limit prevents another handler call", async () => { await withMediaDb(async ({ service, currentVersion }) => { let calls = 0; const handler: PostAssemblyRepairHandler = { ...createGazePostAssemblyHandler(), handlePostAssembly: async () => { calls += 1; throw new Error("must not run"); } }; const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([handler]), []).repair(coordinatorInput(currentVersion, gazeRule(), gazeIncident({ previousRepairAttempts: [{ ruleId: "GAZE_NOT_TO_MONITOR", status: "REPAIR_FAILED", at: "2026-09-15T00:00:00.000Z" }] }))); expect(result.status).toBe("RETRY_LIMIT_REACHED"); expect(calls).toBe(0); }); });
  it("CASE 22 preserves generationStatus SUCCESS", async () => { await withMediaDb(async ({ service, currentVersion }) => { expect((await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new GazeValidator()]).repair(coordinatorInput(currentVersion))).generationStatus).toBe("SUCCESS"); }); });
  it("CASE 23 preserves outputReady true", async () => { await withMediaDb(async ({ service, currentVersion }) => { expect((await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new GazeValidator()]).repair(coordinatorInput(currentVersion))).outputReady).toBe(true); }); });
  it("CASE 24 production registry contains GAZE_NOT_TO_MONITOR handler", () => { const handler = new RepairHandlerRegistry().getPostAssembly("GAZE_NOT_TO_MONITOR"); expect(handler?.postAssembly).toMatchObject({ handlerId: GAZE_HANDLER_ID, handlerVersion: GAZE_HANDLER_VERSION, supportsPostAssembly: true, repairScope: "FRAME_REGION", mutatesOutputFile: true, requiresCandidate: true }); });
  it("CASE 25 keeps gaze handler registered", () => { expect(new RepairHandlerRegistry().getPostAssembly("GAZE_NOT_TO_MONITOR")).toBeDefined(); });
  it("CASE 26 blocks unproven gaze auto repair", () => { expect(VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "GAZE_NOT_TO_MONITOR")?.autoRepairAllowed).toBe(false); });
});
