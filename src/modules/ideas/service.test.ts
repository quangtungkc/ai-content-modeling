import { describe, expect, it } from "vitest";
import { modelingIdeasSchema } from "@/services/ai/schemas";

describe("modeling ideas", () => {
  it("requires mechanism preservation and changed execution fields", () => expect(modelingIdeasSchema.parse({ schemaVersion: "1.0", modelingDirections: [{ title: "Tiny cowboys", coreConcept: "Cowboys ride a robot vacuum", sourceMechanism: "Hidden environment → reveal → physical gag", whatIsPreserved: ["reveal timing", "physical gag"], whatIsChanged: ["characters", "setting", "execution"], targetMarketAdaptation: "Use local visual references", similarityRisk: "low", whyWorthDeveloping: "Clear new execution" }, { title: "Idea two", coreConcept: "New concept", sourceMechanism: "Reveal", whatIsPreserved: ["reveal"], whatIsChanged: ["setting"], targetMarketAdaptation: "Adapt", similarityRisk: "low", whyWorthDeveloping: "Worth testing" }, { title: "Idea three", coreConcept: "New concept", sourceMechanism: "Reveal", whatIsPreserved: ["reveal"], whatIsChanged: ["characters"], targetMarketAdaptation: "Adapt", similarityRisk: "medium", whyWorthDeveloping: "Worth testing" }]})).toHaveProperty("modelingDirections"));
});
