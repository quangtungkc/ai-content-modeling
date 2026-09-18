import { randomUUID } from "node:crypto";
import path from "node:path";
import { matchIncidentToKnowledgeBase, type MatchResult } from "@/modules/troubleshooting/matcher";
import { buildCodexHandoffText, buildQaIncidentUserMessage, exportQaIncidentReport, type QaIncidentReportPaths } from "@/modules/troubleshooting/incident-report-service";
import { buildIncidentReport, dispositionForMatch, type QaIncidentDisposition, type QaIncidentReport } from "@/modules/troubleshooting/report";
import { RepairHandlerRegistry, type PostAssemblyHandlerOutcome, type PostAssemblyRepairHandler } from "@/modules/troubleshooting/handlers";
import type { TroubleshootingIncident } from "@/modules/troubleshooting/incident-schema";
import type { TroubleshootingRule } from "@/modules/troubleshooting/schema";
import { hasProductionRepairProvenance } from "@/modules/troubleshooting/seed";
import { OutputVersionService, type OutputVersionRecord } from "@/modules/output-versioning/service";
import type { QaContext, QaFinding, QaValidator } from "./types";
import { buildPartialRevalidationPlan, type PartialRevalidationPlan } from "./validator-dependencies";
import { smokeRingValidator } from "./smoke-ring-validator";
import { blinkValidator } from "./blink-validator";
import { gazeValidator } from "./gaze-validator";
import { whiteHaloValidator } from "./white-halo-validator";
import { doublePupilValidator } from "./double-pupil-validator";
import { exactTextValidator } from "./exact-text-validator";

export type PostAssemblyRepairInput = {
  projectId: string;
  qaRunId: string;
  finding: QaFinding;
  incident: TroubleshootingIncident;
  match: MatchResult;
  matchedRule: TroubleshootingRule | null;
  currentOutputVersion: OutputVersionRecord;
  approvedManifest: QaContext["approvedManifest"];
  approvedSources: string[];
  expectedSceneStates: Record<number, unknown>;
  sceneMetadata: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  preserveRequirements: string[];
  generationStatus: string;
  outputReady: boolean;
  retryCount?: number;
};

export type PartialValidationResult = { validatorId: string; status: "PASS" | "FAIL" | "ERROR" | "NOT_EVALUATED"; required: boolean; findings: QaFinding[]; reason?: string };
export type PostAssemblyRepairResult = {
  status: "PROMOTED" | "REJECTED" | "NEEDS_REVIEW" | "MATCHED_BUT_NO_HANDLER" | "UNKNOWN_INCIDENT" | "AMBIGUOUS_INCIDENT" | "INSUFFICIENT_EVIDENCE" | "REPAIR_FAILED" | "RETRY_LIMIT_REACHED";
  qualityStatus: "APPROVED" | "REPAIRING" | "REPAIR_FAILED" | "NEEDS_REVIEW";
  repairAttemptId: string | null;
  incidentId: string;
  ruleId: string | null;
  repairScope: string | null;
  candidateVersionId: string | null;
  affectedScene: number | null;
  affectedRegion: string | null;
  validatorsToRecheck: string[];
  validationPlan: PartialRevalidationPlan | null;
  validationResults: PartialValidationResult[];
  warnings: string[];
  actionsTaken: string[];
  filesChanged: string[];
  preserveRequirements: string[];
  previousCurrentVersionId: string | null;
  promotedVersionId: string | null;
  rejectedCandidateId: string | null;
  generationStatus: string;
  outputReady: boolean;
  report?: QaIncidentReport;
  jsonReportPath?: string;
  markdownReportPath?: string;
  codexHandoffText?: string;
  userMessage?: string;
  reportWarning?: string;
};

type ReportExporter = (report: QaIncidentReport) => Promise<QaIncidentReportPaths>;

const supportedRepairStatuses = new Set(["REPAIRED", "RECOVERED_WITH_WARNING"]);

function baseResult(input: PostAssemblyRepairInput, overrides: Partial<PostAssemblyRepairResult> = {}): PostAssemblyRepairResult {
  return {
    status: "NEEDS_REVIEW",
    qualityStatus: "NEEDS_REVIEW",
    repairAttemptId: null,
    incidentId: input.incident.incidentId,
    ruleId: input.matchedRule?.issueId ?? input.match.matchedRuleId,
    repairScope: input.matchedRule?.repairScope ?? null,
    candidateVersionId: null,
    affectedScene: input.finding.sceneNumber,
    affectedRegion: input.finding.affectedRegion,
    validatorsToRecheck: [],
    validationPlan: null,
    validationResults: [],
    warnings: [],
    actionsTaken: [],
    filesChanged: [],
    preserveRequirements: input.preserveRequirements,
    previousCurrentVersionId: input.currentOutputVersion.id,
    promotedVersionId: null,
    rejectedCandidateId: null,
    generationStatus: input.generationStatus,
    outputReady: input.outputReady,
    ...overrides,
  };
}

export class PostAssemblyRepairCoordinator {
  constructor(private readonly outputVersions = new OutputVersionService(), private readonly handlers = new RepairHandlerRegistry(), private readonly validators: readonly QaValidator[] = [smokeRingValidator, blinkValidator, gazeValidator, whiteHaloValidator, doublePupilValidator, exactTextValidator], private readonly reportExporter: ReportExporter = async report => exportQaIncidentReport(report), private readonly verifyProductionProvenance = hasProductionRepairProvenance) {}

  private async audit(input: PostAssemblyRepairInput, event: string, metadata: Record<string, unknown> = {}, reason?: string) {
    await this.outputVersions.recordAudit({ projectId: input.projectId, outputVersionId: input.currentOutputVersion.id, event, reason, metadata: { incidentId: input.incident.incidentId, qaRunId: input.qaRunId, ...metadata } });
  }

  private async report(input: PostAssemblyRepairInput, disposition: QaIncidentDisposition, reason: string, result: PostAssemblyRepairResult) {
    const report = buildIncidentReport(input.incident, input.match, reason, {
      disposition,
      qaRunId: input.qaRunId,
      validatorId: input.finding.validatorId,
      validatorStatus: input.finding.status,
      severity: input.finding.severity,
      confidence: input.finding.confidence,
      globalTimestamp: input.finding.globalTimestamp,
      sceneLocalTimestamp: input.finding.sceneLocalTimestamp,
      finalVideoPath: input.currentOutputVersion.filePath,
      finalVideoHash: input.currentOutputVersion.fileHash,
      finalVideoVersion: String(input.currentOutputVersion.versionNumber),
      approvedManifest: input.approvedManifest,
      approvedSourceInformation: { approvedSources: input.approvedSources, sceneMetadata: input.sceneMetadata },
      retryCount: input.retryCount ?? input.incident.attemptCount,
      retryLimit: input.matchedRule?.retryPolicy.maxAttempts ?? null,
      generationStatus: input.generationStatus,
      outputReady: input.outputReady,
      qualityStatus: result.qualityStatus,
    });
    const output: PostAssemblyRepairResult = { ...result, report, codexHandoffText: buildCodexHandoffText(report), userMessage: buildQaIncidentUserMessage(report) };
    try {
      const paths = await this.reportExporter(report);
      return { ...output, ...paths };
    } catch (error) {
      return { ...output, reportWarning: `REPORT_EXPORT_FAILED: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  private async noRepair(input: PostAssemblyRepairInput, status: PostAssemblyRepairResult["status"], disposition: QaIncidentDisposition | null, reason: string) {
    const result = baseResult(input, { status, qualityStatus: status === "RETRY_LIMIT_REACHED" ? "REPAIR_FAILED" : "NEEDS_REVIEW", warnings: [reason] });
    await this.audit(input, "REPAIR_DECISION_RECORDED", { status, ruleId: result.ruleId, repairScope: result.repairScope }, reason);
    return disposition ? this.report(input, disposition, reason, result) : result;
  }

  private eligibility(input: PostAssemblyRepairInput, handler: PostAssemblyRepairHandler | undefined, registeredHandler: ReturnType<RepairHandlerRegistry["get"]>) {
    const rule = input.matchedRule;
    if (!rule || !input.match.matchedRuleId) {
      const disposition = dispositionForMatch(input.match);
      const status = disposition === "AMBIGUOUS_INCIDENT" || disposition === "INSUFFICIENT_EVIDENCE" || disposition === "UNKNOWN_INCIDENT" ? disposition : "UNKNOWN_INCIDENT";
      return { status, disposition, reason: `Matcher decision ${input.match.decision}; no repair is eligible.` };
    }
    if (input.match.decision === "AMBIGUOUS") return { status: "AMBIGUOUS_INCIDENT" as const, disposition: "AMBIGUOUS_INCIDENT" as const, reason: "Matcher returned AMBIGUOUS; no repair is eligible." };
    if (input.match.decision === "INSUFFICIENT_EVIDENCE") return { status: "INSUFFICIENT_EVIDENCE" as const, disposition: "INSUFFICIENT_EVIDENCE" as const, reason: "Required evidence is insufficient; no repair is eligible." };
    if (rule.verificationStatus !== "VERIFIED") return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Rule is not VERIFIED." };
    if (!rule.autoRepairAllowed) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Rule autoRepairAllowed is false." };
    if (!this.verifyProductionProvenance(rule)) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Production repair provenance is not confirmed." };
    if (!input.match.preconditionsPassed || input.match.confidence < rule.confidenceThreshold || input.match.contradictingEvidence.length) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Preconditions or confidence gate failed." };
    if (!handler && registeredHandler && "postAssembly" in registeredHandler) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Registered handler does not support Post-Assembly context." };
    if (!handler) return { status: "MATCHED_BUT_NO_HANDLER" as const, disposition: "MATCHED_BUT_NO_HANDLER" as const, reason: "Rule matched but no Post-Assembly handler is registered." };
    if (!handler.postAssembly.supportsPostAssembly) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Registered handler does not support Post-Assembly context." };
    if (handler.postAssembly.repairScope !== rule.repairScope) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: `Handler repairScope ${handler.postAssembly.repairScope} does not match rule ${rule.repairScope}.` };
    if (handler.postAssembly.mutatesOutputFile && !handler.postAssembly.requiresCandidate) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Output-mutating handler must require a candidate." };
    if (handler.postAssembly.supportedValidatorIds.length && !handler.postAssembly.supportedValidatorIds.includes(input.finding.validatorId)) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: `Handler does not support validator ${input.finding.validatorId}.` };
    if (input.match.confidence < rule.confidenceThreshold) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: `Match confidence ${input.match.confidence} is below threshold ${rule.confidenceThreshold}.` };
    if (!input.match.preconditionsPassed || input.match.contradictingEvidence.length) return { status: "NEEDS_REVIEW" as const, disposition: null, reason: "Matcher preconditions or contradicting evidence block auto repair." };
    const retryCount = input.retryCount ?? input.incident.previousRepairAttempts.filter(attempt => attempt.ruleId === rule.issueId).length;
    if (retryCount >= rule.retryPolicy.maxAttempts) return { status: "RETRY_LIMIT_REACHED" as const, disposition: "RETRY_LIMIT_REACHED" as const, reason: `Retry limit reached: ${retryCount}/${rule.retryPolicy.maxAttempts}.` };
    return { status: "ELIGIBLE" as const, disposition: null, reason: "All Post-Assembly repair eligibility gates passed." };
  }

  private async partialValidate(input: PostAssemblyRepairInput, handler: PostAssemblyRepairHandler, candidatePath: string | null, plan: PartialRevalidationPlan): Promise<PartialValidationResult[]> {
    const validationContext: QaContext = { projectId: input.projectId, finalVideoPath: candidatePath ?? input.currentOutputVersion.filePath, finalVideoVersion: candidatePath ? "CANDIDATE" : String(input.currentOutputVersion.versionNumber), approvedManifest: input.approvedManifest, expectedSceneStates: input.expectedSceneStates, approvedSources: input.approvedSources, checkpoint: { ...input.checkpoint, baselineFinalVideoPath: input.currentOutputVersion.filePath, smokeRingParameters: input.checkpoint.smokeRingParameters ?? input.incident.actualState, blinkParameters: input.checkpoint.blinkParameters ?? input.incident.actualState, gazeParameters: input.checkpoint.gazeParameters ?? input.incident.actualState, whiteHaloParameters: input.checkpoint.whiteHaloParameters ?? input.incident.actualState, doublePupilParameters: input.checkpoint.doublePupilParameters ?? input.incident.actualState, exactTextParameters: input.checkpoint.exactTextParameters ?? input.incident.actualState } };
    const validatorsById = new Map(this.validators.map(validator => [validator.id, validator]));
    const ids = [...new Set([...plan.validatorIds, ...handler.postAssembly.validationPlan.validatorIds ?? [], ...handler.postAssembly.validationPlan.preserveValidatorIds ?? []])];
    return Promise.all(ids.map(async validatorId => {
      const required = plan.requiredValidatorIds.includes(validatorId);
      const validator = validatorsById.get(validatorId);
      if (!validator) return { validatorId, status: "NOT_EVALUATED" as const, required, findings: [], reason: "Validator is not implemented or registered." };
      try {
        const findings = await validator.validate(validationContext, { sceneNumbers: plan.sceneNumbers ?? undefined, validatorIds: [validatorId] });
        if (!findings.length) return { validatorId, status: "NOT_EVALUATED" as const, required, findings, reason: "Validator returned no result." };
        if (findings.some(finding => finding.status === "ERROR")) return { validatorId, status: "ERROR" as const, required, findings, reason: "Validator returned ERROR." };
        if (findings.some(finding => finding.status === "FAIL")) return { validatorId, status: "FAIL" as const, required, findings, reason: "Validator returned FAIL." };
        if (findings.some(finding => finding.status === "NOT_EVALUATED")) return { validatorId, status: "NOT_EVALUATED" as const, required, findings, reason: "Validator returned NOT_EVALUATED." };
        return { validatorId, status: "PASS" as const, required, findings };
      } catch (error) {
        return { validatorId, status: "ERROR" as const, required, findings: [], reason: error instanceof Error ? error.message : String(error) };
      }
    }));
  }

  async repair(input: PostAssemblyRepairInput): Promise<PostAssemblyRepairResult> {
    const registeredHandler = input.matchedRule ? this.handlers.get(input.matchedRule.issueId) : undefined;
    const handler = input.matchedRule ? this.handlers.getPostAssembly(input.matchedRule.issueId) : undefined;
    const eligibility = this.eligibility(input, handler, registeredHandler);
    if (eligibility.status !== "ELIGIBLE") return this.noRepair(input, eligibility.status, eligibility.disposition, eligibility.reason);
    const rule = input.matchedRule!;
    const postAssembly = handler!.postAssembly;
    const repairAttemptId = randomUUID();
    await this.audit(input, "REPAIR_ATTEMPT_STARTED", { repairAttemptId, handlerId: postAssembly.handlerId ?? handler!.issueId, handlerVersion: postAssembly.handlerVersion ?? null, ruleId: rule.issueId, repairScope: postAssembly.repairScope });
    let candidate: Awaited<ReturnType<OutputVersionService["createCandidate"]>> | null = null;
    try {
      if (postAssembly.requiresCandidate || postAssembly.mutatesOutputFile) {
        candidate = await this.outputVersions.createCandidate({ projectId: input.projectId, sourcePath: input.currentOutputVersion.filePath, currentVersionId: input.currentOutputVersion.id, createdByRepairIncidentId: input.incident.incidentId, repairRuleId: rule.issueId });
      }
      await this.audit(input, "REPAIR_CANDIDATE_READY", { repairAttemptId, candidateVersionId: candidate?.id ?? null });
      const outcome = await handler!.handlePostAssembly({ incident: input.incident, rule, candidateVersionId: candidate?.id ?? null, candidatePath: candidate?.filePath ?? null, currentOutputPath: input.currentOutputVersion.filePath, repairAttemptId });
      const initial = baseResult(input, { status: "REPAIR_FAILED", qualityStatus: "REPAIR_FAILED", repairAttemptId, candidateVersionId: candidate?.id ?? null, actionsTaken: outcome.actionsTaken, filesChanged: outcome.filesChanged, warnings: outcome.warnings, affectedScene: outcome.affectedScene, affectedRegion: outcome.affectedRegion, validatorsToRecheck: outcome.validatorsToRecheck ?? [], preserveRequirements: [...input.preserveRequirements, ...(outcome.preserveRequirements ?? [])] });
      await this.audit(input, "REPAIR_EXECUTED", { repairAttemptId, candidateVersionId: candidate?.id ?? null, handlerStatus: outcome.status, actionsTaken: outcome.actionsTaken, filesChanged: outcome.filesChanged, handlerMetadata: outcome.auditMetadata ?? {} });
      const candidatePath = candidate?.filePath ? path.resolve(candidate.filePath) : null;
      const currentPath = path.resolve(input.currentOutputVersion.filePath);
      const writesOutsideCandidate = postAssembly.mutatesOutputFile && outcome.filesChanged.some(file => !candidatePath || path.resolve(file) !== candidatePath);
      const reviewRequired = outcome.status === "NEEDS_REVIEW" || outcome.status === "NEEDS_MANUAL_ACTION";
      if (!supportedRepairStatuses.has(outcome.status) || (postAssembly.mutatesOutputFile && (writesOutsideCandidate || outcome.filesChanged.some(file => path.resolve(file) === currentPath)))) {
        if (candidate) await this.outputVersions.rejectCandidate(candidate.id, `Repair did not produce a promotable candidate: ${outcome.status}.`);
        const failed = { ...initial, status: reviewRequired ? "NEEDS_REVIEW" as const : "REPAIR_FAILED" as const, qualityStatus: reviewRequired ? "NEEDS_REVIEW" as const : "REPAIR_FAILED" as const, rejectedCandidateId: candidate?.id ?? null, warnings: [...initial.warnings, reviewRequired ? "Repair requires review because required evidence or capability is missing." : "Repair did not produce a promotable result or attempted to mutate CURRENT output."] };
        await this.audit(input, "REPAIR_REJECTED", { repairAttemptId, rejectedCandidateId: candidate?.id ?? null }, failed.warnings.join(" "));
        return this.report(input, reviewRequired ? "INSUFFICIENT_EVIDENCE" : "REPAIR_FAILED", reviewRequired ? "Required evidence/capability is missing; candidate was not promoted." : "Repair did not produce a promotable result; candidate was rejected.", failed);
      }
      const handlerValidatorIds = postAssembly.validationPlan.validatorIds ?? [];
      const failingValidatorId = handlerValidatorIds.includes(input.finding.validatorId) ? input.finding.validatorId : handlerValidatorIds[0] ?? input.finding.validatorId;
      const validationPlan = buildPartialRevalidationPlan({ repairScope: postAssembly.repairScope, failingValidatorId, affectedScene: input.finding.sceneNumber, handlerPlan: postAssembly.validationPlan, supportedValidatorIds: postAssembly.supportedValidatorIds });
      const validationResults = await this.partialValidate(input, handler!, candidate?.filePath ?? null, validationPlan);
      const blocking = validationResults.some(result => result.status === "FAIL" || result.status === "ERROR" || (result.required && result.status === "NOT_EVALUATED"));
      await this.audit(input, "PARTIAL_REVALIDATION_COMPLETED", { repairAttemptId, candidateVersionId: candidate?.id ?? null, validatorsRechecked: validationResults.map(result => result.validatorId), validationResults });
      const result = { ...initial, status: blocking ? "REPAIR_FAILED" as const : "PROMOTED" as const, qualityStatus: blocking ? "REPAIR_FAILED" as const : "APPROVED" as const, candidateVersionId: candidate?.id ?? null, validationPlan, validatorsToRecheck: validationResults.map(result => result.validatorId), validationResults };
      if (blocking) {
        if (candidate) await this.outputVersions.markCandidateValidated(candidate.id, { status: "FAIL", reason: "Partial revalidation had a blocking result.", evidence: { validationResults } });
        if (candidate) await this.outputVersions.rejectCandidate(candidate.id, "Partial revalidation failed.");
        const rejected = { ...result, rejectedCandidateId: candidate?.id ?? null, warnings: [...result.warnings, "Candidate rejected because partial revalidation was not fully PASS."] };
        await this.audit(input, "REPAIR_REJECTED", { repairAttemptId, rejectedCandidateId: candidate?.id ?? null, validationResults }, "Partial revalidation failed.");
        return this.report(input, "REPAIR_FAILED", "Partial revalidation had a blocking FAIL, ERROR or required NOT_EVALUATED result.", rejected);
      }
      if (candidate) {
        await this.outputVersions.markCandidateValidated(candidate.id, { status: "PASS", evidence: { validationResults } });
        const promoted = await this.outputVersions.promoteCandidate(candidate.id);
        await this.audit(input, "REPAIR_PROMOTED", { repairAttemptId, candidateVersionId: candidate.id, previousCurrentVersionId: input.currentOutputVersion.id, promotedVersionId: promoted.id, validatorsRechecked: validationResults.map(item => item.validatorId), validationResults }, "Repair candidate passed partial revalidation.");
        return { ...result, promotedVersionId: promoted.id };
      }
      await this.audit(input, "REPAIR_COMPLETED_WITHOUT_CANDIDATE", { repairAttemptId, validatorsRechecked: validationResults.map(item => item.validatorId), validationResults });
      return result;
    } catch (error) {
      if (candidate) {
        try { await this.outputVersions.rejectCandidate(candidate.id, `Repair exception: ${error instanceof Error ? error.message : String(error)}`); } catch { /* preserve the original repair error */ }
      }
      const failed = baseResult(input, { status: "REPAIR_FAILED", qualityStatus: "REPAIR_FAILED", repairAttemptId, candidateVersionId: candidate?.id ?? null, rejectedCandidateId: candidate?.id ?? null, warnings: [error instanceof Error ? error.message : String(error)] });
      await this.audit(input, "REPAIR_FAILED", { repairAttemptId, candidateVersionId: candidate?.id ?? null, rejectedCandidateId: candidate?.id ?? null }, failed.warnings[0]);
      return this.report(input, "REPAIR_FAILED", `Post-Assembly repair threw or could not complete: ${failed.warnings[0]}`, failed);
    }
  }
}
