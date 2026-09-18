import type { TroubleshootingIncident } from "./incident-schema";
import type { TroubleshootingRule } from "./schema";
import { createSmokeRingPostAssemblyHandler } from "@/modules/post-assembly-qa/smoke-ring-handler";
import { createBlinkPostAssemblyHandler } from "@/modules/post-assembly-qa/blink-handler";
import { createGazePostAssemblyHandler } from "@/modules/post-assembly-qa/gaze-handler";
import { createWhiteHaloPostAssemblyHandler } from "@/modules/post-assembly-qa/white-halo-handler";
import { createDoublePupilPostAssemblyHandler } from "@/modules/post-assembly-qa/double-pupil-handler";
import { createExactTextPostAssemblyHandler } from "@/modules/post-assembly-qa/exact-text-handler";

export type RepairStatus = "REPAIRED" | "RECOVERED_WITH_WARNING" | "REPAIR_FAILED" | "NEEDS_MANUAL_ACTION" | "NEEDS_REVIEW" | "STOPPED_RETRY_LIMIT" | "MATCHED_BUT_NO_HANDLER";
export type RepairAction = "fallbackDownload" | "validateLocalFile" | "setRecoveredWarning" | "classifyCreditState" | "manualHandoff";
export type HandlerOutcome = { status: RepairStatus; actionsTaken: RepairAction[]; filesChanged: string[]; stateChanged: Record<string, unknown>; validationSignals: Record<string, boolean>; warnings: string[]; nextAction: string };
export type RepairHandler = { issueId: string; mode: "AUTO" | "MANUAL"; handle(input: { incident: TroubleshootingIncident; rule: TroubleshootingRule }): Promise<HandlerOutcome> };
export type PostAssemblyValidationPlan = { validatorIds?: string[]; requiredValidatorIds?: string[]; preserveValidatorIds?: string[] };
export type PostAssemblyHandlerCapability = { handlerId?: string; handlerVersion?: string; supportsPostAssembly: boolean; repairScope: string; mutatesOutputFile: boolean; requiresCandidate: boolean; supportedValidatorIds: string[]; preserveRequirements: string[]; validationPlan: PostAssemblyValidationPlan };
export type PostAssemblyHandlerOutcome = { status: RepairStatus; actionsTaken: string[]; filesChanged: string[]; affectedScene: number | null; affectedRegion: string | null; warnings: string[]; validatorsToRecheck?: string[]; preserveRequirements?: string[]; auditMetadata?: Record<string, unknown> };
export type PostAssemblyRepairHandler = RepairHandler & { postAssembly: PostAssemblyHandlerCapability; handlePostAssembly(input: { incident: TroubleshootingIncident; rule: TroubleshootingRule; candidateVersionId: string | null; candidatePath: string | null; currentOutputPath: string; repairAttemptId: string }): Promise<PostAssemblyHandlerOutcome> };

const fallbackOutcome = (incident: TroubleshootingIncident): HandlerOutcome => {
  const fallbackOk = incident.runtimeState.fallbackDownloadSucceeded === true;
  const localValid = incident.runtimeState.localFileValidated === true;
  if (fallbackOk && localValid) return { status: "RECOVERED_WITH_WARNING", actionsTaken: ["fallbackDownload", "validateLocalFile", "setRecoveredWarning"], filesChanged: [], stateChanged: { recoveredWarning: true }, validationSignals: { fallbackDownloadSucceeded: true, localFileValidated: true }, warnings: ["Primary download failure retained as recovered warning."], nextAction: "Resume from existing checkpoint." };
  return { status: "REPAIR_FAILED", actionsTaken: [], filesChanged: [], stateChanged: {}, validationSignals: { fallbackDownloadSucceeded: fallbackOk, localFileValidated: localValid }, warnings: ["Fallback or local validation is not proven."], nextAction: "Needs manual download investigation." };
};

export const defaultRepairHandlers: RepairHandler[] = [
  { issueId: "ELECTRON_FLOW_FETCH_TIMEOUT_FALLBACK", mode: "AUTO", handle: async ({ incident }) => fallbackOutcome(incident) },
  { issueId: "FALLBACK_DOWNLOAD_ERROR_PROPAGATION", mode: "AUTO", handle: async ({ incident }) => fallbackOutcome(incident) },
  { issueId: "LOW_CREDIT_FALSE_BLOCK", mode: "AUTO", handle: async ({ incident }) => incident.runtimeState.creditBlock === true || incident.runtimeState.directCreditBlockEvidence === true
    ? { status: "REPAIR_FAILED", actionsTaken: [], filesChanged: [], stateChanged: {}, validationSignals: { noDirectCreditBlock: false }, warnings: ["Direct credit-block evidence exists."], nextAction: "Stop and request manual credit review." }
    : { status: "REPAIRED", actionsTaken: ["classifyCreditState"], filesChanged: [], stateChanged: { creditBlock: false }, validationSignals: { noDirectCreditBlock: true }, warnings: [], nextAction: "Continue normal diagnosis; low-credit warning alone is not a block." } },
  { issueId: "EXTERNAL_EXECUTION_POLICY_MANUAL_HANDOFF", mode: "MANUAL", handle: async () => ({ status: "NEEDS_MANUAL_ACTION", actionsTaken: ["manualHandoff"], filesChanged: [], stateChanged: {}, validationSignals: { policyRespected: true }, warnings: ["External execution policy must not be bypassed."], nextAction: "Create or use the existing manual handoff checkpoint." }) },
];

export class RepairHandlerRegistry {
  private readonly handlers = new Map<string, RepairHandler>();
  private readonly postAssemblyHandlers = new Map<string, PostAssemblyRepairHandler>();
  constructor(handlers: RepairHandler[] = defaultRepairHandlers, postAssemblyHandlers: PostAssemblyRepairHandler[] = [createSmokeRingPostAssemblyHandler(), createBlinkPostAssemblyHandler(), createGazePostAssemblyHandler(), createWhiteHaloPostAssemblyHandler(), createDoublePupilPostAssemblyHandler(), createExactTextPostAssemblyHandler()]) {
    postAssemblyHandlers.forEach((handler) => this.postAssemblyHandlers.set(handler.issueId, handler));
    handlers.forEach((handler) => {
      this.handlers.set(handler.issueId, handler);
      if ("postAssembly" in handler && "handlePostAssembly" in handler) this.postAssemblyHandlers.set(handler.issueId, handler as PostAssemblyRepairHandler);
    });
  }
  get(issueId: string) { return this.handlers.get(issueId); }
  getPostAssembly(issueId: string) {
    const handler = this.postAssemblyHandlers.get(issueId) ?? this.handlers.get(issueId);
    if (!handler || !("postAssembly" in handler) || !("handlePostAssembly" in handler)) return undefined;
    const postAssembly = (handler as PostAssemblyRepairHandler).postAssembly;
    return postAssembly.supportsPostAssembly ? handler as PostAssemblyRepairHandler : undefined;
  }
}

const allowedActions: Record<string, RepairAction[]> = {
  DOWNLOAD: ["fallbackDownload", "validateLocalFile", "setRecoveredWarning"],
  CHECKPOINT: ["setRecoveredWarning"],
  FLOW_RUNTIME: ["classifyCreditState", "manualHandoff"],
};

export function enforceRepairScope(rule: TroubleshootingRule, outcome: HandlerOutcome) {
  const allowed = allowedActions[rule.repairScope] ?? [];
  const forbidden = outcome.actionsTaken.filter((action) => !allowed.includes(action));
  if (forbidden.length || outcome.actionsTaken.some((action) => /regenerate|generate/i.test(action))) return { ok: false, reason: `REPAIR_SCOPE_VIOLATION:${forbidden.join(",") || "forbidden generate"}` };
  if (rule.repairScope === "DOWNLOAD" && outcome.filesChanged.length) return { ok: false, reason: "REPAIR_SCOPE_VIOLATION:DOWNLOAD_MUST_NOT_CHANGE_MEDIA" };
  return { ok: true as const };
}

export function validateAfterRepair(rule: TroubleshootingRule, outcome: HandlerOutcome) {
  if (outcome.status === "NEEDS_MANUAL_ACTION") return { passed: true, warning: false };
  if (rule.issueId === "LOW_CREDIT_FALSE_BLOCK") return { passed: outcome.validationSignals.noDirectCreditBlock === true, warning: false };
  if (["ELECTRON_FLOW_FETCH_TIMEOUT_FALLBACK", "FALLBACK_DOWNLOAD_ERROR_PROPAGATION"].includes(rule.issueId)) return { passed: outcome.validationSignals.fallbackDownloadSucceeded === true && outcome.validationSignals.localFileValidated === true, warning: true };
  return { passed: false, warning: false };
}
