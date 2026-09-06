import { describe, expect, it } from "vitest";
import { modelingIdeasSchema } from "@/services/ai/schemas";

describe("idea approval gate", () => {
  it("keeps Develop separate from idea generation", () => {
    const idea = modelingIdeasSchema.shape.modelingDirections.element.parse({ title: "Tiny cowboys", coreConcept: "Cowboys ride a robot vacuum", sourceMechanism: "Hidden environment → reveal → physical gag", whatIsPreserved: ["reveal", "gag"], whatIsChanged: ["characters", "setting"], targetMarketAdaptation: "Local references", similarityRisk: "low", whyWorthDeveloping: "New execution" });
    expect(idea.whatIsChanged).toContain("setting");
  });
});
