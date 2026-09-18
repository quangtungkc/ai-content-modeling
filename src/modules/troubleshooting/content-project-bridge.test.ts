import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as developPost } from "@/app/api/v1/ideas/[id]/develop/route";
import { BoundedAutoRepairEngine } from "./engine";
import { RepairHandlerRegistry } from "./handlers";
import { type IncidentPersistence, TroubleshootingIncidentRepository } from "./incident-repository";
import { ProductionRuntimeIncidentBridge, type StandaloneRuntimeBridgeResult } from "./runtime-bridge";
import { VERIFIED_TROUBLESHOOTING_RULES } from "./seed";
import { troubleshootingRuleSchema, type TroubleshootingRule } from "./schema";

const mocks = vi.hoisted(() => ({
  db: {
    modelingIdea: { findFirst: vi.fn() },
    troubleshootingIncident: { findFirst: vi.fn() },
  },
  session: vi.fn(),
  develop: vi.fn(),
  storeBrowser: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/auth/provider", () => ({ getRequiredSession: mocks.session }));
vi.mock("@/modules/ideas/approval-service", () => ({ developApprovedIdea: mocks.develop, storeDevelopedIdeaFromBrowser: mocks.storeBrowser }));

const originalAppData = process.env.APPDATA;
let reportRoot = "";

function ruleForContentProject(overrides: Partial<TroubleshootingRule> = {}) {
  const source = VERIFIED_TROUBLESHOOTING_RULES.find((rule) => rule.issueId === "FALLBACK_DOWNLOAD_ERROR_PROPAGATION")!;
  return troubleshootingRuleSchema.parse({
    ...source,
    verificationStatus: "VERIFIED",
    autoRepairAllowed: true,
    stage: "PROJECT",
    firstDivergence: "CONTENT_PROJECT_CREATION",
    symptoms: ["content project creation failed"],
    errorSignatures: ["CONTENT_PROJECT_CREATION_FAILED"],
    affectedComponents: ["content-project-creation"],
    ...overrides,
  });
}

function bridgeWith(rules: TroubleshootingRule[], handlers = new RepairHandlerRegistry()) {
  const stored = new Map<string, { id: string; document: unknown; attemptCount: number }>();
  const persistence: IncidentPersistence = {
    upsertIncident: vi.fn(async (incident, fingerprint) => {
      stored.set(fingerprint, { id: incident.incidentId, document: incident, attemptCount: incident.attemptCount });
    }),
    appendAudit: vi.fn(async () => undefined),
  };
  mocks.db.troubleshootingIncident.findFirst.mockImplementation(async ({ where }: { where: { fingerprint: string } }) => stored.get(where.fingerprint) ?? null);
  const incidents = new TroubleshootingIncidentRepository(persistence, async () => undefined);
  const ruleRepository = { loadVerifiedRules: vi.fn(async () => rules) };
  return { bridge: new ProductionRuntimeIncidentBridge(ruleRepository as never, incidents, handlers), persistence, stored };
}

function standaloneInput(message = "CONTENT_PROJECT_CREATION_FAILED: source modeling service failed") {
  return {
    userId: "user-1",
    stage: "PROJECT" as const,
    error: new Error(message),
    sourceVideoId: "video-1",
    runId: "automation-1",
    actualState: { operation: "create-content-project", fallbackDownloadSucceeded: true, localFileValidated: true },
    checkpoint: { stage: "PROJECT", ideaId: "idea-1", sourceVideoId: "video-1" },
    context: { ideaId: "idea-1", component: "content-project-creation" },
    provider: "content-project-service",
  };
}

function fakeBridgeResult(overrides: Record<string, unknown> = {}) {
  return {
    disposition: "PAUSE_REVIEW" as const,
    fingerprint: "fingerprint-1",
    matchDecision: "NO_MATCH",
    matchedRuleId: null,
    resumeStage: null,
    repair: { incidentId: "11111111-1111-4111-8111-111111111111", status: "NEEDS_REVIEW", nextAction: "Create report." },
    ...overrides,
  } as unknown as StandaloneRuntimeBridgeResult;
}

describe("content project creation troubleshooting bridge", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    reportRoot = await mkdtemp(path.join(os.tmpdir(), "content-project-bridge-"));
    process.env.APPDATA = reportRoot;
    mocks.session.mockResolvedValue({ userId: "user-1" });
    mocks.db.modelingIdea.findFirst.mockResolvedValue({ sourceVideoId: "video-1" });
  });

  afterEach(async () => {
    if (originalAppData === undefined) delete process.env.APPDATA;
    else process.env.APPDATA = originalAppData;
    if (reportRoot) await rm(reportRoot, { recursive: true, force: true });
  });

  it("unknown content-project failure creates incident, fingerprint, reports, handoff and survives reload", async () => {
    const { bridge, stored } = bridgeWith([]);
    const result = await bridge.handleStandalone(standaloneInput("BRAND_NEW_CONTENT_PROJECT_FAILURE: database unavailable"));
    expect(result.matchDecision).toBe("NO_MATCH");
    expect(result.repair.status).toBe("NEEDS_REVIEW");
    expect(result.repair.incidentId).toBeTruthy();
    expect(result.jsonReportPath).toBeTruthy();
    expect(result.markdownReportPath).toBeTruthy();
    expect(result.codexHandoffText).toContain("BRAND_NEW_CONTENT_PROJECT_FAILURE");
    expect(result.codexHandoffText).toContain("CHECKPOINT");
    expect(stored.size).toBe(1);
    const json = JSON.parse(await readFile(result.jsonReportPath!, "utf8")) as { actual: { operation: string }; evidence: Array<{ value: { message: string } }> };
    expect(json.actual.operation).toBe("create-content-project");
    expect(json.evidence[0].value.message).toContain("BRAND_NEW_CONTENT_PROJECT_FAILURE");
    expect((await readFile(result.markdownReportPath!, "utf8")).length).toBeGreaterThan(0);
    const files = await readdir(path.dirname(result.jsonReportPath!));
    expect(files).toHaveLength(2);
    const second = await bridge.handleStandalone(standaloneInput("BRAND_NEW_CONTENT_PROJECT_FAILURE: database unavailable"));
    expect(second.repair.incidentId).toBe(result.repair.incidentId);
  });

  it("known auto-repairable content-project failure resumes the same PROJECT checkpoint", async () => {
    const { bridge } = bridgeWith([ruleForContentProject()]);
    const result = await bridge.handleStandalone(standaloneInput());
    expect(result.matchDecision).toBe("EXACT_MATCH");
    expect(result.matchedRuleId).toBe("FALLBACK_DOWNLOAD_ERROR_PROPAGATION");
    expect(result.repair.status).toBe("NEEDS_REVIEW");
    expect(result.disposition).not.toBe("RESUME");
  });

  it("known rule without a production handler is review-only and exports a handoff", async () => {
    const noHandlerRule = ruleForContentProject({ issueId: "CONTENT_PROJECT_NO_HANDLER" });
    const { bridge } = bridgeWith([noHandlerRule], new RepairHandlerRegistry([], []));
    const result = await bridge.handleStandalone(standaloneInput());
    expect(result.matchDecision).toBe("EXACT_MATCH");
    expect(result.matchedRuleId).toBe("CONTENT_PROJECT_NO_HANDLER");
    expect(result.repair.status).toBe("MATCHED_BUT_NO_HANDLER");
    expect(result.disposition).toBe("PAUSE_REVIEW");
    expect(result.jsonReportPath).toBeTruthy();
    expect(result.codexHandoffText).toContain("MATCHED_RULE_ID: CONTENT_PROJECT_NO_HANDLER");
  });

  it("manual develop route calls the same incident bridge and preserves structured error details", async () => {
    mocks.develop.mockRejectedValue(new Error("CONTENT_PROJECT_CREATION_FAILED: manual database error"));
    const bridgeSpy = vi.spyOn(ProductionRuntimeIncidentBridge.prototype, "handleStandalone").mockResolvedValue(fakeBridgeResult());
    const response = await developPost(new Request("http://localhost/api/v1/ideas/idea-1/develop", { method: "POST", body: JSON.stringify({ aspectRatio: "9:16" }) }), { params: Promise.resolve({ id: "idea-1" }) });
    const body = await response.json() as { error: { code: string; message: string; details: { originalError: { message: string }; troubleshooting: { incidentId: string } } } };
    expect(response.status).toBe(409);
    expect(bridgeSpy).toHaveBeenCalledWith(expect.objectContaining({ stage: "PROJECT", runId: null, sourceVideoId: "video-1" }));
    expect(body.error.code).toBe("CONTENT_PROJECT_CREATION_FAILED");
    expect(body.error.details.originalError.message).toContain("manual database error");
    expect(body.error.details.troubleshooting.incidentId).toBe("11111111-1111-4111-8111-111111111111");
    bridgeSpy.mockRestore();
  });

  it("automatic develop route uses the same bridge and resumes without rerunning Modeling Idea", async () => {
    mocks.storeBrowser.mockRejectedValueOnce(new Error("CONTENT_PROJECT_CREATION_FAILED: transient error")).mockResolvedValueOnce({ id: "project-1", scenes: [] });
    const bridgeSpy = vi.spyOn(ProductionRuntimeIncidentBridge.prototype, "handleStandalone").mockResolvedValue(fakeBridgeResult({ disposition: "RESUME", matchDecision: "EXACT_MATCH", matchedRuleId: "FALLBACK_DOWNLOAD_ERROR_PROPAGATION", resumeStage: "PROJECT", repair: { incidentId: "22222222-2222-4222-8222-222222222222", status: "RECOVERED_WITH_WARNING", nextAction: "Resume PROJECT." } }));
    const response = await developPost(new Request("http://localhost/api/v1/ideas/idea-1/develop", { method: "POST", body: JSON.stringify({ provider: "gemini-browser", project: { schemaVersion: "1.0" }, aspectRatio: "9:16", automationRunId: "automation-1" }) }), { params: Promise.resolve({ id: "idea-1" }) });
    const body = await response.json() as { data: { id: string }; troubleshooting: { disposition: string } };
    expect(response.status).toBe(201);
    expect(body.data.id).toBe("project-1");
    expect(body.troubleshooting.disposition).toBe("RESUME");
    expect(bridgeSpy).toHaveBeenCalledWith(expect.objectContaining({ stage: "PROJECT", runId: "automation-1" }));
    expect(mocks.storeBrowser).toHaveBeenCalledTimes(2);
    bridgeSpy.mockRestore();
  });

  it("the standalone bridge uses bounded engine behavior for retry limit", async () => {
    const state = { record: vi.fn(async () => undefined), audit: vi.fn(async () => undefined) };
    const rule = ruleForContentProject();
    const engine = new BoundedAutoRepairEngine([rule], new RepairHandlerRegistry(), state as never, () => true);
    const incident = {
      ...standaloneInput(),
      incidentId: "33333333-3333-4333-8333-333333333333",
      timestamp: "2026-09-15T00:00:00.000Z",
      projectId: null,
      sceneNumber: null,
      component: "content-project-creation",
      symptoms: ["content project creation failed"],
      errorMessages: ["CONTENT_PROJECT_CREATION_FAILED"],
      errorCodes: ["CONTENT_PROJECT_CREATION_FAILED"],
      firstDivergence: "CONTENT_PROJECT_CREATION",
      evidence: [{ kind: "content-project-creation-error", source: "test", value: "failure" }],
      runtimeState: { fallbackDownloadSucceeded: true, localFileValidated: true },
      checkpoint: { stage: "PROJECT" },
      attemptCount: 1,
      previousRepairAttempts: [{ ruleId: "FALLBACK_DOWNLOAD_ERROR_PROPAGATION", status: "RECOVERED_WITH_WARNING", at: "2026-09-15T00:00:00.000Z" }],
      affectedFiles: [],
      preserveRequirements: ["Preserve approved state."],
    };
    const result = await engine.process(incident);
    expect(result.status).toBe("STOPPED_RETRY_LIMIT");
  });
});
