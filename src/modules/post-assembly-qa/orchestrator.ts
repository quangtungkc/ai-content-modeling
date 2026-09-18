import { randomUUID, createHash } from "node:crypto";
import { incidentSchema } from "@/modules/troubleshooting/incident-schema";
import { matchIncidentToKnowledgeBase } from "@/modules/troubleshooting/matcher";
import { buildIncidentReport, dispositionForMatch, type QaIncidentDisposition, type QaIncidentReport } from "@/modules/troubleshooting/report";
import { exportQaIncidentReport } from "@/modules/troubleshooting/incident-report-service";
import { VERIFIED_TROUBLESHOOTING_RULES } from "@/modules/troubleshooting/seed";
import type { QaContext, QaRun, QaValidator } from "./types";
import { defaultQaValidators } from "./validators";
import { POST_ASSEMBLY_QA_VALIDATOR_VERSION, type QaRunPersistence } from "./repository";
const hash = (value: string) => createHash("sha256").update(value).digest("hex").slice(0, 24);
type QaReportExporter = (report: QaIncidentReport) => Promise<unknown>;
type QaReportWarningHandler = (report: QaIncidentReport, error: unknown) => void | Promise<void>;

function reportDispositionForQa(match: ReturnType<typeof matchIncidentToKnowledgeBase>): QaIncidentDisposition | null {
  return dispositionForMatch(match) ?? (match.matchedRuleId ? "MATCHED_BUT_NO_HANDLER" : null);
}

type QaExecutionError = Error & { qaComponent?: string; qaStage?: string };

function describeQaError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string" && error) return error;
  try {
    const serialized = JSON.stringify(error);
    return serialized && serialized !== "{}" ? serialized : "Unknown QA execution error";
  } catch {
    return "Unknown QA execution error";
  }
}

function withQaExecutionContext(error: unknown, component: string): QaExecutionError {
  const enriched = error instanceof Error ? error : new Error(describeQaError(error));
  const contextual = enriched as QaExecutionError;
  contextual.qaStage = "POST_ASSEMBLY_QA";
  contextual.qaComponent = component;
  return contextual;
}

function normalizeQaError(error: unknown, fallbackComponent: string) {
  const source = error && typeof error === "object" ? error as QaExecutionError : undefined;
  const name = error instanceof Error && error.name ? error.name : "QA_EXECUTION_ERROR";
  const timestamp = new Date().toISOString();
  return {
    message: describeQaError(error),
    name,
    type: name,
    stage: source?.qaStage ?? "POST_ASSEMBLY_QA",
    component: source?.qaComponent ?? fallbackComponent,
    timestamp,
    ...(error instanceof Error && error.stack ? { stack: error.stack } : {}),
  };
}

export class PostAssemblyQaOrchestrator {
  constructor(private readonly validators: QaValidator[] = defaultQaValidators, private readonly persistence?: QaRunPersistence, private readonly hashVideo: (path: string) => Promise<string> = async value => hash(value), private readonly reportExporter: QaReportExporter = async report => exportQaIncidentReport(report), private readonly reportWarningHandler: QaReportWarningHandler = (report, error) => console.warn("POST_ASSEMBLY_QA_REPORT_EXPORT_WARNING", { incidentId: report.incidentId, error: describeQaError(error) })) {}
  async run(context: QaContext, previous?: QaRun): Promise<QaRun> {
    const finalVideoHash = await this.hashVideo(context.finalVideoPath);
    const existing = this.persistence ? await this.persistence.find(context.projectId, finalVideoHash, POST_ASSEMBLY_QA_VALIDATOR_VERSION) : previous;
    if (existing?.status === "COMPLETED" && existing.finalVideoHash === finalVideoHash && existing.validatorVersion === POST_ASSEMBLY_QA_VALIDATOR_VERSION) return existing;
    if (existing?.status === "RUNNING" && this.persistence) await this.persistence.interrupt(existing);
    const startedAt = new Date().toISOString();
    const run: QaRun = { qaRunId: randomUUID(), projectId: context.projectId, finalVideoPath: context.finalVideoPath, finalVideoHash, finalVideoVersion: context.finalVideoVersion, validatorVersion: POST_ASSEMBLY_QA_VALIDATOR_VERSION, status: "RUNNING", findings: [], incidentsCreated: [], repairsTriggered: [], qualityStatusBefore: "NOT_RUN", qualityStatusAfter: "CHECKING", startedAt, finishedAt: null };
    // Persist RUNNING before any validator or finding work starts. A caught
    // exception can then transition this exact run to FAILED instead of
    // leaving an untracked execution or incorrectly using INTERRUPTED.
    if (this.persistence) {
      const persisted = await this.persistence.create(run);
      // A concurrent request may lose the database unique-key race. The
      // repository returns the winner's logical run in that case; reuse it
      // instead of completing/failing the losing, nonexistent id.
      if (persisted.qaRunId !== run.qaRunId) return persisted;
    }

    let findings: QaRun["findings"] = [];
    const incidentsCreated: string[] = [];
    const repairsTriggered: string[] = [];
    const reports: QaIncidentReport[] = [];
    let executionComponent = "validator-execution";
    try {
      findings = (await Promise.all(this.validators.map(async validator => {
        try {
          return await validator.validate(context);
        } catch (error) {
          throw withQaExecutionContext(error, validator.id);
        }
      }))).flat();
      const failures = findings.filter(f => f.status === "FAIL");
      executionComponent = "finding-processing";
      for (const finding of failures) {
        const expectedState = finding.expected && typeof finding.expected === "object" && !Array.isArray(finding.expected) ? finding.expected as Record<string, unknown> : { value: finding.expected };
        const actualState = finding.actual && typeof finding.actual === "object" && !Array.isArray(finding.actual) ? finding.actual as Record<string, unknown> : { value: finding.actual };
        const incident = incidentSchema.parse({ timestamp: startedAt, projectId: context.projectId, sceneNumber: finding.sceneNumber, stage: "FINAL_AUDIT", component: finding.validatorId, symptoms: [finding.symptom ?? "Post-assembly QA finding"], errorMessages: [], errorCodes: [finding.symptom ?? finding.validatorId], firstDivergence: finding.suggestedFirstDivergence, expectedState, actualState, evidence: [{ kind: "qa-finding", source: finding.validatorId, value: finding.evidence }], runtimeState: { validatorResult: "FAIL" }, checkpoint: context.checkpoint, affectedFiles: finding.affectedFile ? [finding.affectedFile] : [context.finalVideoPath], preserveRequirements: ["Keep generationStatus SUCCESS and outputReady true.", "Never overwrite current final.mp4 before candidate validation PASS."] });
        const match = matchIncidentToKnowledgeBase(incident, VERIFIED_TROUBLESHOOTING_RULES); incidentsCreated.push(incident.incidentId); if (match.matchedRuleId && VERIFIED_TROUBLESHOOTING_RULES.find(rule => rule.issueId === match.matchedRuleId)?.autoRepairAllowed) repairsTriggered.push(match.matchedRuleId);
        const disposition = reportDispositionForQa(match) ?? (/^SOURCE_/i.test(finding.validatorId) ? "UNKNOWN_INCIDENT" : null);
        if (disposition) reports.push(buildIncidentReport(incident, match, `Post-Assembly QA routing ended at ${disposition}; no safe automatic repair was performed.`, { disposition, qaRunId: run.qaRunId, validatorId: finding.validatorId, validatorStatus: finding.status, severity: finding.severity, confidence: finding.confidence, globalTimestamp: finding.globalTimestamp, sceneLocalTimestamp: finding.sceneLocalTimestamp, finalVideoPath: context.finalVideoPath, finalVideoHash, finalVideoVersion: context.finalVideoVersion, approvedManifest: context.approvedManifest, approvedSourceInformation: { approvedSources: context.approvedSources }, generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NEEDS_REVIEW" }));
      }
      const requiredValidationPending = findings.some((finding) => finding.status === "NOT_EVALUATED" && (/^SOURCE_/i.test(finding.validatorId) || finding.validatorId === "source-fidelity"));
      const qualityStatusAfter = failures.length || requiredValidationPending ? "NEEDS_REVIEW" : "APPROVED";
      const completed = { ...run, status: "COMPLETED" as const, findings, incidentsCreated, repairsTriggered, qualityStatusAfter, finishedAt: new Date().toISOString() };
      executionComponent = "qa-result-persistence";
      for (const report of reports) {
        try { await this.reportExporter(report); } catch (error) { await this.reportWarningHandler(report, error); }
      }
      return this.persistence ? await this.persistence.complete(completed) : completed;
    } catch (error) {
      const normalized = normalizeQaError(error, executionComponent);
      const failed: QaRun = { ...run, status: "FAILED", findings, incidentsCreated, repairsTriggered, qualityStatusAfter: "NEEDS_REVIEW", finishedAt: normalized.timestamp };
      if (!this.persistence) return failed;
      try {
        return await this.persistence.fail(failed, JSON.stringify(normalized));
      } catch (persistenceError) {
        throw new Error(`Post-Assembly QA failed: ${normalized.message}; FAILED persistence also failed: ${describeQaError(persistenceError)}`);
      }
    }
  }
}
