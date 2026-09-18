import { db } from "@/lib/db";
import { appendCodexEvent } from "@/modules/codex-orchestrator/service";
import type { CodexAction, CodexStage } from "@/modules/codex-orchestrator/types";
import { BoundedAutoRepairEngine, type RepairResult } from "./engine";
import { buildIncidentFingerprint } from "./fingerprint";
import { RepairHandlerRegistry } from "./handlers";
import { TroubleshootingIncidentRepository } from "./incident-repository";
import { incidentSchema, type TroubleshootingIncident } from "./incident-schema";
import { type QaIncidentReport } from "./report";
import { buildCodexHandoffText, buildQaIncidentUserMessage, exportQaIncidentReport } from "./incident-report-service";
import { TroubleshootingKnowledgeBaseRepository } from "./repository";
import { routeRuntimeRepair } from "./runtime-routing";

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numberFrom = (value: unknown) => typeof value === "number" && Number.isInteger(value) ? value : null;

export type RuntimeBridgeInput = { jobId: string; userId: string; stage: CodexStage; action: CodexAction; error: unknown; actualState?: Record<string, unknown>; provider?: string };
export type RuntimeBridgeResult = { disposition: "RESUME" | "PAUSE_MANUAL" | "PAUSE_REVIEW"; repair: RepairResult; jsonReportPath?: string; markdownReportPath?: string; reportWarning?: string; codexHandoffText?: string; userMessage?: string };
export type StandaloneRuntimeBridgeInput = { userId: string; stage: CodexStage; error: unknown; projectId?: string | null; sourceVideoId?: string | null; runId?: string | null; actualState?: Record<string, unknown>; checkpoint?: Record<string, unknown>; context?: Record<string, unknown>; provider?: string };
export type StandaloneRuntimeBridgeResult = RuntimeBridgeResult & { fingerprint: string; matchDecision: string; matchedRuleId: string | null; resumeStage: string | null };

async function writeReport(report: QaIncidentReport) {
  return exportQaIncidentReport(report);
}

export function generationStateAfterIncidentReportFailure(job: { generationStatus: string; outputReady: boolean }) {
  return job.generationStatus === "SUCCESS" && job.outputReady === true
    ? { generationStatus: "SUCCESS", outputReady: true }
    : { generationStatus: "PAUSED", outputReady: false };
}

export class ProductionRuntimeIncidentBridge {
  constructor(private readonly rules = new TroubleshootingKnowledgeBaseRepository(), private readonly incidents = new TroubleshootingIncidentRepository(), private readonly handlers = new RepairHandlerRegistry()) {}

  async handleStandalone(input: StandaloneRuntimeBridgeInput): Promise<StandaloneRuntimeBridgeResult> {
    const context = record(input.context);
    const actual: Record<string, unknown> = { ...record(input.actualState), ...(typeof context.errorCode === "string" ? { errorCode: context.errorCode } : {}), ...(typeof context.firstDivergence === "string" ? { firstDivergence: context.firstDivergence } : {}) };
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const errorName = input.error instanceof Error && input.error.name ? input.error.name : "RuntimeError";
    const stack = input.error instanceof Error ? input.error.stack : undefined;
    const errorCode = typeof actual.errorCode === "string" && actual.errorCode ? actual.errorCode : `${input.stage}_CREATION_FAILED`;
    const firstDivergence = typeof actual.firstDivergence === "string" && actual.firstDivergence
      ? actual.firstDivergence
      : /SPEC/i.test(errorCode) ? "SOURCE_MODELING_SPEC" : /MAPPING|SCENE/i.test(errorCode) ? "SCENE_MAPPING" : "CONTENT_PROJECT_CREATION";
    const checkpoint = input.checkpoint ?? record(context.checkpoint);
    const runtimeState: Record<string, unknown> = { ...record(actual.runtimeState) };
    for (const key of ["httpStatus", "jobCreated", "creditBlock", "directCreditBlockEvidence", "promptPresent", "startFrameAttached", "generateEnabled", "primaryDownloadFailed", "fallbackDownloadSucceeded", "localFileValidated", "backgroundReferenceHasText", "externalPolicyBlocked"]) {
      if (actual[key] !== undefined) runtimeState[key] = actual[key];
    }
    const incident = incidentSchema.parse({
      projectId: input.projectId ?? (typeof context.projectId === "string" ? context.projectId : null),
      stage: input.stage,
      component: typeof context.component === "string" ? context.component : "content-project-creation",
      symptoms: [message],
      errorMessages: [message],
      errorCodes: [errorCode],
      firstDivergence,
      expectedState: { stage: input.stage, sourceVideoId: input.sourceVideoId ?? null, checkpoint },
      actualState: { ...actual, errorName, errorCode, sourceVideoId: input.sourceVideoId ?? null, automationRunId: input.runId ?? null },
      evidence: [{ kind: "content-project-creation-error", source: input.provider ?? "app", value: { message, errorName, errorCode, stage: input.stage, projectId: input.projectId ?? null, sourceVideoId: input.sourceVideoId ?? null, automationRunId: input.runId ?? null, stack: stack?.slice(0, 12_000) } }],
      runtimeState: { ...runtimeState, generationStatus: "NOT_STARTED", outputReady: false, contentProjectCreationFailed: true },
      checkpoint,
      attemptCount: 0,
      previousRepairAttempts: [],
      affectedFiles: Array.isArray(context.affectedFiles) ? context.affectedFiles : [],
      preserveRequirements: ["Giữ Modeling Idea đã PASS và source video đã chọn.", "Giữ SourceVideoModelingSpec và Character Identity Pack.", "Không restart hoặc regenerate toàn bộ pipeline.", "Resume đúng stage Content Project/scene creation nếu repair PASS."],
    });
    const fingerprint = buildIncidentFingerprint(incident);
    const existing = await db.troubleshootingIncident.findFirst({ where: { fingerprint: fingerprint.id }, orderBy: { updatedAt: "desc" }, select: { id: true, document: true, attemptCount: true } });
    const previous = existing ? incidentSchema.parse(existing.document) : null;
    const stableIncident: TroubleshootingIncident = previous ? { ...incident, incidentId: existing!.id, attemptCount: existing!.attemptCount, previousRepairAttempts: previous.previousRepairAttempts } : incident;
    const engine = new BoundedAutoRepairEngine(await this.rules.loadVerifiedRules(), this.handlers, this.incidents);
    const repair = await engine.process(stableIncident);
    let reports: { jsonReportPath?: string; markdownReportPath?: string } = {};
    let reportWarning: string | undefined;
    if (repair.report) {
      try { reports = await writeReport(repair.report); }
      catch (error) { reportWarning = `REPORT_EXPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`; await this.incidents.audit(repair.incidentId, "REPORT_EXPORT_WARNING", { error: reportWarning }); }
    }
    const reportOutputs = repair.report ? { ...reports, reportWarning, codexHandoffText: buildCodexHandoffText(repair.report), userMessage: buildQaIncidentUserMessage(repair.report) } : reports;
    const disposition = routeRuntimeRepair(repair.status);
    return { disposition, repair, fingerprint: repair.match.fingerprint.id, matchDecision: repair.match.decision, matchedRuleId: repair.match.matchedRuleId, resumeStage: disposition === "RESUME" ? repair.resumeFromStage ?? input.stage : null, ...reportOutputs };
  }

  async handle(input: RuntimeBridgeInput): Promise<RuntimeBridgeResult> {
    const job = await db.codexJob.findFirst({ where: { id: input.jobId, userId: input.userId }, include: { stages: true } });
    if (!job) throw new Error("CODEX_JOB_NOT_FOUND");
    const actual = record(input.actualState);
    const stageState = job.stages.find((item) => item.stage === input.stage);
    const message = input.error instanceof Error ? input.error.message : String(input.error);
    const runtimeState: Record<string, unknown> = { ...record(actual.runtimeState) };
    for (const key of ["httpStatus", "jobCreated", "creditBlock", "directCreditBlockEvidence", "promptPresent", "startFrameAttached", "generateEnabled", "primaryDownloadFailed", "fallbackDownloadSucceeded", "localFileValidated", "backgroundReferenceHasText", "externalPolicyBlocked"]) {
      if (actual[key] !== undefined) runtimeState[key] = actual[key];
    }
    runtimeState.externalPolicyBlocked = actual.externalPolicyBlocked === true || /EXTERNAL_EXECUTION_POLICY/i.test(message);
    const candidate = incidentSchema.parse({ timestamp: new Date().toISOString(), projectId: job.contentProjectId, sceneNumber: numberFrom(actual.sceneNumber), stage: input.stage, component: String(actual.component ?? input.provider ?? "pipeline-stage"), symptoms: Array.isArray(actual.symptoms) ? actual.symptoms : [], errorMessages: [message], errorCodes: typeof actual.errorCode === "string" ? [actual.errorCode] : [], firstDivergence: typeof actual.firstDivergence === "string" ? actual.firstDivergence : null, expectedState: stageState?.expectedState ?? null, actualState: actual, evidence: [{ kind: "pipeline-error", source: input.provider ?? "executor", value: { message, actual } }], runtimeState, checkpoint: record(job.checkpoint), attemptCount: 0, previousRepairAttempts: [], affectedFiles: Array.isArray(actual.affectedFiles) ? actual.affectedFiles : [], preserveRequirements: ["Giữ scene/asset approved trước stage lỗi.", "Không mở rộng repairScope."] });
    const fingerprint = buildIncidentFingerprint(candidate);
    const existing = await db.troubleshootingIncident.findFirst({ where: { fingerprint: fingerprint.id }, orderBy: { updatedAt: "desc" }, select: { id: true, document: true, attemptCount: true } });
    const previous = existing ? incidentSchema.parse(existing.document) : null;
    const incident: TroubleshootingIncident = previous ? { ...candidate, incidentId: existing!.id, attemptCount: existing!.attemptCount, previousRepairAttempts: previous.previousRepairAttempts } : candidate;
    const engine = new BoundedAutoRepairEngine(await this.rules.loadVerifiedRules(), undefined, this.incidents);
    const repair = await engine.process(incident);
    await appendCodexEvent(input.jobId, "TROUBLESHOOTING_INCIDENT_CREATED", input.stage, { incidentId: repair.incidentId, fingerprint: repair.match.fingerprint.id, sceneNumber: incident.sceneNumber });
    await appendCodexEvent(input.jobId, "TROUBLESHOOTING_MATCHED", input.stage, { incidentId: repair.incidentId, ruleId: repair.ruleId, decision: repair.match.decision, confidence: repair.match.confidence, candidates: repair.match.candidates.slice(0, 5) });
    let reports: { jsonReportPath?: string; markdownReportPath?: string } = {};
    let reportWarning: string | undefined;
    if (repair.report) {
      try {
        reports = await writeReport(repair.report);
      } catch (error) {
        reportWarning = `REPORT_EXPORT_FAILED: ${error instanceof Error ? error.message : String(error)}`;
        try { await appendCodexEvent(input.jobId, "TROUBLESHOOTING_REPORT_EXPORT_WARNING", input.stage, { incidentId: repair.incidentId, error: reportWarning }); } catch { /* reporting a reporting failure must not replace the root incident */ }
      }
    }
    const reportOutputs = repair.report ? { ...reports, reportWarning, codexHandoffText: buildCodexHandoffText(repair.report), userMessage: buildQaIncidentUserMessage(repair.report) } : reports;
    const resume = routeRuntimeRepair(repair.status) === "RESUME";
    if (resume) {
      await db.codexStageState.update({ where: { jobId_stage: { jobId: input.jobId, stage: input.stage } }, data: { status: "PENDING", actualState: { ...actual, troubleshooting: { incidentId: repair.incidentId, status: repair.status, warnings: repair.warnings } } as never } });
      await db.codexJob.update({ where: { id: input.jobId }, data: { status: "RUNNING", generationStatus: "RUNNING", currentStage: repair.resumeFromStage ?? input.stage, currentAction: input.action.name, failureReason: null } });
      await appendCodexEvent(input.jobId, "TROUBLESHOOTING_RESUMED", input.stage, { incidentId: repair.incidentId, status: repair.status, resumeStage: repair.resumeFromStage, warnings: repair.warnings });
      return { disposition: "RESUME", repair, ...reportOutputs };
    }
    const manual = routeRuntimeRepair(repair.status) === "PAUSE_MANUAL";
    const generationState = generationStateAfterIncidentReportFailure(job);
    await db.codexStageState.update({ where: { jobId_stage: { jobId: input.jobId, stage: input.stage } }, data: { status: "FAILED", actualState: { ...actual, troubleshooting: { incidentId: repair.incidentId, status: repair.status, reports } } as never } });
    await db.codexJob.update({ where: { id: input.jobId }, data: { status: manual ? "NEEDS_HUMAN" : "NEEDS_ENGINEERING", ...generationState, qualityStatus: repair.report ? "NEEDS_REVIEW" : "NOT_RUN", currentStage: input.stage, currentAction: "waitForHuman", failureReason: manual ? "Cần thao tác thủ công theo manual handoff checkpoint." : "Phát hiện sự cố chưa có giải pháp tự động." } });
    await appendCodexEvent(input.jobId, "TROUBLESHOOTING_PAUSED", input.stage, { incidentId: repair.incidentId, status: repair.status, reports, warnings: repair.warnings });
    return { disposition: manual ? "PAUSE_MANUAL" : "PAUSE_REVIEW", repair, ...reportOutputs };
  }
}
