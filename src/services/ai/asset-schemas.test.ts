import { describe, expect, it } from "vitest";
import { assetValidationSchema } from "./asset-schemas";

describe("asset validation", () => {
  it("returns scores and actionable issues", () => expect(assetValidationSchema.parse({ schemaVersion: "1.0", result: "NEEDS_REVISION", scores: { characterMatch: 92, styleMatch: 96, composition: 85 }, issues: [{ code: "FULL_BODY_REQUIRED", severity: "high", message: "Both legs are cut off.", suggestion: "Upload a full-body reference." }] })).toMatchObject({ scores: { styleMatch: 96 } }));
});
