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
import { OutputVersionService } from "@/modules/output-versioning/service";
import { PostAssemblyRepairCoordinator as ProductionRepairCoordinator, type PostAssemblyRepairInput } from "./repair-coordinator";

// Synthetic authorization for algorithm/candidate tests, never production provenance.
class PostAssemblyRepairCoordinator extends ProductionRepairCoordinator {
  constructor(...args: ConstructorParameters<typeof ProductionRepairCoordinator>) {
    super(args[0], args[1], args[2], args[3], () => true);
  }
}
import type { QaFinding, QaValidator } from "./types";

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

async function withFixture<T>(callback: (fixture: Awaited<ReturnType<typeof makeFixture>>) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "post-assembly-repair-"));
  const database = path.join(root, "repair.db").replace(/\\/g, "/");
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  try {
    await createSchema(client);
    return await callback(await makeFixture(client, root));
  } finally {
    await client.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

function testRule(overrides: Partial<TroubleshootingRule> = {}): TroubleshootingRule {
  const source = VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "GAZE_NOT_TO_MONITOR")!;
  return { ...source, verificationStatus: "VERIFIED", issueId: "TEST_POST_ASSEMBLY_REPAIR", title: "Test Post-Assembly repair rule", stage: "POST_PROCESSING", symptoms: ["Test gaze artifact"], errorSignatures: ["TEST_POST_ASSEMBLY_ERROR"], firstDivergence: "FLOW_VIDEO_OUTPUT", repairScope: "FRAME_REGION", autoRepairAllowed: true, confidenceThreshold: 0.5, affectedComponents: ["test validator"], ...overrides };
}

function testIncident(overrides: Record<string, unknown> = {}) {
  return incidentSchema.parse({ incidentId: "22222222-2222-4222-8222-222222222222", timestamp: "2026-09-14T00:00:00.000Z", projectId: "project-4a4", sceneNumber: 5, stage: "POST_PROCESSING", component: "test validator", symptoms: ["Test gaze artifact"], errorMessages: ["TEST_POST_ASSEMBLY_ERROR"], errorCodes: ["TEST_POST_ASSEMBLY_ERROR"], firstDivergence: "FLOW_VIDEO_OUTPUT", expectedState: { gaze: "monitor" }, actualState: { gaze: "camera" }, evidence: [{ kind: "frame-review", source: "test", value: { timestamp: 18.42 } }], runtimeState: { generationStatus: "SUCCESS", outputReady: true }, checkpoint: { stage: "FINAL_AUDIT", approvedScenes: [1, 2, 3, 4, 5] }, attemptCount: 0, previousRepairAttempts: [], affectedFiles: ["final.mp4"], preserveRequirements: ["Preserve approved Scene 1–4.", "Do not regenerate the whole pipeline."], ...overrides });
}

function testFinding(validatorId = "failing-validator", status: QaFinding["status"] = "FAIL"): QaFinding {
  return { validatorId, status, sceneNumber: 5, globalTimestamp: 18.42, sceneLocalTimestamp: 2.42, expected: { gaze: "monitor" }, actual: { gaze: "camera" }, evidence: ["frame evidence"], confidence: 1, severity: "HIGH", suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT", affectedRegion: "eyes", affectedFile: "final.mp4", symptom: "Test gaze artifact" };
}

function testValidator(id: string, result: QaFinding, calls: Array<{ id: string; sceneNumbers?: number[] }>): QaValidator {
  return { id, validate: async (_context, scope) => { calls.push({ id, sceneNumbers: scope?.sceneNumbers }); return [{ ...result, validatorId: id }]; } };
}

function testHandler(rule: TroubleshootingRule, calls: { count: number; currentBefore: string[] }, outcome: "REPAIRED" | "THROW" = "REPAIRED", capabilityOverrides: Partial<PostAssemblyRepairHandler["postAssembly"]> = {}): PostAssemblyRepairHandler {
  return {
    issueId: rule.issueId,
    mode: "AUTO",
    handle: async () => { throw new Error("runtime handler must not be used by Post-Assembly coordinator"); },
    postAssembly: { supportsPostAssembly: true, repairScope: rule.repairScope, mutatesOutputFile: true, requiresCandidate: true, supportedValidatorIds: ["failing-validator"], preserveRequirements: ["Preserve approved Scene 1–4."], validationPlan: { validatorIds: ["failing-validator"], requiredValidatorIds: ["failing-validator"], preserveValidatorIds: [] }, ...capabilityOverrides },
    handlePostAssembly: async ({ candidatePath, currentOutputPath }) => {
      calls.count += 1;
      calls.currentBefore.push(await readFile(currentOutputPath, "utf8"));
      if (outcome === "THROW") throw new Error("test handler failed");
      await writeFile(candidatePath!, "repaired-candidate");
      return { status: "REPAIRED", actionsTaken: ["writeCandidate"], filesChanged: [candidatePath!], affectedScene: 5, affectedRegion: "eyes", warnings: [], validatorsToRecheck: ["failing-validator"], preserveRequirements: ["Preserve approved Scene 1–4."] };
    },
  };
}

async function makeFixture(client: PrismaClient, root: string) {
  const currentPath = path.join(root, "final.mp4");
  await writeFile(currentPath, "approved-current");
  const outputVersions = new OutputVersionService(client, async () => undefined);
  const currentOutputVersion = await outputVersions.registerOriginalOutput({ projectId: "project-4a4", filePath: currentPath, validationStatus: "PASS" });
  const rule = testRule();
  const incident = testIncident();
  const match = matchIncidentToKnowledgeBase(incident, [rule]);
  const input: PostAssemblyRepairInput = { projectId: "project-4a4", qaRunId: "qa-run-1", finding: testFinding(), incident, match, matchedRule: rule, currentOutputVersion, approvedManifest: { scenes: [1, 2, 3, 4, 5].map(sceneNumber => ({ sceneNumber, source: `scene-${sceneNumber}.mp4`, durationSec: 4 })) }, approvedSources: ["scene-1.mp4", "scene-2.mp4", "scene-3.mp4", "scene-4.mp4", "scene-5.mp4"], expectedSceneStates: {}, sceneMetadata: { sceneNumbers: [1, 2, 3, 4, 5] }, checkpoint: { generationStatus: "SUCCESS", outputReady: true, approvedScenes: [1, 2, 3, 4, 5] }, preserveRequirements: ["Preserve approved Scene 1–4.", "Do not regenerate the whole pipeline."], generationStatus: "SUCCESS", outputReady: true };
  return { client, root, outputVersions, currentOutputVersion, rule, incident, match, input };
}

describe("PostAssemblyRepairCoordinator", () => {
  it("default production provenance gate blocks stale VERIFIED rules and preserves prior output", async () => {
    await withFixture(async fixture => {
      const calls = { count: 0, currentBefore: [] as string[] };
      const coordinator = new ProductionRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, calls)]), []);
      const result = await coordinator.repair(fixture.input);
      expect(result.status).toBe("NEEDS_REVIEW");
      expect(result.generationStatus).toBe("SUCCESS");
      expect(result.outputReady).toBe(true);
      expect(result.candidateVersionId).toBeNull();
      expect(calls.count).toBe(0);
      expect(await readFile(fixture.currentOutputVersion.filePath, "utf8")).toBe("approved-current");
    });
  });
  it("CASE 1 routes an eligible verified finding to REPAIRING, candidate and handler", async () => {
    await withFixture(async fixture => {
      const calls = { count: 0, currentBefore: [] as string[] };
      const validators = [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, [])];
      const coordinator = new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, calls)]), validators);
      const result = await coordinator.repair(fixture.input);
      expect(result.status).toBe("PROMOTED");
      expect(result.qualityStatus).toBe("APPROVED");
      expect(result.candidateVersionId).not.toBeNull();
      expect(calls.count).toBe(1);
    });
  });

  it("CASE 2 blocks a handler that does not support Post-Assembly", async () => {
    await withFixture(async fixture => {
      const calls = { count: 0, currentBefore: [] as string[] };
      const handler = testHandler(fixture.rule, calls, "REPAIRED", { supportsPostAssembly: false });
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([handler]), []).repair(fixture.input);
      expect(result.status).toBe("NEEDS_REVIEW");
      expect(calls.count).toBe(0);
    });
  });

  it("CASE 3 blocks a rule with autoRepairAllowed false", async () => {
    await withFixture(async fixture => {
      const calls = { count: 0, currentBefore: [] as string[] };
      const rule = { ...fixture.rule, autoRepairAllowed: false };
      const input = { ...fixture.input, matchedRule: rule, match: matchIncidentToKnowledgeBase(fixture.incident, [rule]) };
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(rule, calls)]), []).repair(input);
      expect(result.status).toBe("NEEDS_REVIEW");
      expect(calls.count).toBe(0);
    });
  });

  it("CASE 4 routes ambiguous matches to report fallback without repair", async () => {
    await withFixture(async fixture => {
      const source = fixture.rule;
      const rules = [{ ...source, issueId: "TEST_AMBIGUOUS_A" }, { ...source, issueId: "TEST_AMBIGUOUS_B" }];
      const match = matchIncidentToKnowledgeBase(fixture.incident, rules);
      const reports: unknown[] = [];
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([]), [], async report => { reports.push(report); return { jsonReportPath: "json", markdownReportPath: "md" }; }).repair({ ...fixture.input, match, matchedRule: null });
      expect(result.status).toBe("AMBIGUOUS_INCIDENT");
      expect(result.report?.disposition).toBe("AMBIGUOUS_INCIDENT");
      expect(reports).toHaveLength(1);
    });
  });

  it("CASE 5 keeps CURRENT unchanged until candidate promotion", async () => {
    await withFixture(async fixture => {
      const calls = { count: 0, currentBefore: [] as string[] };
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, calls)]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, [])]).repair(fixture.input);
      expect(calls.currentBefore).toEqual(["approved-current"]);
      expect(await readFile(fixture.currentOutputVersion.filePath, "utf8")).toBe("approved-current");
      expect(result.status).toBe("PROMOTED");
    });
  });

  it("CASE 6 promotes after all required partial validators PASS", async () => {
    await withFixture(async fixture => {
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] })]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, [])]).repair(fixture.input);
      expect(result.promotedVersionId).toBe(result.candidateVersionId);
      expect((await fixture.outputVersions.getCurrentOutput("project-4a4"))?.id).toBe(result.candidateVersionId);
    });
  });

  it("CASE 7 rejects when partial validation FAILs and preserves old CURRENT", async () => {
    await withFixture(async fixture => {
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] })]), [testValidator("failing-validator", testFinding(), [])]).repair(fixture.input);
      expect(result.status).toBe("REPAIR_FAILED");
      expect(result.rejectedCandidateId).toBe(result.candidateVersionId);
      expect((await fixture.outputVersions.getCurrentOutput("project-4a4"))?.id).toBe(fixture.currentOutputVersion.id);
    });
  });

  it("CASE 8 rejects candidate and creates report when handler throws", async () => {
    await withFixture(async fixture => {
      const root = path.join(fixture.root, "reports");
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] }, "THROW")]), [], async report => exportQaIncidentReport(report, { root })).repair(fixture.input);
      expect(result.status).toBe("REPAIR_FAILED");
      expect(result.report?.disposition).toBe("REPAIR_FAILED");
      expect(result.rejectedCandidateId).toBe(result.candidateVersionId);
    });
  });

  it("CASE 9 FRAME_REGION revalidates only the affected scene", async () => {
    await withFixture(async fixture => {
      const calls: Array<{ id: string; sceneNumbers?: number[] }> = [];
      const handler = testHandler(fixture.rule, { count: 0, currentBefore: [] });
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([handler]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, calls)]).repair(fixture.input);
      expect(result.status).toBe("PROMOTED");
      expect(calls.every(call => call.sceneNumbers?.join(",") === "5")).toBe(true);
    });
  });

  it("CASE 10 SCENE repair includes only dependency validators for the affected scene", async () => {
    await withFixture(async fixture => {
      const rule = { ...fixture.rule, repairScope: "SCENE" as const };
      const calls: Array<{ id: string; sceneNumbers?: number[] }> = [];
      const handler = testHandler(rule, { count: 0, currentBefore: [] }, "REPAIRED", { repairScope: "SCENE", validationPlan: { validatorIds: ["failing-validator"], requiredValidatorIds: ["failing-validator"], preserveValidatorIds: [] } });
      const input = { ...fixture.input, matchedRule: rule, match: matchIncidentToKnowledgeBase(fixture.incident, [rule]) };
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([handler]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, calls)]).repair(input);
      expect(result.status).toBe("PROMOTED");
      expect(calls.every(call => call.sceneNumbers?.join(",") === "5")).toBe(true);
    });
  });

  it("CASE 11 ASSEMBLY repair revalidates source/order/boundary without generation", async () => {
    await withFixture(async fixture => {
      const rule = { ...fixture.rule, repairScope: "ASSEMBLY" as const };
      const calls: string[] = [];
      const validators = ["failing-validator", "final-container", "scene-boundaries", "approved-sources"].map(id => ({ id, validate: async () => { calls.push(id); return [{ ...testFinding(id), status: "PASS" as const }]; } }));
      const handler = testHandler(rule, { count: 0, currentBefore: [] }, "REPAIRED", { repairScope: "ASSEMBLY", supportedValidatorIds: ["failing-validator"], validationPlan: { validatorIds: ["final-container", "scene-boundaries", "approved-sources"], requiredValidatorIds: ["failing-validator", "final-container", "scene-boundaries", "approved-sources"], preserveValidatorIds: [] } });
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([handler]), validators).repair({ ...fixture.input, matchedRule: rule, match: matchIncidentToKnowledgeBase(fixture.incident, [rule]) });
      expect(result.status).toBe("PROMOTED");
      expect(calls).toEqual(expect.arrayContaining(["final-container", "scene-boundaries", "approved-sources"]));
      expect(calls).not.toContain("generate");
    });
  });

  it("CASE 12 required NOT_EVALUATED blocks promotion", async () => {
    await withFixture(async fixture => {
      const handler = testHandler(fixture.rule, { count: 0, currentBefore: [] }, "REPAIRED", { validationPlan: { validatorIds: ["failing-validator", "missing-required"], requiredValidatorIds: ["failing-validator", "missing-required"], preserveValidatorIds: [] } });
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([handler]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, [])]).repair(fixture.input);
      expect(result.status).toBe("REPAIR_FAILED");
      expect(result.validationResults.find(item => item.validatorId === "missing-required")?.status).toBe("NOT_EVALUATED");
    });
  });

  it("CASE 13 stops at retry limit without calling handler", async () => {
    await withFixture(async fixture => {
      const calls = { count: 0, currentBefore: [] as string[] };
      const input = { ...fixture.input, incident: testIncident({ previousRepairAttempts: [{ ruleId: fixture.rule.issueId, status: "REPAIR_FAILED", at: "2026-09-14T00:00:00.000Z" }] }) };
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, calls)]), []).repair(input);
      expect(result.status).toBe("RETRY_LIMIT_REACHED");
      expect(calls.count).toBe(0);
    });
  });

  it("CASE 14 preserves generationStatus SUCCESS after repair success", async () => {
    await withFixture(async fixture => {
      const success = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] })]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, [])]).repair(fixture.input);
      expect(success.generationStatus).toBe("SUCCESS");
    });
  });

  it("CASE 15 preserves outputReady true after repair failure", async () => {
    await withFixture(async fixture => {
      const fail = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] }, "THROW")])).repair(fixture.input);
      expect(fail.generationStatus).toBe("SUCCESS");
      expect(fail.outputReady).toBe(true);
    });
  });

  it("CASE 16 keeps the previous file after failed candidate", async () => {
    await withFixture(async fixture => {
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] })]), [testValidator("failing-validator", testFinding(), [])]).repair(fixture.input);
      expect(result.status).toBe("REPAIR_FAILED");
      expect(await readFile(fixture.currentOutputVersion.filePath, "utf8")).toBe("approved-current");
    });
  });

  it("CASE 17 keeps the previous version file after successful promotion", async () => {
    await withFixture(async fixture => {
      await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] })]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, [])]).repair(fixture.input);
      expect(await readFile(fixture.currentOutputVersion.filePath, "utf8")).toBe("approved-current");
    });
  });

  it("CASE 18 reuses Task 4A.2 report/handoff for matched no handler", async () => {
    await withFixture(async fixture => {
      const reports: unknown[] = [];
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([]), [], async report => { reports.push(report); return { jsonReportPath: "json", markdownReportPath: "md" }; }).repair(fixture.input);
      expect(result.status).toBe("MATCHED_BUT_NO_HANDLER");
      expect(result.report?.matchedRuleId).toBe(fixture.rule.issueId);
      expect(result.codexHandoffText).toContain("CODEX HANDOFF");
      expect(reports).toHaveLength(1);
    });
  });

  it("CASE 19 does not register the test-only handler in production registry", async () => {
    await withFixture(async fixture => {
      expect(new RepairHandlerRegistry().getPostAssembly(fixture.rule.issueId)).toBeUndefined();
    });
  });

  it("CASE 20 keeps Scene 1–4 approved state unchanged for a Scene 5 repair", async () => {
    await withFixture(async fixture => {
      const originalApprovedScenes = [...(fixture.input.approvedSources ?? [])];
      const result = await new PostAssemblyRepairCoordinator(fixture.outputVersions, new RepairHandlerRegistry([testHandler(fixture.rule, { count: 0, currentBefore: [] })]), [testValidator("failing-validator", { ...testFinding(), status: "PASS" }, [])]).repair(fixture.input);
      expect(result.affectedScene).toBe(5);
      expect(fixture.input.approvedSources).toEqual(originalApprovedScenes);
      expect(await readFile(fixture.currentOutputVersion.filePath, "utf8")).toBe("approved-current");
    });
  });
});
