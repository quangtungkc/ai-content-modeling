import { describe, expect, it } from "vitest";
import { modelingIdeasSchema } from "@/services/ai/schemas";

describe("modeling ideas", () => {
  it("requires mechanism preservation and changed execution fields", () => expect(modelingIdeasSchema.parse({ schemaVersion: "1.0", modelingDirections: [{ title: "Tiny cowboys", coreConcept: "Cowboys ride a robot vacuum", script: "Mở đầu → phát hiện → cú gag", characterDesign: "Cao bồi tí hon vui nhộn", setting: "Phòng khách", artStyle: "Hoạt hình 3D", sourceMechanism: "Hidden environment → reveal → physical gag", whatIsPreserved: ["reveal timing", "physical gag"], whatIsChanged: ["characters", "setting", "execution"], targetMarketAdaptation: "Use local visual references", similarityRisk: "low", whyWorthDeveloping: "Clear new execution", postText: "Một chuyến cưỡi ngựa không ai ngờ tới!" }]})).toHaveProperty("modelingDirections"));
});
