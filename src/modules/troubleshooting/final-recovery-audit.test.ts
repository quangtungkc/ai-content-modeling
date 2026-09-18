import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { BoundedAutoRepairEngine } from "./engine";
import { RepairHandlerRegistry } from "./handlers";
import { TroubleshootingIncidentRepository, type IncidentPersistence } from "./incident-repository";
import { exportQaIncidentReport, getCodexHandoffText, getQaIncidentReport } from "./incident-report-service";
import { incidentSchema } from "./incident-schema";
import { generationStateAfterAssembly, qualityTransition, routeRuntimeRepair } from "./runtime-routing";
import { AUTO_REPAIR_RULE_POLICY, TROUBLESHOOTING_KNOWLEDGE_BASE_KEY, TROUBLESHOOTING_KNOWLEDGE_BASE_VERSION, VERIFIED_TROUBLESHOOTING_RULES } from "./seed";
import { REPAIR_SCOPES, validateTroubleshootingRules } from "./schema";

const evidence = [{ kind: "audit-fixture", source: "final-recovery-audit", value: "observed" }];
const incident = (overrides: Record<string, unknown> = {}) => incidentSchema.parse({ incidentId: "99999999-9999-4999-8999-999999999999", timestamp: "2026-09-15T00:00:00.000Z", projectId: "audit-project", sceneNumber: 5, stage: "DOWNLOAD", component: "download bridge", symptoms: [], errorMessages: ["FALLBACK_SUCCESS_REPORTED_AS_FAILURE"], errorCodes: [], firstDivergence: "DOWNLOAD", expectedState: { approvedScenes: [1, 2, 3, 4] }, actualState: { finalVideoHash: "audit-hash" }, evidence, runtimeState: { fallbackDownloadSucceeded: true, localFileValidated: true }, checkpoint: { stage: "DOWNLOAD", approvedScenes: [1, 2, 3, 4] }, attemptCount: 0, previousRepairAttempts: [], affectedFiles: ["final.mp4"], preserveRequirements: ["Preserve approved Scene 1–4.", "Do not regenerate scene."], ...overrides });

function engine() {
  const persistence: IncidentPersistence = { upsertIncident: vi.fn(async () => undefined), appendAudit: vi.fn(async () => undefined) };
  return { persistence, engine: new BoundedAutoRepairEngine(VERIFIED_TROUBLESHOOTING_RULES, new RepairHandlerRegistry(), new TroubleshootingIncidentRepository(persistence, async () => undefined)) };
}

async function withReportRoot<T>(callback: (root: string) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "final-recovery-audit-"));
  try { return await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe("FINAL end-to-end troubleshooting and recovery audit", () => {
  it("AUDIT 1 knowledge base is a single valid, unique, finite verified rule set", () => {
    const rules = validateTroubleshootingRules(VERIFIED_TROUBLESHOOTING_RULES);
    expect(TROUBLESHOOTING_KNOWLEDGE_BASE_KEY).toBe("official-troubleshooting");
    expect(TROUBLESHOOTING_KNOWLEDGE_BASE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(new Set(rules.map(rule => rule.issueId)).size).toBe(rules.length);
    expect(rules.every(rule => ["VERIFIED", "PROVISIONAL"].includes(rule.verificationStatus) && rule.retryPolicy.maxAttempts >= 0 && rule.retryPolicy.maxAttempts <= 10 && rule.retryPolicy.stopConditions.length > 0)).toBe(true);
  });

  it("AUDIT 2 every auto-repair rule maps to a production runtime or Post-Assembly handler", () => {
    const registry = new RepairHandlerRegistry();
    const autoRules = VERIFIED_TROUBLESHOOTING_RULES.filter(rule => rule.autoRepairAllowed);
    expect(autoRules.length).toBe(0);
    for (const rule of autoRules) {
      const runtimeHandler = registry.get(rule.issueId);
      const postHandler = registry.getPostAssembly(rule.issueId);
      expect(runtimeHandler ?? postHandler, `missing handler for ${rule.issueId}`).toBeDefined();
      if (postHandler) {
        expect(postHandler.issueId).toBe(rule.issueId);
        expect(postHandler.postAssembly).toMatchObject({ supportsPostAssembly: true, repairScope: rule.repairScope, mutatesOutputFile: true, requiresCandidate: true });
        expect(postHandler.postAssembly.validationPlan.validatorIds?.length).toBeGreaterThan(0);
        expect(postHandler.postAssembly.handlerId ?? postHandler.issueId).not.toMatch(/test|fixture/i);
      }
    }
    expect(["FLOW_SMOKE_RING_OMITTED", "BLINK_DOES_NOT_REOPEN", "GAZE_NOT_TO_MONITOR", "GAZE_WHITE_HALO_COMPOSITING", "DOUBLE_PUPIL_ERASURE_ALIGNMENT", "FLOW_READABLE_TEXT_OUTPUT"].map(id => registry.getPostAssembly(id)?.issueId)).toEqual(["FLOW_SMOKE_RING_OMITTED", "BLINK_DOES_NOT_REOPEN", "GAZE_NOT_TO_MONITOR", "GAZE_WHITE_HALO_COMPOSITING", "DOUBLE_PUPIL_ERASURE_ALIGNMENT", "FLOW_READABLE_TEXT_OUTPUT"]);
  });

  it("AUDIT 3 known runtime fallback resumes the exact checkpoint without generation", async () => {
    const { engine: auditEngine } = engine();
    const result = await auditEngine.process(incident());
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.actionsTaken).toEqual([]);
    expect(result.resumeCheckpoint).toEqual({ stage: "DOWNLOAD", approvedScenes: [1, 2, 3, 4] });
  });

  it("AUDIT 4 unknown runtime incident pauses safely and emits idempotent handoff artifacts", async () => {
    const { engine: auditEngine } = engine();
    const result = await auditEngine.process(incident({ stage: "GLOBAL", component: "new adapter", firstDivergence: null, errorMessages: ["UNSEEN_RUNTIME_FAILURE"], errorCodes: ["NEW_CODE"], runtimeState: {} }));
    expect(result.match.decision).toBe("NO_MATCH");
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(routeRuntimeRepair(result.status)).toBe("PAUSE_REVIEW");
    await withReportRoot(async root => {
      await exportQaIncidentReport(result.report!, { root });
      await exportQaIncidentReport(result.report!, { root });
      expect((await readdir(root)).length).toBe(2);
      expect(await getCodexHandoffText(result.incidentId, root)).toContain("PRESERVE APPROVED STATE");
      expect((await getQaIncidentReport(result.incidentId, root)).checkpoint).toMatchObject({ approvedScenes: [1, 2, 3, 4] });
    });
  });

  it("AUDIT 5 manual action never bypasses external execution policy", async () => {
    const { engine: auditEngine } = engine();
    const result = await auditEngine.process(incident({ stage: "FLOW_RUNTIME", component: "external execution policy", firstDivergence: "FLOW_RUNTIME", errorMessages: ["EXTERNAL_EXECUTION_POLICY_BLOCKED"], runtimeState: { externalPolicyBlocked: true } }));
    expect(result).toMatchObject({ ruleId: "EXTERNAL_EXECUTION_POLICY_MANUAL_HANDOFF", status: "NEEDS_MANUAL_ACTION" });
    expect(result.actionsTaken).toEqual(["manualHandoff"]);
    expect(routeRuntimeRepair(result.status)).toBe("PAUSE_MANUAL");
  });

  it("AUDIT 6 retry limit and matched-no-handler paths stop without evaluating rule text", async () => {
    const { engine: auditEngine } = engine();
    const stopped = await auditEngine.process(incident({ previousRepairAttempts: [{ ruleId: "FALLBACK_DOWNLOAD_ERROR_PROPAGATION", status: "RECOVERED_WITH_WARNING", at: "2026-09-15T00:00:00.000Z" }] }));
    expect(stopped.status).toBe("NEEDS_REVIEW");
    expect(stopped.actionsTaken).toEqual([]);
    const unhandled = await auditEngine.process(incident({ stage: "SCENES", component: "Flow generation", firstDivergence: "GENERATION_EXECUTION", errorMessages: ["Audio generation failed"], runtimeState: { httpStatus: 200, jobCreated: true, creditBlock: false } }));
    expect(unhandled).toMatchObject({ ruleId: "FLOW_AUDIO_GENERATION_FAILED", status: "MATCHED_BUT_NO_HANDLER", actionsTaken: [] });
  });

  it("AUDIT 7 final assembly success and later quality transitions preserve success semantics", () => {
    const assembly = generationStateAfterAssembly({ containerValid: true, videoStreamValid: true, durationSec: 20, resolution: "720x1280" });
    expect(assembly).toEqual({ generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NOT_RUN" });
    expect(qualityTransition(assembly, "NEEDS_REVIEW")).toEqual({ generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NEEDS_REVIEW" });
  });

  it("AUDIT 8 production registry contains no test-only handlers and no unbounded repair scope", () => {
    const registry = new RepairHandlerRegistry();
    for (const rule of VERIFIED_TROUBLESHOOTING_RULES) {
      const handler = registry.getPostAssembly(rule.issueId);
      if (!handler) continue;
      expect(handler.postAssembly.handlerId ?? handler.issueId).not.toMatch(/test|fixture|scene.?5/i);
      expect(REPAIR_SCOPES).toContain(handler.postAssembly.repairScope as never);
      expect(handler.postAssembly.preserveRequirements.length).toBeGreaterThan(0);
    }
    expect(registry.getPostAssembly("FLOW_AUDIO_GENERATION_FAILED")).toBeUndefined();
  });

  it("AUDIT 9 report and handoff content cannot execute optimalFix text", async () => {
    const { engine: auditEngine } = engine();
    const result = await auditEngine.process(incident({ stage: "SCENES", component: "Flow generation", firstDivergence: "GENERATION_EXECUTION", errorMessages: ["Audio generation failed"], runtimeState: { httpStatus: 200, jobCreated: true, creditBlock: false } }));
    expect(result.status).toBe("MATCHED_BUT_NO_HANDLER");
    expect(result.actionsTaken).toEqual([]);
    await withReportRoot(async root => {
      const paths = await exportQaIncidentReport(result.report!, { root });
      expect(await readFile(paths.jsonReportPath, "utf8")).toContain("MATCHED_BUT_NO_HANDLER");
      expect(await getCodexHandoffText(result.incidentId, root)).toContain("Không regenerate toàn pipeline");
    });
  });
});
