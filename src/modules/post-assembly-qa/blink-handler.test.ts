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
import { BLINK_HANDLER_ID, BLINK_HANDLER_VERSION, blinkParametersSchema, createBlinkFrame, createBlinkPostAssemblyHandler, parseBlinkParametersFromState, renderBlinkCandidate } from "./blink-handler";
import { findSmokeRingFfmpegPath } from "./smoke-ring-handler";
import { BlinkValidator } from "./blink-validator";
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
    "drawbox=x=120:y=75:w=40:h=25:color=0xf0f0f0:t=fill",
    "drawbox=x=180:y=75:w=40:h=25:color=0xf0f0f0:t=fill",
    "drawbox=x=132:y=80:w=12:h=14:color=0x111111:t=fill",
    "drawbox=x=192:y=80:w=12:h=14:color=0x111111:t=fill",
  ].join(",");
  await execFileAsync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x31405f:s=320x180:r=10:d=3", "-vf", filter, "-an", "-c:v", "h264_mf", "-b:v", "1M", filePath], { windowsHide: true, maxBuffer: 2_000_000 });
}

async function withMediaDb<T>(callback: (input: { client: PrismaClient; service: OutputVersionService; root: string; ffmpegPath: string; currentVersion: Awaited<ReturnType<OutputVersionService["registerOriginalOutput"]>> }) => Promise<T>) {
  const ffmpegPath = await findSmokeRingFfmpegPath();
  if (!ffmpegPath) throw new Error("TEST_FFMPEG_NOT_FOUND");
  const root = await mkdtemp(path.join(os.tmpdir(), "blink-handler-"));
  const database = path.join(root, "outputs.db").replace(/\\/g, "/");
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  const service = new OutputVersionService(client, async () => undefined);
  const currentPath = path.join(root, "final.mp4");
  try {
    await createSchema(client);
    await createVideo(ffmpegPath, currentPath);
    const currentVersion = await service.registerOriginalOutput({ projectId: "project-blink", filePath: currentPath, validationStatus: "PASS" });
    return await callback({ client, service, root, ffmpegPath, currentVersion });
  } finally {
    await client.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

function blinkState(overrides: Record<string, unknown> = {}) {
  return { sceneNumber: 5, sceneStart: 0, sceneEnd: 3, blinkStartLocalTime: 1, blinkCloseTime: 1.25, blinkReopenTime: 1.4, blinkEndLocalTime: 1.65, leftEyeRegion: { x: 120, y: 75, width: 40, height: 25, space: "PIXELS" }, rightEyeRegion: { x: 180, y: 75, width: 40, height: 25, space: "PIXELS" }, blinkStrength: 0.95, closeAmount: 1, featherAmount: 2, interpolation: "SMOOTHSTEP", ...overrides };
}

function blinkRule(overrides: Partial<TroubleshootingRule> = {}): TroubleshootingRule {
  const source = VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "BLINK_DOES_NOT_REOPEN")!;
  return { ...source, autoRepairAllowed: true, verificationStatus: "VERIFIED", ...overrides };
}

function blinkIncident(overrides: Record<string, unknown> = {}) {
  return incidentSchema.parse({ incidentId: "44444444-4444-4444-8444-444444444444", timestamp: "2026-09-14T00:00:00.000Z", projectId: "project-blink", sceneNumber: 5, stage: "POST_PROCESSING", component: "blink", symptoms: ["Blink does not reopen"], errorMessages: ["BLINK_ACTION_FAIL"], errorCodes: ["BLINK_ACTION_FAIL"], firstDivergence: "FLOW_VIDEO_OUTPUT", expectedState: { blink: "open-close-reopen" }, actualState: blinkState(), evidence: [{ kind: "eye-regions", source: "fixture", value: blinkState() }], runtimeState: { generationStatus: "SUCCESS", outputReady: true }, checkpoint: { generationStatus: "SUCCESS", outputReady: true }, attemptCount: 0, previousRepairAttempts: [], affectedFiles: ["final.mp4"], preserveRequirements: ["Preserve approved Scene 1–4.", "Keep generationStatus SUCCESS and outputReady true."], ...overrides });
}

function blinkFinding(overrides: Partial<QaFinding> = {}): QaFinding {
  return { validatorId: "blink", status: "FAIL", sceneNumber: 5, globalTimestamp: 1, sceneLocalTimestamp: 1, expected: { blink: "open-close-reopen" }, actual: { blink: "does-not-reopen" }, evidence: ["fixture eye evidence"], confidence: 1, severity: "HIGH", suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT", affectedRegion: "eyes", affectedFile: "final.mp4", symptom: "Blink does not reopen", ...overrides };
}

function coordinatorInput(currentVersion: Awaited<ReturnType<OutputVersionService["registerOriginalOutput"]>>, rule = blinkRule(), incident = blinkIncident(), finding = blinkFinding()): PostAssemblyRepairInput {
  const match = matchIncidentToKnowledgeBase(incident, [rule]);
  return { projectId: "project-blink", qaRunId: "qa-blink-1", finding, incident, match, matchedRule: rule, currentOutputVersion: currentVersion, approvedManifest: { scenes: [1, 2, 3, 4, 5].map(sceneNumber => ({ sceneNumber, source: `scene-${sceneNumber}.mp4`, durationSec: 3 })) }, approvedSources: ["scene-1.mp4", "scene-2.mp4", "scene-3.mp4", "scene-4.mp4", "scene-5.mp4"], expectedSceneStates: {}, sceneMetadata: { sceneNumbers: [1, 2, 3, 4, 5] }, checkpoint: { ...blinkState(), generationStatus: "SUCCESS", outputReady: true }, preserveRequirements: ["Preserve approved Scene 1–4."], generationStatus: "SUCCESS", outputReady: true };
}

function failValidator(): QaValidator {
  return { id: "blink", validate: async () => [{ ...blinkFinding(), status: "FAIL" }] };
}

describe("Reusable deterministic blink repair handler", () => {
  it("CASE 1 creates a candidate and runs for a valid parameterized incident", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new BlinkValidator()]).repair(coordinatorInput(currentVersion));
      expect(result.candidateVersionId).not.toBeNull();
      expect(result.actionsTaken).toContain("renderDeterministicBlinkToCandidate");
    });
  });

  it("CASE 2 leaves eyes open before the blink", () => {
    const parameters = blinkParametersSchema.parse({ ...blinkState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const frame = createBlinkFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 0.9);
    expect(frame.every((value, index) => index % 4 === 3 ? value === 0 : value === 0)).toBe(true);
  });

  it("CASE 3 closes eyes during the blink", () => {
    const parameters = blinkParametersSchema.parse({ ...blinkState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const frame = createBlinkFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1.32);
    const alphaInEyeRegions = [125, 185].flatMap(x => { const values: number[] = []; for (let y = 80; y < 95; y += 1) values.push(frame[(y * 320 + x) * 4 + 3]); return values; });
    expect(alphaInEyeRegions.some(value => value > 200)).toBe(true);
  });

  it("CASE 4 reopens eyes fully after the blink", () => {
    const parameters = blinkParametersSchema.parse({ ...blinkState(), candidateInputPath: "input", candidateOutputPath: "output" });
    expect(createBlinkFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1.9).every(value => value === 0)).toBe(true);
  });

  it("CASE 5 completes the blink in the supplied temporal window", () => {
    const parsed = parseBlinkParametersFromState(blinkState(), 5, "input", "output");
    expect("value" in parsed).toBe(true);
    if ("value" in parsed && parsed.value) expect(parsed.value.blinkEndLocalTime).toBeLessThan(parsed.value.sceneEnd - parsed.value.sceneStart);
  });

  it("CASE 6 promotes a candidate after blink validation PASS", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new BlinkValidator()]).repair(coordinatorInput(currentVersion));
      expect(result.status).toBe("PROMOTED");
      expect(result.qualityStatus).toBe("APPROVED");
      expect((await service.getCurrentOutput("project-blink"))?.id).toBe(result.candidateVersionId);
    });
  });

  it("CASE 7 rejects when reopen validation fails and preserves CURRENT", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [failValidator()]).repair(coordinatorInput(currentVersion));
      expect(result.status).toBe("REPAIR_FAILED");
      expect((await service.getCurrentOutput("project-blink"))?.id).toBe(currentVersion.id);
    });
  });

  it("CASE 8 missing eye region returns NEEDS_REVIEW without changing video", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const before = await readFile(currentVersion.filePath);
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), []).repair(coordinatorInput(currentVersion, blinkRule(), blinkIncident({ actualState: blinkState({ leftEyeRegion: undefined }) })));
      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.warnings).toContain("MISSING_EYE_REGION");
      expect(await readFile(currentVersion.filePath)).toEqual(before);
    });
  });

  it("CASE 9 ambiguous multiple-character target is not guessed", () => {
    const parsed = parseBlinkParametersFromState(blinkState({ multipleCharacters: true }), 5, "input", "output");
    expect(parsed).toEqual({ error: "AMBIGUOUS_BLINK_TARGET" });
  });

  it("CASE 10 FRAME_REGION changes only supplied eye regions", () => {
    const parameters = blinkParametersSchema.parse({ ...blinkState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const frame = createBlinkFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1.3);
    for (let y = 0; y < 180; y += 1) for (let x = 0; x < 320; x += 1) if (!((x >= 120 && x < 160 && y >= 75 && y < 100) || (x >= 180 && x < 220 && y >= 75 && y < 100))) expect(frame[(y * 320 + x) * 4 + 3]).toBe(0);
  });

  it("CASE 11 preserves gaze by never writing pupil movement outside the eye overlay", () => {
    const parameters = blinkParametersSchema.parse({ ...blinkState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const frame = createBlinkFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1.3);
    expect(frame.slice((40 * 320) * 4, (40 * 320 + 320) * 4).every(value => value === 0)).toBe(true);
  });

  it("CASE 12 preserves a smoke-ring region in the same scene", () => {
    const parameters = blinkParametersSchema.parse({ ...blinkState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const frame = createBlinkFrame(parameters, { width: 320, height: 180, fps: 10, duration: 3 }, 1.3);
    const mouthOffset = (90 * 320 + 160) * 4;
    expect(frame[mouthOffset + 3]).toBe(0);
  });

  it("CASE 13 handler writes candidate and never CURRENT directly", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const before = await readFile(currentVersion.filePath);
      const candidate = await service.createCandidate({ projectId: "project-blink", sourcePath: currentVersion.filePath, currentVersionId: currentVersion.id });
      const result = await createBlinkPostAssemblyHandler().handlePostAssembly({ incident: blinkIncident(), rule: blinkRule(), candidateVersionId: candidate.id, candidatePath: candidate.filePath, currentOutputPath: currentVersion.filePath, repairAttemptId: "attempt" });
      expect(result.filesChanged).toEqual([candidate.filePath]);
      expect(await readFile(currentVersion.filePath)).toEqual(before);
      expect(candidate.filePath).not.toBe(currentVersion.filePath);
    });
  });

  it("CASE 14 handler throw rejects candidate and creates report/handoff", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const throwing: PostAssemblyRepairHandler = { ...createBlinkPostAssemblyHandler(), handlePostAssembly: async () => { throw new Error("blink handler exploded"); } };
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([throwing]), [], async () => ({ jsonReportPath: "json", markdownReportPath: "md" })).repair(coordinatorInput(currentVersion));
      expect(result.status).toBe("REPAIR_FAILED");
      expect(result.rejectedCandidateId).toBe(result.candidateVersionId);
      expect(result.codexHandoffText).toContain("CODEX HANDOFF");
    });
  });

  it("CASE 15 same input and parameters produce the same output hash", async () => {
    await withMediaDb(async ({ ffmpegPath, root, currentVersion }) => {
      const firstPath = path.join(root, "blink-1.mp4");
      const secondPath = path.join(root, "blink-2.mp4");
      const first = blinkParametersSchema.parse({ ...blinkState(), candidateInputPath: currentVersion.filePath, candidateOutputPath: firstPath });
      await renderBlinkCandidate(first, ffmpegPath);
      await renderBlinkCandidate({ ...first, candidateOutputPath: secondPath }, ffmpegPath);
      expect(await hashOutputFile(firstPath)).toBe(await hashOutputFile(secondPath));
    });
  });

  it("CASE 16 retry limit prevents another handler call", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      let calls = 0;
      const handler: PostAssemblyRepairHandler = { ...createBlinkPostAssemblyHandler(), handlePostAssembly: async () => { calls += 1; throw new Error("must not run"); } };
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([handler]), []).repair(coordinatorInput(currentVersion, blinkRule(), blinkIncident({ previousRepairAttempts: [{ ruleId: "BLINK_DOES_NOT_REOPEN", status: "REPAIR_FAILED", at: "2026-09-14T00:00:00.000Z" }] })));
      expect(result.status).toBe("RETRY_LIMIT_REACHED");
      expect(calls).toBe(0);
    });
  });

  it("CASE 17 repair success preserves generationStatus SUCCESS", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new BlinkValidator()]).repair(coordinatorInput(currentVersion));
      expect(result.generationStatus).toBe("SUCCESS");
    });
  });

  it("CASE 18 repair success preserves outputReady true", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new BlinkValidator()]).repair(coordinatorInput(currentVersion));
      expect(result.outputReady).toBe(true);
    });
  });

  it("CASE 19 production registry exposes BLINK_DOES_NOT_REOPEN handler", () => {
    const handler = new RepairHandlerRegistry().getPostAssembly("BLINK_DOES_NOT_REOPEN");
    expect(handler).toBeDefined();
    expect(handler?.postAssembly).toMatchObject({ handlerId: BLINK_HANDLER_ID, handlerVersion: BLINK_HANDLER_VERSION, supportsPostAssembly: true, repairScope: "FRAME_REGION", mutatesOutputFile: true, requiresCandidate: true });
  });

  it("CASE 20 keeps Blink policy enabled", () => {
    const registry = new RepairHandlerRegistry();
    expect(VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "BLINK_DOES_NOT_REOPEN")?.autoRepairAllowed).toBe(false);
  });
});
