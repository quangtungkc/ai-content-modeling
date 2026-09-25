import { describe, expect, it } from "vitest";
import { MODELING_SAFETY_POLICY } from "./safety-policy";
import { developedIdeaSchema } from "@/services/ai/schemas";

describe("modeling safety policy", () => {
  it("is explicit about blocking minors in harmful scenarios before prompt writing", () => {
    expect(MODELING_SAFETY_POLICY).toContain("người chưa thành niên");
    expect(MODELING_SAFETY_POLICY).toContain("tình huống nguy hiểm");
    expect(MODELING_SAFETY_POLICY).toContain("không viết prompt sản xuất");
    expect(MODELING_SAFETY_POLICY).toContain("safetyStatus (PASS hoặc BLOCKED)");
  });

  it("requires a machine-readable safety decision in the developed package", () => {
    const packageWithoutSafetyDecision = {
      schemaVersion: "1.0",
      deconstruction: {},
      artDirection: {},
      characterDesign: {},
      backgroundDesign: {},
      storyboard: [{ sceneNumber: 1, visualBlock: "room", actionBlock: "wait", audioBlock: "silence", startFramePrompt: "still", englishPrompt: "animate" }],
      safetyReview: { description: "An toàn" },
    };
    expect(() => developedIdeaSchema.parse(packageWithoutSafetyDecision)).toThrow();
  });
});
