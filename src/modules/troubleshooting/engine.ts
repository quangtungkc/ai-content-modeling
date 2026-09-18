import { randomUUID } from "node:crypto";
import { incidentSchema } from "./incident-schema";
import { enforceRepairScope, RepairHandlerRegistry, type RepairStatus, validateAfterRepair } from "./handlers";
import { TroubleshootingIncidentRepository } from "./incident-repository";
import { matchIncidentToKnowledgeBase, type MatchResult } from "./matcher";
import { buildIncidentReport, dispositionForMatch, incidentReportToMarkdown } from "./report";
import type { TroubleshootingRule } from "./schema";
import { hasProductionRepairProvenance } from "./seed";

export type RepairResult = { incidentId: string; ruleId: string | null; repairAttemptId: string | null; repairScope: string | null; startedAt: string; finishedAt: string; status: RepairStatus; actionsTaken: string[]; filesChanged: string[]; stateChanged: Record<string, unknown>; validationResults: Record<string, boolean>; warnings: string[]; nextAction: string; resumeFromStage: string | null; resumeCheckpoint: Record<string, unknown>; match: MatchResult; report?: ReturnType<typeof buildIncidentReport>; reportMarkdown?: string };

export class BoundedAutoRepairEngine {
  constructor(private readonly rules: readonly TroubleshootingRule[], private readonly handlers = new RepairHandlerRegistry(), private readonly incidents = new TroubleshootingIncidentRepository(), private readonly verifyProductionProvenance = hasProductionRepairProvenance) {}

  async process(input: unknown): Promise<RepairResult> {
    const incident = incidentSchema.parse(input);
    const startedAt = new Date().toISOString();
    const match = matchIncidentToKnowledgeBase(incident, this.rules);
    await this.incidents.record(incident, match.fingerprint.id, "CREATED");
    await this.incidents.audit(incident.incidentId, "INCIDENT_CREATED", { fingerprint: match.fingerprint });
    await this.incidents.audit(incident.incidentId, "CANDIDATES_EVALUATED", { candidates: match.candidates });
    const finish = async (status: RepairStatus, values: Partial<RepairResult> = {}) => {
      const finishedAt = new Date().toISOString();
      const reason = values.nextAction ?? match.decision;
      const reportDisposition = dispositionForMatch(match, status);
      const matchedRule = match.matchedRuleId ? this.rules.find((rule) => rule.issueId === match.matchedRuleId) : undefined;
      const report = reportDisposition ? buildIncidentReport(incident, match, reason, { disposition: reportDisposition, retryCount: incident.attemptCount, retryLimit: matchedRule?.retryPolicy.maxAttempts ?? null }) : undefined;
      const result: RepairResult = { incidentId: incident.incidentId, ruleId: values.ruleId ?? match.matchedRuleId, repairAttemptId: values.repairAttemptId ?? null, repairScope: values.repairScope ?? null, startedAt, finishedAt, status, actionsTaken: values.actionsTaken ?? [], filesChanged: values.filesChanged ?? [], stateChanged: values.stateChanged ?? {}, validationResults: values.validationResults ?? {}, warnings: values.warnings ?? [], nextAction: reason, resumeFromStage: values.resumeFromStage ?? null, resumeCheckpoint: values.resumeCheckpoint ?? incident.checkpoint, match, ...(report ? { report, reportMarkdown: incidentReportToMarkdown(report) } : {}) };
      await this.incidents.audit(incident.incidentId, "FINAL_RESULT", { status, ruleId: result.ruleId, reason, validationResults: result.validationResults });
      await this.incidents.record({ ...incident, attemptCount: incident.attemptCount + (values.repairAttemptId ? 1 : 0) }, match.fingerprint.id, status);
      return result;
    };
    if (!match.matchedRuleId) return finish("NEEDS_REVIEW", { nextAction: `Matcher decision: ${match.decision}. Create incident report; do not auto repair.` });
    const rule = this.rules.find((item) => item.issueId === match.matchedRuleId)!;
    await this.incidents.audit(incident.incidentId, "RULE_CHOSEN", { ruleId: rule.issueId, confidence: match.confidence, evidence: match.matchedEvidence });
    const handler = this.handlers.get(rule.issueId);
    if (!handler) return finish("MATCHED_BUT_NO_HANDLER", { ruleId: rule.issueId, repairScope: rule.repairScope, nextAction: "Rule matched but has no registered code handler." });
    if (handler.mode === "MANUAL") {
      const outcome = await handler.handle({ incident, rule });
      return finish(outcome.status, { ruleId: rule.issueId, repairScope: rule.repairScope, actionsTaken: outcome.actionsTaken, filesChanged: outcome.filesChanged, stateChanged: outcome.stateChanged, validationResults: outcome.validationSignals, warnings: outcome.warnings, nextAction: outcome.nextAction });
    }
    if (rule.verificationStatus !== "VERIFIED" || !rule.autoRepairAllowed || !this.verifyProductionProvenance(rule) || match.confidence < rule.confidenceThreshold || !match.preconditionsPassed || match.contradictingEvidence.length || !rule.validationAfterFix.length || !rule.preconditions.length) return finish("NEEDS_REVIEW", { ruleId: rule.issueId, repairScope: rule.repairScope, nextAction: "Production provenance, confidence or auto-repair policy did not permit repair." });
    const attemptsForRule = incident.previousRepairAttempts.filter((attempt) => attempt.ruleId === rule.issueId).length;
    if (attemptsForRule >= rule.retryPolicy.maxAttempts) return finish("STOPPED_RETRY_LIMIT", { ruleId: rule.issueId, repairScope: rule.repairScope, nextAction: "Retry limit reached; preserve checkpoint and escalate." });
    const repairAttemptId = randomUUID();
    await this.incidents.audit(incident.incidentId, "REPAIR_ATTEMPT_STARTED", { repairAttemptId, ruleId: rule.issueId, repairScope: rule.repairScope, attempt: attemptsForRule + 1 });
    const outcome = await handler.handle({ incident, rule });
    const scope = enforceRepairScope(rule, outcome);
    if (!scope.ok) return finish("REPAIR_FAILED", { ruleId: rule.issueId, repairAttemptId, repairScope: rule.repairScope, warnings: [scope.reason], nextAction: "Repair scope violation; do not resume." });
    const validation = validateAfterRepair(rule, outcome);
    await this.incidents.audit(incident.incidentId, "POST_REPAIR_VALIDATION", { ruleId: rule.issueId, passed: validation.passed, signals: outcome.validationSignals });
    if (!validation.passed) return finish("REPAIR_FAILED", { ruleId: rule.issueId, repairAttemptId, repairScope: rule.repairScope, actionsTaken: outcome.actionsTaken, filesChanged: outcome.filesChanged, stateChanged: outcome.stateChanged, validationResults: outcome.validationSignals, warnings: outcome.warnings, nextAction: "Post-repair validation failed; do not resume." });
    return finish(outcome.status, { ruleId: rule.issueId, repairAttemptId, repairScope: rule.repairScope, actionsTaken: outcome.actionsTaken, filesChanged: outcome.filesChanged, stateChanged: outcome.stateChanged, validationResults: outcome.validationSignals, warnings: outcome.warnings, nextAction: outcome.nextAction, resumeFromStage: incident.stage, resumeCheckpoint: incident.checkpoint });
  }
}
