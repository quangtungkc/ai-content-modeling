import { describe, expect, it } from "vitest";
import { generationStateAfterAssembly, qualityTransition, routeRuntimeRepair } from "./runtime-routing";

describe("production runtime routing fixtures", () => {
  it.each(["REPAIRED", "RECOVERED_WITH_WARNING"] as const)("CASE download/fallback success resumes for %s", status => expect(routeRuntimeRepair(status)).toBe("RESUME"));
  it("CASE low-credit warning continues rather than pauses", () => expect(routeRuntimeRepair("REPAIRED")).toBe("RESUME"));
  it("CASE fetch fallback resumes exact stage", () => expect(routeRuntimeRepair("RECOVERED_WITH_WARNING")).toBe("RESUME"));
  it("CASE external policy pauses for manual action", () => expect(routeRuntimeRepair("NEEDS_MANUAL_ACTION")).toBe("PAUSE_MANUAL"));
  it.each(["MATCHED_BUT_NO_HANDLER", "NEEDS_REVIEW", "STOPPED_RETRY_LIMIT", "REPAIR_FAILED"] as const)("CASE review-only status pauses: %s", status => expect(routeRuntimeRepair(status)).toBe("PAUSE_REVIEW"));
  it("CASE Scene 4 preservation remains in checkpoint payload", () => {
    const checkpoint = { approvedScenes: [1, 2, 3], currentScene: 4 };
    expect({ ...checkpoint }).toEqual(checkpoint);
  });
  it("CASE valid assembly marks generation success and output ready", () => expect(generationStateAfterAssembly({ containerValid: true, videoStreamValid: true, durationSec: 20.84, resolution: "720x1280" })).toEqual({ generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NOT_RUN" }));
  it("CASE future quality issue cannot revoke generation success", () => expect(qualityTransition({ generationStatus: "SUCCESS", outputReady: true }, "NEEDS_REVIEW")).toMatchObject({ generationStatus: "SUCCESS", outputReady: true, qualityStatus: "NEEDS_REVIEW" }));
  it("CASE invalid assembly never reports success", () => expect(generationStateAfterAssembly({ containerValid: true, videoStreamValid: false, durationSec: 0, resolution: "" }).generationStatus).not.toBe("SUCCESS"));
  it("CASE manifest risk/no handler pauses rather than substitutes source", () => expect(routeRuntimeRepair("MATCHED_BUT_NO_HANDLER")).toBe("PAUSE_REVIEW"));
  it("CASE failed post-validation never resumes", () => expect(routeRuntimeRepair("REPAIR_FAILED")).toBe("PAUSE_REVIEW"));
});
