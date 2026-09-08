import { describe, expect, it } from "vitest";
import { modelingIdeasSchema, videoAnalysisSchema } from "./schemas";
import { visualBreakdownSchema } from "./video-schemas";

describe("AI structured schemas", () => {
  it("accepts analysis JSON instead of markdown", () => expect(videoAnalysisSchema.parse({ schemaVersion: "1.0", summary: "summary", hook: "hook", setup: "setup", conflict: "conflict", escalation: "escalation", twist: "twist", payoff: "payoff", theGag: "gag", cameraPattern: "static", editingRhythm: "fast", characterInteractions: [], soundPattern: "silence", retentionMechanism: "reveal", whyItWorks: ["clear premise"] })).toHaveProperty("schemaVersion", "1.0"));
  it("requires exactly one modeling direction", () => expect(() => modelingIdeasSchema.parse({ schemaVersion: "1.0", modelingDirections: [] })).toThrow());
  it("requires timestamped observable events", () => expect(visualBreakdownSchema.parse({ schemaVersion: "1.0", videoSummary: "summary", openingHook: "hook", timeline: [{ timestamp: "00:05", event: "reveal", observableEvidence: "object appears" }], characters: [], setting: "room", visualGag: "gag", escalation: "escalation", twist: "twist", payoff: "payoff", cameraPattern: "static", audioPattern: "silence then impact", whyItLikelyWorks: ["clear premise"] })).toHaveProperty("timeline"));
});
