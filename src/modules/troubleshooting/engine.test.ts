import { describe, expect, it, vi } from "vitest";
import { BoundedAutoRepairEngine } from "./engine";
import { RepairHandlerRegistry, type RepairHandler } from "./handlers";
import { TroubleshootingIncidentRepository, type IncidentPersistence } from "./incident-repository";
import { incidentReportToMarkdown } from "./report";
import { VERIFIED_TROUBLESHOOTING_RULES } from "./seed";

const evidence = [{ kind: "runtime-log", source: "fixture", value: "observed" }];
const base = (overrides: Record<string, unknown> = {}) => ({ timestamp: "2026-09-14T00:00:00.000Z", projectId: "project-1", sceneNumber: 1, stage: "SCENES", component: "Flow generation", symptoms: [], errorMessages: [], errorCodes: [], firstDivergence: null, evidence, runtimeState: {}, checkpoint: { stage: "SCENES", safe: true }, ...overrides });

function repository() {
  const persistence: IncidentPersistence = { upsertIncident: vi.fn(async () => undefined), appendAudit: vi.fn(async () => undefined) };
  return { persistence, repository: new TroubleshootingIncidentRepository(persistence, async () => undefined) };
}
function makeEngine(rules = VERIFIED_TROUBLESHOOTING_RULES, handlers?: RepairHandlerRegistry) {
  const state = repository();
  // Synthetic policy authorization exercises handlers; it is NOT production evidence.
  const fixtures = rules.map(rule => ({ ...rule, verificationStatus: "VERIFIED" as const, autoRepairAllowed: rule.automationClass === "AUTO_SAFE" || rule.automationClass === "AUTO_GUARDED" }));
  return { ...state, engine: new BoundedAutoRepairEngine(fixtures, handlers, state.repository, () => true) };
}

describe("BoundedAutoRepairEngine", () => {
  it("precondition failure prevents invoking an otherwise authorized handler", async () => {
    const handle = vi.fn();
    const { engine } = makeEngine(VERIFIED_TROUBLESHOOTING_RULES, new RepairHandlerRegistry([{ issueId: "FALLBACK_DOWNLOAD_ERROR_PROPAGATION", mode: "AUTO", handle }]));
    const result = await engine.process(base({ stage: "DOWNLOAD", component: "download bridge", firstDivergence: "DOWNLOAD", errorMessages: ["FALLBACK_SUCCESS_REPORTED_AS_FAILURE"], runtimeState: { fallbackDownloadSucceeded: true, localFileValidated: false } }));
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(handle).not.toHaveBeenCalled();
  });

  it("arbitrary rule text is data, never evaluated or used as executable repair", async () => {
    const evaluate = vi.spyOn(globalThis, "eval");
    try {
      const source = VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "LOW_CREDIT_FALSE_BLOCK")!;
      const { engine } = makeEngine([{ ...source, optimalFix: "eval('throw new Error(unsafe)'); powershell Remove-Item; process.exit()" }]);
      const result = await engine.process(base({ stage: "FLOW_RUNTIME", component: "Flow status classifier", firstDivergence: "FLOW_RUNTIME", errorMessages: ["You're running low on credits"], runtimeState: { creditBlock: false, directCreditBlockEvidence: false } }));
      expect(result.actionsTaken).toEqual(["classifyCreditState"]);
      expect(evaluate).not.toHaveBeenCalled();
    } finally { evaluate.mockRestore(); }
  });
  it("blocks stale VERIFIED auto=true rules without independent production provenance", async () => {
    const source = VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "LOW_CREDIT_FALSE_BLOCK")!;
    const state = repository();
    const engine = new BoundedAutoRepairEngine([{ ...source, verificationStatus: "VERIFIED", autoRepairAllowed: true }], undefined, state.repository);
    const result = await engine.process(base({ stage: "FLOW_RUNTIME", component: "Flow status classifier", firstDivergence: "FLOW_RUNTIME", errorMessages: ["You're running low on credits"], runtimeState: { creditBlock: false, directCreditBlockEvidence: false } }));
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.actionsTaken).toEqual([]);
  });

  it.each([{ verificationStatus: "PROVISIONAL" as const, autoRepairAllowed: true }, { verificationStatus: "VERIFIED" as const, autoRepairAllowed: false }])("blocks status/policy bypass $verificationStatus $autoRepairAllowed", async policy => {
    const source = VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === "LOW_CREDIT_FALSE_BLOCK")!;
    const state = repository();
    const handle = vi.fn();
    const engine = new BoundedAutoRepairEngine([{ ...source, ...policy }], new RepairHandlerRegistry([{ issueId: source.issueId, mode: "AUTO", handle }]), state.repository, () => true);
    const result = await engine.process(base({ stage: "FLOW_RUNTIME", component: "Flow status classifier", firstDivergence: "FLOW_RUNTIME", errorMessages: ["You're running low on credits"], runtimeState: { creditBlock: false, directCreditBlockEvidence: false } }));
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(handle).not.toHaveBeenCalled();
  });
  it("CASE 1: matches Audio generation failed only with job evidence", async () => {
    const { engine, persistence } = makeEngine();
    const result = await engine.process(base({ stage: "FLOW_GENERATION", firstDivergence: "GENERATION_EXECUTION", errorMessages: ["Audio generation failed"], runtimeState: { httpStatus: 200, jobCreated: true, creditBlock: false } }));
    expect(result.match.matchedRuleId).toBe("FLOW_AUDIO_GENERATION_FAILED");
    expect(result.status).toBe("MATCHED_BUT_NO_HANDLER");
    expect(persistence.appendAudit).toHaveBeenCalledWith(result.incidentId, expect.objectContaining({ type: "INCIDENT_CREATED" }));
    expect(persistence.appendAudit).toHaveBeenCalledWith(result.incidentId, expect.objectContaining({ type: "FINAL_RESULT" }));
  });

  it("CASE 2: low-credit warning is not treated as an insufficient-credit failure", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "FLOW_RUNTIME", component: "Flow status classifier", firstDivergence: "FLOW_RUNTIME", errorMessages: ["You're running low on credits"], runtimeState: { creditBlock: false, directCreditBlockEvidence: false } }));
    expect(result.ruleId).toBe("LOW_CREDIT_FALSE_BLOCK");
    expect(result.status).toBe("REPAIRED");
    expect(result.stateChanged.creditBlock).toBe(false);
  });

  it("CASE 3: composer lifecycle evidence chooses the precise lifecycle rule", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "COMPOSER", component: "Flow composer", firstDivergence: "COMPOSER_STATE_LIFECYCLE", errorMessages: ["COMPOSER_STATE_LOST"], runtimeState: { promptPresent: false, startFrameAttached: false } }));
    expect(result.match.matchedRuleId).toBe("COMPOSER_STATE_SESSION_LIFECYCLE");
    expect(result.status).toBe("MATCHED_BUT_NO_HANDLER");
  });

  it("CASE 4: fallback plus local validation becomes recovered warning and resumes checkpoint", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "DOWNLOAD", component: "download bridge", firstDivergence: "DOWNLOAD", errorMessages: ["FALLBACK_SUCCESS_REPORTED_AS_FAILURE"], runtimeState: { fallbackDownloadSucceeded: true, localFileValidated: true } }));
    expect(result.status).toBe("RECOVERED_WITH_WARNING");
    expect(result.resumeFromStage).toBe("DOWNLOAD");
    expect(result.resumeCheckpoint).toEqual({ stage: "SCENES", safe: true });
  });

  it("CASE 5: dirty background matches reference repair and never edits prompt", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "REFERENCE", component: "background assets", firstDivergence: "BACKGROUND_REFERENCE", errorCodes: ["UNWANTED_READABLE_TEXT"], symptoms: ["Readable text appears"], runtimeState: { backgroundReferenceHasText: true } }));
    expect(result.ruleId).toBe("DIRTY_BACKGROUND_REFERENCE_TEXT");
    expect(result.status).toBe("MATCHED_BUT_NO_HANDLER");
    expect(result.actionsTaken).not.toContain("patchPrompt");
  });

  it("CASE 6: unknown error creates a no-match report export", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "GLOBAL", component: "unknown adapter", errorMessages: ["Totally new failure"], errorCodes: ["NEW_UNKNOWN"], preserveRequirements: ["Do not change approved files"] }));
    expect(result.match.decision).toBe("NO_MATCH");
    expect(result.status).toBe("NEEDS_REVIEW");
    expect(result.report).toBeDefined();
    expect(incidentReportToMarkdown(result.report!)).toContain("Totally new failure");
  });

  it("CASE 7: equally strong rules are ambiguous and never auto repaired", async () => {
    const source = VERIFIED_TROUBLESHOOTING_RULES.find((rule) => rule.issueId === "LOW_CREDIT_FALSE_BLOCK")!;
    const rules = [{ ...source, issueId: "AMBIGUOUS_A" }, { ...source, issueId: "AMBIGUOUS_B" }];
    const { engine } = makeEngine(rules);
    const result = await engine.process(base({ stage: "FLOW_RUNTIME", component: "Flow status classifier", firstDivergence: "FLOW_RUNTIME", errorMessages: ["You're running low on credits"], runtimeState: { creditBlock: false, directCreditBlockEvidence: false } }));
    expect(result.match.decision).toBe("AMBIGUOUS");
    expect(result.status).toBe("NEEDS_REVIEW");
  });

  it("CASE 8: retry limit prevents another handler call", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "DOWNLOAD", component: "download bridge", firstDivergence: "DOWNLOAD", errorMessages: ["FALLBACK_SUCCESS_REPORTED_AS_FAILURE"], runtimeState: { fallbackDownloadSucceeded: true, localFileValidated: true }, previousRepairAttempts: [{ ruleId: "FALLBACK_DOWNLOAD_ERROR_PROPAGATION", status: "RECOVERED_WITH_WARNING", at: "2026-09-14T00:00:00.000Z" }] }));
    expect(result.status).toBe("STOPPED_RETRY_LIMIT");
    expect(result.actionsTaken).toEqual([]);
  });

  it("CASE 9: a matched rule without registered code is not executed", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "FLOW_GENERATION", firstDivergence: "GENERATION_EXECUTION", errorMessages: ["Audio generation failed"], runtimeState: { httpStatus: 200, jobCreated: true, creditBlock: false } }));
    expect(result.status).toBe("MATCHED_BUT_NO_HANDLER");
    expect(result.actionsTaken).toEqual([]);
  });

  it("CASE 10: failed post-validation returns repair failed", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "DOWNLOAD", component: "download bridge", firstDivergence: "DOWNLOAD", errorMessages: ["FLOW_ASSET_DOWNLOAD_TIMEOUT"], runtimeState: { primaryDownloadFailed: true, fallbackDownloadSucceeded: false, localFileValidated: false } }));
    expect(result.ruleId).toBe("ELECTRON_FLOW_FETCH_TIMEOUT_FALLBACK");
    expect(result.status).toBe("REPAIR_FAILED");
  });

  it("CASE 11: DOWNLOAD scope blocks a handler attempting to regenerate", async () => {
    const unsafe: RepairHandler = { issueId: "ELECTRON_FLOW_FETCH_TIMEOUT_FALLBACK", mode: "AUTO", handle: async () => ({ status: "REPAIRED", actionsTaken: ["regenerateScene" as never], filesChanged: [], stateChanged: {}, validationSignals: { fallbackDownloadSucceeded: true, localFileValidated: true }, warnings: [], nextAction: "bad" }) };
    const { engine } = makeEngine(VERIFIED_TROUBLESHOOTING_RULES, new RepairHandlerRegistry([unsafe]));
    const result = await engine.process(base({ stage: "DOWNLOAD", component: "download bridge", firstDivergence: "DOWNLOAD", errorMessages: ["FLOW_ASSET_DOWNLOAD_TIMEOUT"], runtimeState: { primaryDownloadFailed: true, fallbackDownloadSucceeded: true, localFileValidated: true } }));
    expect(result.status).toBe("REPAIR_FAILED");
    expect(result.warnings.join(" ")).toContain("REPAIR_SCOPE_VIOLATION");
  });

  it("CASE 12: external policy becomes manual action and is never bypassed", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "FLOW_RUNTIME", component: "external execution policy", firstDivergence: "FLOW_RUNTIME", errorCodes: ["EXTERNAL_EXECUTION_POLICY_BLOCKED"], runtimeState: { externalPolicyBlocked: true } }));
    expect(result.ruleId).toBe("EXTERNAL_EXECUTION_POLICY_MANUAL_HANDOFF");
    expect(result.status).toBe("NEEDS_MANUAL_ACTION");
  });
});
