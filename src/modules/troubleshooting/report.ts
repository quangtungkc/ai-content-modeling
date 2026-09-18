import { z } from "zod";
import type { TroubleshootingIncident } from "./incident-schema";
import type { MatchResult } from "./matcher";

export const QA_INCIDENT_REPORT_VERSION = "1.0.0";

export const QA_INCIDENT_DISPOSITIONS = [
  "UNKNOWN_INCIDENT",
  "AMBIGUOUS_INCIDENT",
  "INSUFFICIENT_EVIDENCE",
  "MATCHED_BUT_NO_HANDLER",
  "REPAIR_FAILED",
  "RETRY_LIMIT_REACHED",
] as const;

export type QaIncidentDisposition = typeof QA_INCIDENT_DISPOSITIONS[number];

const reportCandidateSchema = z.object({
  ruleId: z.string(),
  confidence: z.number().min(0).max(1),
  matchedEvidence: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  contradictingEvidence: z.array(z.string()),
  preconditionsPassed: z.boolean(),
});

const reportEvidenceSchema = z.object({
  kind: z.string(),
  source: z.string(),
  value: z.unknown(),
  observedAt: z.string().datetime().nullable(),
});

export const qaIncidentReportSchema = z.object({
  reportVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  incidentId: z.string().min(1),
  qaRunId: z.string().nullable(),
  projectId: z.string().nullable(),
  sceneNumber: z.number().int().positive().nullable(),
  globalTimestamp: z.number().finite().nullable(),
  sceneLocalTimestamp: z.number().finite().nullable(),
  validatorId: z.string().nullable(),
  validatorStatus: z.string().nullable(),
  severity: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(),
  symptom: z.string(),
  expected: z.unknown(),
  actual: z.unknown(),
  evidence: z.array(reportEvidenceSchema),
  suggestedFirstDivergence: z.string().nullable(),
  confirmedFirstDivergence: z.string().nullable(),
  affectedRegion: z.string().nullable(),
  affectedFile: z.string().nullable(),
  finalVideoPath: z.string().nullable(),
  finalVideoHash: z.string().nullable(),
  finalVideoVersion: z.string().nullable(),
  approvedManifest: z.unknown(),
  approvedSourceInformation: z.unknown(),
  matchedRuleId: z.string().nullable(),
  matchDecision: z.enum(["EXACT_MATCH", "HIGH_CONFIDENCE_MATCH", "INSUFFICIENT_EVIDENCE", "NO_MATCH", "AMBIGUOUS"]),
  matchConfidence: z.number().min(0).max(1),
  matchedEvidence: z.array(z.string()),
  missingEvidence: z.array(z.string()),
  contradictingEvidence: z.array(z.string()),
  candidateRules: z.array(reportCandidateSchema),
  previousRepairAttempts: z.array(z.object({ ruleId: z.string(), status: z.string(), at: z.string().datetime() })),
  retryCount: z.number().int().nonnegative(),
  retryLimit: z.number().int().nonnegative().nullable(),
  checkpoint: z.record(z.string(), z.unknown()),
  preserveRequirements: z.array(z.string()),
  generationStatus: z.string(),
  outputReady: z.boolean().nullable(),
  qualityStatus: z.string(),
  disposition: z.enum(QA_INCIDENT_DISPOSITIONS),
  whyAutoRepairNotPerformed: z.string(),
  createdAt: z.string().datetime(),
});

export type QaIncidentReport = z.infer<typeof qaIncidentReportSchema>;

export type IncidentReportContext = {
  disposition?: QaIncidentDisposition;
  qaRunId?: string | null;
  validatorId?: string | null;
  validatorStatus?: string | null;
  severity?: string | null;
  confidence?: number | null;
  globalTimestamp?: number | null;
  sceneLocalTimestamp?: number | null;
  finalVideoPath?: string | null;
  finalVideoHash?: string | null;
  finalVideoVersion?: string | null;
  approvedManifest?: unknown;
  approvedSourceInformation?: unknown;
  confirmedFirstDivergence?: string | null;
  retryCount?: number;
  retryLimit?: number | null;
  generationStatus?: string;
  outputReady?: boolean | null;
  qualityStatus?: string;
};

function safeJson(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack ?? null };
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[Circular]";
  if (depth >= 5) return "[Truncated depth]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 40).map((item) => safeJson(item, seen, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value).slice(0, 60)) result[key] = safeJson(item, seen, depth + 1);
  return result;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function dispositionForMatch(match: MatchResult, status?: string): QaIncidentDisposition | null {
  if (status === "REPAIR_FAILED") return "REPAIR_FAILED";
  if (status === "STOPPED_RETRY_LIMIT") return "RETRY_LIMIT_REACHED";
  if (status === "MATCHED_BUT_NO_HANDLER") return "MATCHED_BUT_NO_HANDLER";
  if (match.decision === "NO_MATCH") return "UNKNOWN_INCIDENT";
  if (match.decision === "AMBIGUOUS") return "AMBIGUOUS_INCIDENT";
  if (match.decision === "INSUFFICIENT_EVIDENCE") return "INSUFFICIENT_EVIDENCE";
  return status === "NEEDS_REVIEW" ? "INSUFFICIENT_EVIDENCE" : null;
}

export function buildIncidentReport(incident: TroubleshootingIncident, match: MatchResult, reason: string, context: IncidentReportContext = {}): QaIncidentReport {
  const actual = record(incident.actualState);
  const runtime = record(incident.runtimeState);
  const disposition = context.disposition ?? dispositionForMatch(match);
  if (!disposition) throw new Error("QA_INCIDENT_REPORT_NOT_REQUIRED");
  const missingEvidence = [...new Set([...match.missingEvidence, ...match.candidates.flatMap((candidate) => candidate.missingEvidence)])];
  const contradictingEvidence = [...new Set([...match.contradictingEvidence, ...match.candidates.flatMap((candidate) => candidate.contradictingEvidence)])];
  if (match.decision === "AMBIGUOUS" && !missingEvidence.length) missingEvidence.push("No discriminating evidence separates the candidate rules.");
  const report = {
    reportVersion: QA_INCIDENT_REPORT_VERSION,
    incidentId: incident.incidentId,
    qaRunId: context.qaRunId ?? stringValue(actual.qaRunId),
    projectId: incident.projectId,
    sceneNumber: incident.sceneNumber,
    globalTimestamp: context.globalTimestamp ?? numberValue(actual.globalTimestamp),
    sceneLocalTimestamp: context.sceneLocalTimestamp ?? numberValue(actual.sceneLocalTimestamp),
    validatorId: context.validatorId ?? stringValue(actual.validatorId) ?? stringValue(actual.component) ?? incident.component,
    validatorStatus: context.validatorStatus ?? stringValue(actual.validatorStatus) ?? stringValue(actual.status),
    severity: context.severity ?? stringValue(actual.severity),
    confidence: context.confidence ?? numberValue(actual.confidence),
    symptom: incident.symptoms[0] ?? incident.errorMessages[0] ?? "Unknown QA incident",
    expected: safeJson(incident.expectedState),
    actual: safeJson(incident.actualState),
    evidence: incident.evidence.map((item) => ({ kind: item.kind, source: item.source, value: safeJson(item.value), observedAt: item.observedAt ?? null })),
    suggestedFirstDivergence: incident.firstDivergence,
    confirmedFirstDivergence: context.confirmedFirstDivergence ?? stringValue(actual.confirmedFirstDivergence),
    affectedRegion: stringValue(actual.affectedRegion) ?? (typeof incident.evidence.find((item) => item.kind === "affected-region")?.value === "string" ? incident.evidence.find((item) => item.kind === "affected-region")?.value as string : null),
    affectedFile: incident.affectedFiles[0] ?? null,
    finalVideoPath: context.finalVideoPath ?? stringValue(actual.finalVideoPath),
    finalVideoHash: context.finalVideoHash ?? stringValue(actual.finalVideoHash),
    finalVideoVersion: context.finalVideoVersion ?? stringValue(actual.finalVideoVersion),
    approvedManifest: safeJson(context.approvedManifest ?? actual.approvedManifest) ?? null,
    approvedSourceInformation: safeJson(context.approvedSourceInformation ?? actual.approvedSourceInformation) ?? null,
    matchedRuleId: match.matchedRuleId,
    matchDecision: match.decision,
    matchConfidence: match.confidence,
    matchedEvidence: match.matchedEvidence,
    missingEvidence,
    contradictingEvidence,
    candidateRules: match.candidates.slice(0, 5).map((candidate) => ({ ...candidate })),
    previousRepairAttempts: incident.previousRepairAttempts,
    retryCount: context.retryCount ?? incident.attemptCount,
    retryLimit: context.retryLimit ?? null,
    checkpoint: record(safeJson(incident.checkpoint)),
    preserveRequirements: incident.preserveRequirements,
    generationStatus: context.generationStatus ?? stringValue(runtime.generationStatus) ?? "UNKNOWN",
    outputReady: context.outputReady ?? (typeof runtime.outputReady === "boolean" ? runtime.outputReady : null),
    qualityStatus: context.qualityStatus ?? stringValue(runtime.qualityStatus) ?? "UNKNOWN",
    disposition,
    whyAutoRepairNotPerformed: reason,
    createdAt: new Date().toISOString(),
  };
  return qaIncidentReportSchema.parse(report);
}

function compact(value: unknown, max = 4_000) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return text.length <= max ? text : `${text.slice(0, max)}\n[TRUNCATED]`;
}

export function incidentReportToMarkdown(report: QaIncidentReport) {
  return [
    "# Post-Assembly QA Incident Report",
    "",
    `- Report version: ${report.reportVersion}`,
    `- Disposition: ${report.disposition}`,
    `- Incident: ${report.incidentId}`,
    `- QA run: ${report.qaRunId ?? "UNKNOWN"}`,
    `- Project: ${report.projectId ?? "UNKNOWN"}`,
    `- Scene: ${report.sceneNumber ?? "UNKNOWN"}`,
    `- Global timestamp: ${report.globalTimestamp ?? "UNKNOWN"}`,
    `- Scene-local timestamp: ${report.sceneLocalTimestamp ?? "UNKNOWN"}`,
    `- Final video: ${report.finalVideoPath ?? "UNKNOWN"}`,
    `- Final video hash: ${report.finalVideoHash ?? "UNKNOWN"}`,
    `- Final video version: ${report.finalVideoVersion ?? "UNKNOWN"}`,
    "",
    "## Validator",
    `- ID: ${report.validatorId ?? "UNKNOWN"}`,
    `- Status: ${report.validatorStatus ?? "UNKNOWN"}`,
    `- Severity: ${report.severity ?? "UNKNOWN"}`,
    `- Confidence: ${report.confidence ?? "UNKNOWN"}`,
    "",
    "## Finding",
    `- Symptom: ${report.symptom}`,
    `- Suggested FIRST_DIVERGENCE: ${report.suggestedFirstDivergence ?? "UNKNOWN"}`,
    `- Confirmed FIRST_DIVERGENCE: ${report.confirmedFirstDivergence ?? "UNKNOWN"}`,
    `- Affected region: ${report.affectedRegion ?? "UNKNOWN"}`,
    `- Affected file: ${report.affectedFile ?? "UNKNOWN"}`,
    "",
    "### Expected",
    "```json",
    compact(report.expected),
    "```",
    "",
    "### Actual",
    "```json",
    compact(report.actual),
    "```",
    "",
    "### Evidence",
    ...(report.evidence.length ? report.evidence.map((item) => `- [${item.kind}] ${item.source}: ${compact(item.value, 1_000)}`) : ["- UNKNOWN"]),
    "",
    "## Matching result",
    `- Decision: ${report.matchDecision}`,
    `- Matched rule: ${report.matchedRuleId ?? "NONE"}`,
    `- Match confidence: ${report.matchConfidence}`,
    `- Matched evidence: ${report.matchedEvidence.join(", ") || "NONE"}`,
    `- Missing evidence: ${report.missingEvidence.join(", ") || "NONE"}`,
    `- Contradicting evidence: ${report.contradictingEvidence.join(", ") || "NONE"}`,
    "",
    "### Candidate rules",
    ...(report.candidateRules.length ? report.candidateRules.map((candidate) => `- ${candidate.ruleId}: confidence=${candidate.confidence}; missing=${candidate.missingEvidence.join(", ") || "none"}; contradicting=${candidate.contradictingEvidence.join(", ") || "none"}`) : ["- NONE"]),
    "",
    "## Why auto-repair was not performed",
    report.whyAutoRepairNotPerformed,
    "",
    "## Previous repair attempts",
    ...(report.previousRepairAttempts.length ? report.previousRepairAttempts.map((attempt) => `- ${attempt.ruleId}: ${attempt.status} at ${attempt.at}`) : ["- NONE"]),
    `- Retry count: ${report.retryCount}`,
    `- Retry limit: ${report.retryLimit ?? "UNKNOWN"}`,
    "",
    "## Approved state and runtime state",
    `- generationStatus: ${report.generationStatus}`,
    `- outputReady: ${report.outputReady ?? "UNKNOWN"}`,
    `- qualityStatus: ${report.qualityStatus}`,
    `- Approved manifest: ${compact(report.approvedManifest, 2_000)}`,
    `- Approved source information: ${compact(report.approvedSourceInformation, 2_000)}`,
    "",
    "## Checkpoint",
    "```json",
    compact(report.checkpoint, 4_000),
    "```",
    "",
    "## Preserve requirements",
    ...(report.preserveRequirements.length ? report.preserveRequirements.map((item) => `- ${item}`) : ["- PRESERVE APPROVED STATE."]),
    "",
  ].join("\n");
}
