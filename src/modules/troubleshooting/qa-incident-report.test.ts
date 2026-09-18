import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { generationStateAfterIncidentReportFailure } from "./runtime-bridge";
import { BoundedAutoRepairEngine } from "./engine";
import { RepairHandlerRegistry, type RepairHandler } from "./handlers";
import { TroubleshootingIncidentRepository, type IncidentPersistence } from "./incident-repository";
import { incidentSchema } from "./incident-schema";
import { PostAssemblyQaOrchestrator } from "../post-assembly-qa/orchestrator";
import type { QaValidator } from "../post-assembly-qa/types";
import { VERIFIED_TROUBLESHOOTING_RULES } from "./seed";
import { buildIncidentReport, incidentReportToMarkdown, qaIncidentReportSchema } from "./report";
import { buildCodexHandoffText, buildQaIncidentUserMessage, exportQaIncidentReport, getCodexHandoffText, getQaIncidentJsonPath, getQaIncidentMarkdownPath, getQaIncidentReport } from "./incident-report-service";

const evidence = [{ kind: "runtime-log", source: "qa-test", value: { message: "observed incident", relevant: true } }];
const base = (overrides: Record<string, unknown> = {}) => ({
  timestamp: "2026-09-14T00:00:00.000Z",
  incidentId: "11111111-1111-4111-8111-111111111111",
  projectId: "project-qa",
  sceneNumber: 5,
  stage: "GLOBAL",
  component: "unknown QA validator",
  symptoms: ["Unknown QA finding"],
  errorMessages: ["UNSEEN_QA_FAILURE"],
  errorCodes: ["UNSEEN_CODE"],
  firstDivergence: null,
  expectedState: { expected: "approved state" },
  actualState: { actual: "observed state", globalTimestamp: 18.42, sceneLocalTimestamp: 2.42, finalVideoPath: "final.mp4", finalVideoHash: "old-hash", finalVideoVersion: "version-1" },
  evidence,
  runtimeState: { generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NEEDS_REVIEW" },
  checkpoint: { stage: "FINAL_AUDIT", approvedScenes: [1, 2, 3, 4, 5] },
  attemptCount: 2,
  previousRepairAttempts: [{ ruleId: "OLD_RULE", status: "REPAIR_FAILED", at: "2026-09-14T00:00:00.000Z" }],
  affectedFiles: ["final.mp4"],
  preserveRequirements: ["Preserve approved Scene 1–4.", "Do not regenerate the whole pipeline."],
  ...overrides,
});

function memoryIncidentRepository() {
  const persistence: IncidentPersistence = { upsertIncident: vi.fn(async () => undefined), appendAudit: vi.fn(async () => undefined) };
  return { persistence, repository: new TroubleshootingIncidentRepository(persistence, async () => undefined) };
}

function makeEngine(rules = VERIFIED_TROUBLESHOOTING_RULES, handlers?: RepairHandlerRegistry) {
  const state = memoryIncidentRepository();
  const fixtures = rules.map(rule => ({ ...rule, verificationStatus: "VERIFIED" as const, autoRepairAllowed: rule.automationClass === "AUTO_SAFE" || rule.automationClass === "AUTO_GUARDED" }));
  return { ...state, engine: new BoundedAutoRepairEngine(fixtures, handlers, state.repository, () => true) };
}

async function withTempRoot<T>(callback: (root: string) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "qa-incident-report-"));
  try { return await callback(root); } finally { await rm(root, { recursive: true, force: true }); }
}

describe("Post-Assembly QA incident report package", () => {
  it("CASE 1 creates JSON, Markdown and handoff for NO_MATCH", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base());
    expect(result.match.decision).toBe("NO_MATCH");
    expect(result.report?.disposition).toBe("UNKNOWN_INCIDENT");
    await withTempRoot(async root => {
      const paths = await exportQaIncidentReport(result.report!, { root });
      expect(await readFile(paths.jsonReportPath, "utf8")).toContain("UNKNOWN_INCIDENT");
      expect(await readFile(paths.markdownReportPath, "utf8")).toContain("Post-Assembly QA Incident Report");
      expect(buildCodexHandoffText(result.report!)).toContain("CODEX HANDOFF");
      expect(buildQaIncidentUserMessage(result.report!)).toContain("Báo cáo cho Codex đã được chuẩn bị");
    });
  });

  it("CASE 2 reports MATCHED_BUT_NO_HANDLER with the matched rule and reason", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "FLOW_GENERATION", component: "Flow generation", firstDivergence: "GENERATION_EXECUTION", errorMessages: ["Audio generation failed"], errorCodes: [], runtimeState: { httpStatus: 200, jobCreated: true, creditBlock: false } }));
    expect(result.status).toBe("MATCHED_BUT_NO_HANDLER");
    expect(result.report).toMatchObject({ disposition: "MATCHED_BUT_NO_HANDLER", matchedRuleId: "FLOW_AUDIO_GENERATION_FAILED" });
    expect(result.report?.whyAutoRepairNotPerformed).toContain("Rule matched");
  });

  it("CASE 3 reports AMBIGUOUS with candidates and contradiction evidence", async () => {
    const source = VERIFIED_TROUBLESHOOTING_RULES.find((rule) => rule.issueId === "LOW_CREDIT_FALSE_BLOCK")!;
    const rules = [{ ...source, issueId: "AMBIGUOUS_A" }, { ...source, issueId: "AMBIGUOUS_B" }];
    const { engine } = makeEngine(rules);
    const result = await engine.process(base({ stage: "FLOW_RUNTIME", component: "Flow status classifier", firstDivergence: "FLOW_RUNTIME", errorMessages: ["You're running low on credits"], errorCodes: [], runtimeState: { creditBlock: false, directCreditBlockEvidence: false } }));
    expect(result.match.decision).toBe("AMBIGUOUS");
    expect(result.report?.disposition).toBe("AMBIGUOUS_INCIDENT");
    expect(result.report?.candidateRules.length).toBe(2);
    expect(result.report?.missingEvidence.length || result.report?.contradictingEvidence.length).toBeGreaterThan(0);
  });

  it("CASE 4 reports INSUFFICIENT_EVIDENCE without inventing first divergence", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "FLOW_GENERATION", component: "Flow generation", firstDivergence: null, errorMessages: ["Audio generation failed"], errorCodes: [], evidence }));
    expect(result.match.decision).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.report?.disposition).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.report?.suggestedFirstDivergence).toBeNull();
    expect(result.report?.confirmedFirstDivergence).toBeNull();
  });

  it("CASE 5 reports REPAIR_FAILED with previous repair information", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "DOWNLOAD", component: "download bridge", firstDivergence: "DOWNLOAD", errorMessages: ["FLOW_ASSET_DOWNLOAD_TIMEOUT"], errorCodes: [], runtimeState: { primaryDownloadFailed: true, fallbackDownloadSucceeded: false, localFileValidated: false } }));
    expect(result.status).toBe("REPAIR_FAILED");
    expect(result.report?.disposition).toBe("REPAIR_FAILED");
    expect(result.report?.previousRepairAttempts).toHaveLength(1);
  });

  it("CASE 6 reports RETRY_LIMIT_REACHED with retry count and limit", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ stage: "DOWNLOAD", component: "download bridge", firstDivergence: "DOWNLOAD", errorMessages: ["FALLBACK_SUCCESS_REPORTED_AS_FAILURE"], errorCodes: [], runtimeState: { fallbackDownloadSucceeded: true, localFileValidated: true }, previousRepairAttempts: [{ ruleId: "FALLBACK_DOWNLOAD_ERROR_PROPAGATION", status: "RECOVERED_WITH_WARNING", at: "2026-09-14T00:00:00.000Z" }] }));
    expect(result.status).toBe("STOPPED_RETRY_LIMIT");
    expect(result.report).toMatchObject({ disposition: "RETRY_LIMIT_REACHED", retryCount: 2, retryLimit: 1 });
  });

  it("CASE 7 preserves Scene 5 scene/global/local timestamps", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base());
    expect(result.report).toMatchObject({ sceneNumber: 5, globalTimestamp: 18.42, sceneLocalTimestamp: 2.42 });
  });

  it("CASE 8 puts approved Scene 1–4 preserve requirements into handoff", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ preserveRequirements: ["Scene 1–4 đã PASS; không thay đổi.", "Nếu scope là FRAME_REGION, không regenerate whole scene."] }));
    const handoff = buildCodexHandoffText(result.report!);
    expect(handoff).toContain("Scene 1–4 đã PASS");
    expect(handoff).toContain("PRESERVE APPROVED STATE");
    expect(handoff).toContain("FRAME_REGION");
  });

  it("CASE 9 JSON survives reload and schema validation", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base());
    await withTempRoot(async root => {
      await exportQaIncidentReport(result.report!, { root });
      const loaded = await getQaIncidentReport(result.incidentId, root);
      expect(qaIncidentReportSchema.parse(loaded)).toEqual(loaded);
      expect(loaded.incidentId).toBe(result.incidentId);
    });
  });

  it("CASE 10 writes a non-empty Markdown file and exposes both paths", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base());
    await withTempRoot(async root => {
      const paths = await exportQaIncidentReport(result.report!, { root });
      expect(await getQaIncidentJsonPath(result.incidentId, root)).toBe(paths.jsonReportPath);
      expect(await getQaIncidentMarkdownPath(result.incidentId, root)).toBe(paths.markdownReportPath);
      expect((await readFile(paths.markdownReportPath, "utf8")).length).toBeGreaterThan(100);
    });
  });

  it("CASE 11 handoff contains expected, actual, evidence, divergence, files, checkpoint and preserve requirements", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base());
    const handoff = await withTempRoot(async root => {
      await exportQaIncidentReport(result.report!, { root });
      return getCodexHandoffText(result.incidentId, root);
    });
    expect(handoff).toContain("EXPECTED");
    expect(handoff).toMatch(/ACTUAL|EVIDENCE|SUGGESTED_FIRST_DIVERGENCE|final\.mp4|CHECKPOINT|PRESERVE/);
  });

  it("CASE 12 report export failure preserves generation SUCCESS and outputReady true", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base({ runtimeState: { generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NEEDS_REVIEW" } }));
    const failedFileSystem = {
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => { throw new Error("disk unavailable"); }),
      readFile: vi.fn(),
      readdir: vi.fn(async () => [] as string[]),
    } as never;
    await expect(exportQaIncidentReport(result.report!, { root: "C:\\temp\\qa-reports", fileSystem: failedFileSystem })).rejects.toThrow("disk unavailable");
    expect(generationStateAfterIncidentReportFailure({ generationStatus: "SUCCESS", outputReady: true })).toEqual({ generationStatus: "SUCCESS", outputReady: true });
  });

  it("CASE 13 does not reuse an old hash when the same incident is exported for a new final video", async () => {
    const { engine } = makeEngine();
    const old = await engine.process(base({ actualState: { finalVideoHash: "old-hash", finalVideoVersion: "old-version" } }));
    const freshIncident = { ...base({ actualState: { finalVideoHash: "new-hash", finalVideoVersion: "new-version" } }) };
    const match = old.match;
    const newReport = buildIncidentReport(incidentSchema.parse(freshIncident), match, "Current hash is different; old QA evidence is not reused.", { disposition: "UNKNOWN_INCIDENT" });
    await withTempRoot(async root => {
      await exportQaIncidentReport(old.report!, { root });
      await exportQaIncidentReport(newReport, { root });
      const loaded = await getQaIncidentReport(old.incidentId, root);
      expect(loaded.finalVideoHash).toBe("new-hash");
      expect((await readdir(root)).filter((name) => name.endsWith(".json"))).toHaveLength(1);
    });
  });

  it("CASE 14 exporting the same incident repeatedly is idempotent", async () => {
    const { engine } = makeEngine();
    const result = await engine.process(base());
    await withTempRoot(async root => {
      await exportQaIncidentReport(result.report!, { root });
      await exportQaIncidentReport(result.report!, { root });
      expect((await readdir(root)).sort()).toEqual(expect.arrayContaining([
        expect.stringContaining("qa-report.json"),
        expect.stringContaining("qa-report.md"),
      ]));
      expect((await readdir(root)).length).toBe(2);
    });
  });

  it("Post-Assembly QA triggers the same report exporter for an unhandled finding", async () => {
    const reports: unknown[] = [];
    const exporter = vi.fn(async (report: unknown) => { reports.push(report); });
    const validator: QaValidator = { id: "scene-5-gaze", validate: async () => [{ validatorId: "scene-5-gaze", status: "FAIL", sceneNumber: 5, globalTimestamp: 18.42, sceneLocalTimestamp: 2.42, expected: { gaze: "monitor" }, actual: { gaze: "camera" }, evidence: ["frame evidence"], confidence: 0.7, severity: "HIGH", suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT", affectedRegion: "eyes", affectedFile: "final.mp4", symptom: "GAZE_TO_MONITOR_FAIL" }] };
    const run = await new PostAssemblyQaOrchestrator([validator], undefined, async () => "qa-hash", exporter).run({ projectId: "project-qa", finalVideoPath: "final.mp4", finalVideoVersion: "version-1", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { generationStatus: "SUCCESS", outputReady: true } });
    expect(run.qualityStatusAfter).toBe("NEEDS_REVIEW");
    expect(exporter).toHaveBeenCalledTimes(1);
    expect((reports[0] as { sceneNumber: number; qaRunId: string; disposition: string }).sceneNumber).toBe(5);
    expect((reports[0] as { qaRunId: string }).qaRunId).toBe(run.qaRunId);
  });
});
