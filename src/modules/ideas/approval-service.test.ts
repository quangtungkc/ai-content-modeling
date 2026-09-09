import { describe, expect, it } from "vitest";
import { modelingIdeasSchema } from "@/services/ai/schemas";

describe("idea approval gate", () => {
  it("keeps Develop separate from idea generation", () => {
    const idea = modelingIdeasSchema.shape.modelingDirections.element.parse({ title: "Tiny cowboys", coreConcept: "Cowboys ride a robot vacuum", script: "Reveal", characterDesign: "Tiny cowboys", setting: "Living room", artStyle: "3D animation", sourceMechanism: "Hidden environment → reveal → physical gag", whatIsPreserved: ["reveal", "gag"], whatIsChanged: ["characters", "setting"], targetMarketAdaptation: "Local references", similarityRisk: "low", whyWorthDeveloping: "New execution", postText: "The tiniest ride in the wild west." });
    expect(idea.whatIsChanged).toContain("setting");
  });
});
