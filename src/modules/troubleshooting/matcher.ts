import type { TroubleshootingIncident } from "./incident-schema";
import { buildIncidentFingerprint, canonicalRuleStage, normalizedContains, type IncidentFingerprint } from "./fingerprint";
import type { TroubleshootingRule } from "./schema";

export type MatchDecision = "EXACT_MATCH" | "HIGH_CONFIDENCE_MATCH" | "INSUFFICIENT_EVIDENCE" | "NO_MATCH" | "AMBIGUOUS";
export type MatchCandidate = { ruleId: string; confidence: number; matchedEvidence: string[]; missingEvidence: string[]; contradictingEvidence: string[]; preconditionsPassed: boolean };
export type MatchResult = Omit<MatchCandidate, "ruleId"> & { ruleId?: string; matchedRuleId: string | null; decision: MatchDecision; candidates: MatchCandidate[]; fingerprint: IncidentFingerprint };

const bool = (incident: TroubleshootingIncident, key: string) => incident.runtimeState[key];
const messages = (incident: TroubleshootingIncident) => [...incident.errorMessages, ...incident.errorCodes, ...incident.symptoms].join(" | ");

function requiredConditions(rule: TroubleshootingRule, incident: TroubleshootingIncident) {
  const missing: string[] = [];
  const contradicting: string[] = [];
  const matched: string[] = [];
  const require = (key: string, expected: unknown, label: string) => {
    const actual = bool(incident, key);
    if (actual === undefined || actual === null) missing.push(label);
    else if (actual !== expected) contradicting.push(`${label}: expected ${String(expected)}, actual ${String(actual)}`);
    else matched.push(label);
  };
  if (!incident.evidence.length) missing.push("incident evidence");
  switch (rule.issueId) {
    case "FLOW_AUDIO_GENERATION_FAILED": require("httpStatus", 200, "HTTP 200"); require("jobCreated", true, "job created"); require("creditBlock", false, "credit block false"); break;
    case "LOW_CREDIT_FALSE_BLOCK":
      if (!/running low on credits/i.test(messages(incident))) missing.push("running low on credits message");
      if (bool(incident, "creditBlock") === true || bool(incident, "directCreditBlockEvidence") === true) contradicting.push("direct credit block evidence");
      else matched.push("no direct credit block evidence");
      break;
    case "COMPOSER_STATE_SESSION_LIFECYCLE": require("promptPresent", false, "prompt missing"); require("startFrameAttached", false, "start frame missing"); break;
    case "PRE_GENERATE_COMPOSER_NOT_READY": require("generateEnabled", false, "Generate disabled"); require("jobCreated", false, "job not created"); break;
    case "ELECTRON_FLOW_FETCH_TIMEOUT_FALLBACK": require("primaryDownloadFailed", true, "primary download failed"); break;
    case "FALLBACK_DOWNLOAD_ERROR_PROPAGATION": require("fallbackDownloadSucceeded", true, "fallback download succeeded"); require("localFileValidated", true, "local file validated"); break;
    case "DIRTY_BACKGROUND_REFERENCE_TEXT": require("backgroundReferenceHasText", true, "dirty background reference"); break;
    case "EXTERNAL_EXECUTION_POLICY_MANUAL_HANDOFF": require("externalPolicyBlocked", true, "external policy block"); break;
  }
  return { matched, missing, contradicting, passed: !missing.length && !contradicting.length };
}

function scoreRule(rule: TroubleshootingRule, incident: TroubleshootingIncident, fingerprint: IncidentFingerprint): MatchCandidate {
  const matchedEvidence: string[] = [];
  const missingEvidence: string[] = [];
  const contradictingEvidence: string[] = [];
  let score = 0;
  let hasDiscriminatingSignal = false;
  if (canonicalRuleStage(rule.stage) === fingerprint.stage) { score += 0.2; matchedEvidence.push(`stage:${fingerprint.stage}`); }
  else missingEvidence.push(`stage:${rule.stage}`);
  if (rule.firstDivergence && fingerprint.firstDivergence) {
    if (normalizedContains(fingerprint.firstDivergence, rule.firstDivergence) || normalizedContains(rule.firstDivergence, fingerprint.firstDivergence)) { score += 0.28; hasDiscriminatingSignal = true; matchedEvidence.push(`firstDivergence:${rule.firstDivergence}`); }
    else if (canonicalRuleStage(rule.stage) === fingerprint.stage) contradictingEvidence.push(`firstDivergence differs from ${rule.firstDivergence}`);
  } else if (rule.firstDivergence) missingEvidence.push(`firstDivergence:${rule.firstDivergence}`);
  const allSignals = [...fingerprint.errorSignatures, ...fingerprint.errorCodes, ...fingerprint.symptoms];
  const signature = rule.errorSignatures.find((expected) => allSignals.some((actual) => normalizedContains(actual, expected) || normalizedContains(expected, actual)));
  if (signature) { score += 0.28; hasDiscriminatingSignal = true; matchedEvidence.push(`signature:${signature}`); } else missingEvidence.push(`signature:${rule.errorSignatures[0]}`);
  const symptom = rule.symptoms.find((expected) => fingerprint.symptoms.some((actual) => normalizedContains(actual, expected) || normalizedContains(expected, actual)));
  if (symptom) { score += 0.12; hasDiscriminatingSignal = true; matchedEvidence.push(`symptom:${symptom}`); }
  if (rule.affectedComponents.some((component) => normalizedContains(fingerprint.component, component) || normalizedContains(component, fingerprint.component))) { score += 0.06; matchedEvidence.push(`component:${incident.component}`); }
  const conditions = requiredConditions(rule, incident);
  matchedEvidence.push(...conditions.matched); missingEvidence.push(...conditions.missing); contradictingEvidence.push(...conditions.contradicting);
  if (conditions.passed) score += 0.16;
  if (!hasDiscriminatingSignal) score = 0;
  if (contradictingEvidence.length) score = Math.max(0, score - 0.5);
  return { ruleId: rule.issueId, confidence: Number(Math.min(1, score).toFixed(2)), matchedEvidence, missingEvidence, contradictingEvidence, preconditionsPassed: conditions.passed };
}

export function matchIncidentToKnowledgeBase(incident: TroubleshootingIncident, rules: readonly TroubleshootingRule[]): MatchResult {
  const fingerprint = buildIncidentFingerprint(incident);
  const candidates = rules.filter((rule) => rule.verificationStatus === "VERIFIED").map((rule) => scoreRule(rule, incident, fingerprint)).sort((left, right) => right.confidence - left.confidence || left.ruleId.localeCompare(right.ruleId));
  const top = candidates[0];
  const empty = { matchedRuleId: null, confidence: 0, matchedEvidence: [], missingEvidence: ["No verified candidate"], contradictingEvidence: [], preconditionsPassed: false, decision: "NO_MATCH" as const, candidates, fingerprint };
  if (!top || top.confidence === 0) return empty;
  const second = candidates[1];
  if (second && top.confidence >= 0.55 && second.confidence >= 0.55 && top.confidence - second.confidence < 0.08) return { ...top, matchedRuleId: null, decision: "AMBIGUOUS", candidates, fingerprint };
  const rule = rules.find((item) => item.issueId === top.ruleId)!;
  if (!top.preconditionsPassed || top.contradictingEvidence.length || top.confidence < rule.confidenceThreshold) return { ...top, matchedRuleId: null, decision: "INSUFFICIENT_EVIDENCE", candidates, fingerprint };
  return { ...top, matchedRuleId: top.ruleId, decision: top.confidence >= 0.95 ? "EXACT_MATCH" : "HIGH_CONFIDENCE_MATCH", candidates, fingerprint };
}
