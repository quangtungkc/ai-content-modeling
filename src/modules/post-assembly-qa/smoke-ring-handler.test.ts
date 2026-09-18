import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { matchIncidentToKnowledgeBase } from "@/modules/troubleshooting/matcher";
import { RepairHandlerRegistry, type PostAssemblyRepairHandler } from "@/modules/troubleshooting/handlers";
import { incidentSchema } from "@/modules/troubleshooting/incident-schema";
import { exportQaIncidentReport } from "@/modules/troubleshooting/incident-report-service";
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
import { createSmokeRingFrame, createSmokeRingPostAssemblyHandler, findSmokeRingFfmpegPath, parseSmokeRingParameters, probeSmokeRingVideo, renderSmokeRingCandidate, smokeRingParametersSchema, SMOKE_RING_HANDLER_VERSION } from "./smoke-ring-handler";
import { SmokeRingValidator } from "./smoke-ring-validator";
import type { QaContext, QaFinding, QaValidator } from "./types";

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
  await execFileAsync(ffmpegPath, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=c=0x31405f:s=320x180:r=10:d=3", "-an", "-c:v", "h264_mf", "-b:v", "1M", filePath], { windowsHide: true, maxBuffer: 2_000_000 });
}

async function withMediaDb<T>(callback: (input: { client: PrismaClient; service: OutputVersionService; root: string; ffmpegPath: string; currentPath: string; currentVersion: Awaited<ReturnType<OutputVersionService["registerOriginalOutput"]>> }) => Promise<T>) {
  const ffmpegPath = await findSmokeRingFfmpegPath();
  if (!ffmpegPath) throw new Error("TEST_FFMPEG_NOT_FOUND");
  const root = await mkdtemp(path.join(os.tmpdir(), "smoke-ring-handler-"));
  const database = path.join(root, "outputs.db").replace(/\\/g, "/");
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  const service = new OutputVersionService(client, async () => undefined);
  const currentPath = path.join(root, "final.mp4");
  try {
    await createSchema(client);
    await createVideo(ffmpegPath, currentPath);
    const currentVersion = await service.registerOriginalOutput({ projectId: "project-smoke", filePath: currentPath, validationStatus: "PASS" });
    return await callback({ client, service, root, ffmpegPath, currentPath, currentVersion });
  } finally {
    await client.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

function smokeState(overrides: Record<string, unknown> = {}) {
  return { sceneNumber: 5, sceneStart: 0, sceneEnd: 3, effectStartLocalTime: 1.1, effectEndLocalTime: 2, mouthAnchor: { x: 160, y: 90, space: "PIXELS" }, ringSizeUnit: "PIXELS", ringInitialSize: 10, ringFinalSize: 24, opacity: 0.65, thickness: 5, fadeIn: 0.1, fadeOut: 0.2, ...overrides };
}

function smokeRule(overrides: Partial<TroubleshootingRule> = {}): TroubleshootingRule {
  const source = VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "FLOW_SMOKE_RING_OMITTED")!;
  return { ...source, autoRepairAllowed: true, verificationStatus: "VERIFIED", ...overrides };
}

function smokeIncident(overrides: Record<string, unknown> = {}) {
  return incidentSchema.parse({ incidentId: "33333333-3333-4333-8333-333333333333", timestamp: "2026-09-14T00:00:00.000Z", projectId: "project-smoke", sceneNumber: 5, stage: "SCENES", component: "smoke-ring-validator", symptoms: ["Smoke ring omitted"], errorMessages: ["SMOKE_RING_ACTION_FAIL"], errorCodes: ["SMOKE_RING_ACTION_FAIL"], firstDivergence: "FLOW_VIDEO_OUTPUT", expectedState: { smokeRing: true }, actualState: smokeState(), evidence: [{ kind: "mouth-anchor", source: "fixture", value: { x: 160, y: 90, space: "PIXELS" } }], runtimeState: { generationStatus: "SUCCESS", outputReady: true }, checkpoint: { generationStatus: "SUCCESS", outputReady: true }, attemptCount: 0, previousRepairAttempts: [], affectedFiles: ["final.mp4"], preserveRequirements: ["Preserve approved scenes 1–4."], ...overrides });
}

function smokeFinding(overrides: Partial<QaFinding> = {}): QaFinding {
  return { validatorId: "smoke-ring", status: "FAIL", sceneNumber: 5, globalTimestamp: 1.1, sceneLocalTimestamp: 1.1, expected: { smokeRing: true }, actual: { smokeRing: false }, evidence: ["fixture"], confidence: 1, severity: "HIGH", suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT", affectedRegion: "mouth", affectedFile: "final.mp4", symptom: "Smoke ring omitted", ...overrides };
}

function coordinatorInput(currentVersion: Awaited<ReturnType<OutputVersionService["registerOriginalOutput"]>>, rule: TroubleshootingRule, incident = smokeIncident(), finding = smokeFinding()): PostAssemblyRepairInput {
  const match = matchIncidentToKnowledgeBase(incident, [rule]);
  return { projectId: "project-smoke", qaRunId: "qa-smoke-1", finding, incident, match, matchedRule: rule, currentOutputVersion: currentVersion, approvedManifest: { scenes: [1, 2, 3, 4, 5].map(sceneNumber => ({ sceneNumber, source: `scene-${sceneNumber}.mp4`, durationSec: 3 })) }, approvedSources: ["scene-1.mp4", "scene-2.mp4", "scene-3.mp4", "scene-4.mp4", "scene-5.mp4"], expectedSceneStates: {}, sceneMetadata: { sceneNumbers: [1, 2, 3, 4, 5] }, checkpoint: { ...smokeState(), generationStatus: "SUCCESS", outputReady: true }, preserveRequirements: ["Preserve approved scenes 1–4."], generationStatus: "SUCCESS", outputReady: true };
}

describe("Reusable deterministic smoke-ring handler", () => {
  it("CASE 1 creates a candidate and runs from a valid parameterized incident", async () => {
    await withMediaDb(async ({ service, root, ffmpegPath, currentVersion }) => {
      const source = path.join(root, "candidate-input.mp4");
      const output = path.join(root, "candidate-output.mp4");
      await writeFile(source, await readFile(currentVersion.filePath));
      const parsed = parseSmokeRingParameters(smokeIncident(), source, output);
      expect("value" in parsed).toBe(true);
      await renderSmokeRingCandidate((parsed as { value: typeof smokeRingParametersSchema._output }).value, ffmpegPath);
      expect(await readFile(output)).not.toEqual(await readFile(currentVersion.filePath));
      expect((await service.getCurrentOutput("project-smoke"))?.id).toBe(currentVersion.id);
    });
  });

  it("CASE 2 limits effect to the supplied local/global time window", () => {
    const parameters = smokeRingParametersSchema.parse({ ...smokeState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const metadata = { width: 320, height: 180, fps: 10, duration: 3 };
    expect(createSmokeRingFrame(parameters, metadata, 0.5).every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
    expect(createSmokeRingFrame(parameters, metadata, 1.5).some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
    expect(createSmokeRingFrame(parameters, metadata, 2.5).every((value, index) => index % 4 !== 3 || value === 0)).toBe(true);
  });

  it("CASE 3 places the ring around the supplied mouth anchor", () => {
    const parameters = smokeRingParametersSchema.parse({ ...smokeState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const metadata = { width: 320, height: 180, fps: 10, duration: 3 };
    const frame = createSmokeRingFrame(parameters, metadata, 1.5);
    const points: Array<{ x: number; y: number }> = [];
    for (let index = 0; index < frame.length; index += 4) if (frame[index + 3] > 0) points.push({ x: (index / 4) % metadata.width, y: Math.floor(index / 4 / metadata.width) });
    const center = { x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length };
    expect(Math.hypot(center.x - 160, center.y - 90)).toBeLessThan(3);
  });

  it("CASE 4 promotes after smoke-ring validation PASS", async () => {
    await withMediaDb(async ({ service, root, currentVersion }) => {
      const candidateSource = path.join(root, "repair.mp4");
      await writeFile(candidateSource, "repair-source");
      const candidate = await service.createCandidate({ projectId: "project-smoke", sourcePath: candidateSource, currentVersionId: currentVersion.id });
      await writeFile(candidate.filePath, "smoke-repaired");
      await service.markCandidateValidated(candidate.id, { status: "PASS" });
      const promoted = await service.promoteCandidate(candidate.id);
      expect(promoted.status).toBe("CURRENT");
    });
  });

  it("CASE 5 rejects validation FAIL and keeps old CURRENT", async () => {
    await withMediaDb(async ({ service, root, currentVersion }) => {
      const candidate = await service.createCandidate({ projectId: "project-smoke", sourcePath: path.join(root, "repair.mp4"), currentVersionId: currentVersion.id }).catch(async () => { const source = path.join(root, "repair.mp4"); await writeFile(source, "repair-source"); return service.createCandidate({ projectId: "project-smoke", sourcePath: source, currentVersionId: currentVersion.id }); });
      await service.markCandidateValidated(candidate.id, { status: "FAIL", reason: "Smoke validation failed." });
      expect((await service.getCurrentOutput("project-smoke"))?.id).toBe(currentVersion.id);
    });
  });

  it("CASE 6 missing anchor returns NEEDS_REVIEW without modifying video", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const rule = smokeRule();
      const incident = smokeIncident({ actualState: smokeState({ mouthAnchor: undefined }) });
      const reports: unknown[] = [];
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [], async report => { reports.push(report); return { jsonReportPath: "json", markdownReportPath: "md" }; }).repair(coordinatorInput(currentVersion, rule, incident));
      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.warnings).toContain("MISSING_SMOKE_RING_ORIGIN");
      expect(reports).toHaveLength(1);
    });
  });

  it("CASE 7 ambiguous multiple-character origin returns NEEDS_REVIEW", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const rule = smokeRule();
      const incident = smokeIncident({ actualState: smokeState({ originCandidates: [{ x: 10 }, { x: 20 }] }) });
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), []).repair(coordinatorInput(currentVersion, rule, incident));
      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.warnings).toContain("AMBIGUOUS_SMOKE_RING_ORIGIN");
    });
  });

  it("CASE 8 FRAME_REGION keeps pixels outside the ring region untouched", () => {
    const parameters = smokeRingParametersSchema.parse({ ...smokeState(), candidateInputPath: "input", candidateOutputPath: "output" });
    const metadata = { width: 320, height: 180, fps: 10, duration: 3 };
    const frame = createSmokeRingFrame(parameters, metadata, 1.5);
    for (let y = 0; y < metadata.height; y += 1) for (let x = 0; x < metadata.width; x += 1) if (Math.hypot(x - 160, y - 90) > 40) expect(frame[(y * metadata.width + x) * 4 + 3]).toBe(0);
  });

  it("CASE 9 Scene 5 fixture preserves Scene 1–4 approved state", async () => {
    await withMediaDb(async ({ service, root, currentVersion }) => {
      const before = await readFile(currentVersion.filePath);
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([createSmokeRingPostAssemblyHandler()]), [new SmokeRingValidator()]).repair(coordinatorInput(currentVersion, smokeRule()));
      expect(result.affectedScene).toBe(5);
      expect(await readFile(currentVersion.filePath)).toEqual(before);
    });
  });

  it("CASE 10 handler writes candidate path, never CURRENT path", async () => {
    await withMediaDb(async ({ service, root, currentVersion }) => {
      const before = await readFile(currentVersion.filePath);
      const candidate = await service.createCandidate({ projectId: "project-smoke", sourcePath: currentVersion.filePath, currentVersionId: currentVersion.id });
      const handler = createSmokeRingPostAssemblyHandler();
      const result = await handler.handlePostAssembly({ incident: smokeIncident(), rule: smokeRule(), candidateVersionId: candidate.id, candidatePath: candidate.filePath, currentOutputPath: currentVersion.filePath, repairAttemptId: "attempt" });
      expect(result.filesChanged).toEqual([candidate.filePath]);
      expect(await readFile(currentVersion.filePath)).toEqual(before);
      expect(candidate.filePath).not.toBe(currentVersion.filePath);
    });
  });

  it("CASE 11 handler throw rejects candidate and creates report/handoff", async () => {
    await withMediaDb(async ({ service, currentVersion, root }) => {
      const reports: unknown[] = [];
      const throwing: PostAssemblyRepairHandler = { ...createSmokeRingPostAssemblyHandler(), handlePostAssembly: async () => { throw new Error("smoke handler exploded"); } };
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([throwing]), [], async report => { reports.push(report); return exportQaIncidentReport(report, { root: path.join(root, "reports") }); }).repair(coordinatorInput(currentVersion, smokeRule()));
      expect(result.status).toBe("REPAIR_FAILED");
      expect(result.report?.disposition).toBe("REPAIR_FAILED");
      expect(result.codexHandoffText).toContain("CODEX HANDOFF");
      expect(reports).toHaveLength(1);
    });
  });

  it("CASE 12 same input and parameters produce the same deterministic overlay hash", async () => {
    await withMediaDb(async ({ ffmpegPath, root, currentPath }) => {
      const firstPath = path.join(root, "deterministic-1.mp4");
      const secondPath = path.join(root, "deterministic-2.mp4");
      const first = smokeRingParametersSchema.parse({ ...smokeState(), candidateInputPath: currentPath, candidateOutputPath: firstPath });
      const second = { ...first, candidateOutputPath: secondPath };
      await renderSmokeRingCandidate(first, ffmpegPath);
      await renderSmokeRingCandidate(second, ffmpegPath);
      expect(await hashOutputFile(firstPath)).toBe(await hashOutputFile(secondPath));
    });
  });

  it("CASE 13 retry limit prevents another handler call", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const calls = { count: 0, currentBefore: [] as string[] };
      const rule = smokeRule();
      const incident = smokeIncident({ previousRepairAttempts: [{ ruleId: rule.issueId, status: "REPAIR_FAILED", at: "2026-09-14T00:00:00.000Z" }] });
      const handler = { ...createSmokeRingPostAssemblyHandler(), handlePostAssembly: async () => { calls.count += 1; throw new Error("must not run"); } };
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([handler]), []).repair(coordinatorInput(currentVersion, rule, incident));
      expect(result.status).toBe("RETRY_LIMIT_REACHED");
      expect(calls.count).toBe(0);
    });
  });

  it("CASE 14 repair success preserves generationStatus SUCCESS", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([createSmokeRingPostAssemblyHandler()]), [new SmokeRingValidator()]).repair(coordinatorInput(currentVersion, smokeRule()));
      expect(result.generationStatus).toBe("SUCCESS");
    });
  });

  it("CASE 15 repair failure preserves outputReady true", async () => {
    await withMediaDb(async ({ service, currentVersion }) => {
      const handler = { ...createSmokeRingPostAssemblyHandler(), handlePostAssembly: async () => ({ status: "REPAIR_FAILED" as const, actionsTaken: [], filesChanged: [], affectedScene: 5, affectedRegion: "mouth", warnings: ["failed"], validatorsToRecheck: ["smoke-ring"] }) };
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry([handler]), []).repair(coordinatorInput(currentVersion, smokeRule()));
      expect(result.outputReady).toBe(true);
    });
  });

  it("CASE 16 production registry exposes FLOW_SMOKE_RING_OMITTED handler", () => {
    const handler = new RepairHandlerRegistry().getPostAssembly("FLOW_SMOKE_RING_OMITTED");
    expect(handler).toBeDefined();
    expect(handler?.postAssembly).toMatchObject({ supportsPostAssembly: true, repairScope: "FRAME_REGION", mutatesOutputFile: true, requiresCandidate: true });
    expect(SMOKE_RING_HANDLER_VERSION).toBe("1.0.0");
  });

  it("CASE 17 production registry keeps smoke handler only for this rule", () => {
    const registry = new RepairHandlerRegistry();
    expect(registry.getPostAssembly("FLOW_SMOKE_RING_OMITTED")).toBeDefined();
  });

  it("CASE 18 test/handler proof alone never authorizes production smoke repair", async () => {
    expect(VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "FLOW_SMOKE_RING_OMITTED")?.autoRepairAllowed).toBe(false);
    await withMediaDb(async ({ service, currentVersion }) => {
      const rule = VERIFIED_TROUBLESHOOTING_RULES.find(item => item.issueId === "FLOW_SMOKE_RING_OMITTED")!;
      const result = await new PostAssemblyRepairCoordinator(service, new RepairHandlerRegistry(), [new SmokeRingValidator()]).repair(coordinatorInput(currentVersion, rule));
      expect(result.status).toBe("UNKNOWN_INCIDENT");
      expect(result.candidateVersionId).toBeNull();
      expect(result.outputReady).toBe(true);
    });
  });
});
