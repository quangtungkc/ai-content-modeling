import { describe, expect, it } from "vitest";
import { assertFinalDuration, expectedAssembledDuration, resolveSceneAssemblyDuration } from "@/modules/generation/assembly-duration";

describe("Stage 5 assembly duration contract", () => {
  it("trims a provider clip to the storyboard target duration", () => {
    expect(resolveSceneAssemblyDuration({ sourceDuration: 8.8, trimStart: 0, trimEnd: 0, targetDuration: 3 })).toBe(3);
  });

  it("preserves backwards-compatible full duration when no target exists", () => {
    expect(resolveSceneAssemblyDuration({ sourceDuration: 8.8, trimStart: 0.5, trimEnd: 0.3 })).toBeCloseTo(8);
  });

  it("rejects a source clip shorter than the approved storyboard target", () => {
    expect(() => resolveSceneAssemblyDuration({ sourceDuration: 2.8, trimStart: 0, trimEnd: 0, targetDuration: 3 })).toThrow("FINAL_SCENE_DURATION_UNDERFLOW");
  });

  it("accounts for fade overlap in the final duration", () => {
    expect(expectedAssembledDuration({ durations: [3, 2.5, 3, 3, 2.7], transition: "fade", transitionDuration: 0.3 })).toBeCloseTo(13);
  });

  it("rejects a final file whose duration does not match the contract", () => {
    expect(() => assertFinalDuration(43.87, 14.2)).toThrow("FINAL_MEDIA_DURATION_MISMATCH");
    expect(assertFinalDuration(14.12, 14.2)).toBe(14.12);
  });
});
