import type { RepairStatus } from "./handlers";

export type RuntimeDisposition = "RESUME" | "PAUSE_MANUAL" | "PAUSE_REVIEW";
export function routeRuntimeRepair(status: RepairStatus): RuntimeDisposition {
  if (status === "REPAIRED" || status === "RECOVERED_WITH_WARNING") return "RESUME";
  if (status === "NEEDS_MANUAL_ACTION") return "PAUSE_MANUAL";
  return "PAUSE_REVIEW";
}

export function generationStateAfterAssembly(input: { containerValid: boolean; videoStreamValid: boolean; durationSec: number; resolution?: string }) {
  const valid = input.containerValid && input.videoStreamValid && input.durationSec > 0.1 && Boolean(input.resolution);
  return valid
    ? { generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NOT_RUN" }
    : { generationStatus: "FAILED", outputReady: false, qualityStatus: "NOT_RUN" };
}

export function qualityTransition(state: { generationStatus: string; outputReady: boolean }, qualityStatus: "CHECKING" | "APPROVED" | "REPAIRING" | "NEEDS_REVIEW") {
  return { ...state, qualityStatus, generationStatus: state.generationStatus, outputReady: state.outputReady };
}
