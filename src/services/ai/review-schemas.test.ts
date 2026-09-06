import { describe, expect, it } from "vitest";
import { finalReviewSchema } from "./review-schemas";

describe("Gemini final review schema", () => {
  it("accepts actionable issues without rewriting a package", () => expect(finalReviewSchema.parse({ schemaVersion: "1.0", overallSummary: "One continuity issue", issues: [{ id: "scene-1-camera", category: "continuity", severity: "medium", location: "scene 1 camera", issue: "Camera direction changes", suggestion: "Keep camera left-to-right", confidence: 0.92 }] })).toHaveProperty("issues"));
});
