import { createHash } from "node:crypto";
import type { TroubleshootingIncident } from "./incident-schema";

const normalize = (value: string) => value.toLowerCase().replace(/https?:\/\/\S+/g, "<url>").replace(/[a-f0-9]{16,}/g, "<id>").replace(/\d+/g, "#").replace(/_/g, " ").replace(/[^a-z0-9#]+/g, " ").trim();
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export type IncidentFingerprint = {
  id: string;
  stage: string;
  component: string;
  firstDivergence: string | null;
  errorSignatures: string[];
  errorCodes: string[];
  symptoms: string[];
  runtimeSignals: Record<string, string | boolean | number>;
};

export function canonicalRuleStage(stage: string) {
  const normalized = stage.toUpperCase();
  if (normalized === "FLOW_GENERATION") return "SCENES";
  if (normalized === "PRE_GENERATE") return "COMPOSER";
  if (normalized === "IPC_BRIDGE") return "FLOW_RUNTIME";
  return normalized;
}

export function buildIncidentFingerprint(incident: TroubleshootingIncident): IncidentFingerprint {
  const runtimeSignals: Record<string, string | boolean | number> = {};
  for (const key of ["httpStatus", "jobCreated", "creditBlock", "promptPresent", "startFrameAttached", "generateEnabled", "primaryDownloadFailed", "fallbackDownloadSucceeded", "localFileValidated", "backgroundReferenceHasText", "validatorResult"]) {
    const value = incident.runtimeState[key];
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") runtimeSignals[key] = value;
  }
  const payload = {
    stage: canonicalRuleStage(incident.stage), component: normalize(incident.component), firstDivergence: incident.firstDivergence ? normalize(incident.firstDivergence) : null,
    errorSignatures: incident.errorMessages.map(normalize).filter(Boolean).sort(), errorCodes: incident.errorCodes.map(normalize).filter(Boolean).sort(),
    symptoms: incident.symptoms.map(normalize).filter(Boolean).sort(), runtimeSignals,
    validatorCodes: strings(incident.actualState?.validatorCodes).map(normalize).sort(),
  };
  return { id: createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24), ...payload };
}

export const normalizedContains = (haystack: string, needle: string) => normalize(haystack).includes(normalize(needle));
