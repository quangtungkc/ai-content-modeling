import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { developedIdeaSchema, normalizeDevelopedIdeaResponse } from "../src/services/ai/schemas";

const require = createRequire(import.meta.url);
const { validateContentProjectResponse } = require("./content-project-response.cjs") as {
  validateContentProjectResponse(value: unknown): string | null;
};

function response(review: Record<string, unknown>) {
  return {
    schemaVersion: "1.0",
    deconstruction: {}, artDirection: {}, characterDesign: {}, backgroundDesign: {},
    sourceModelingSpec: { scenes: [] },
    storyboard: [{ sceneNumber: 1, visualBlock: "Cảnh", actionBlock: "Hành động", audioBlock: "Âm thanh", startFramePrompt: "Still frame", englishPrompt: "Video prompt" }],
    safetyReview: review,
  };
}

describe("Content Project Gemini response contract", () => {
  it("catches the actual missing-description/string-reasons response before browser success", () => {
    const raw = response({ safetyStatus: "PASS", blockedReasons: "", safeAlternative: "" });
    expect(validateContentProjectResponse(raw)).toContain("safetyReview.description");
    expect(developedIdeaSchema.safeParse(raw).success).toBe(false);
    const normalized = normalizeDevelopedIdeaResponse(raw);
    expect(developedIdeaSchema.safeParse(normalized).success).toBe(true);
    expect((normalized as typeof raw).safetyReview.blockedReasons).toEqual([]);
  });

  it("accepts a complete response through both browser and server checks", () => {
    const valid = response({ description: "Đã kiểm tra", safetyStatus: "PASS", blockedReasons: [], safeAlternative: "" });
    expect(validateContentProjectResponse(valid)).toBeNull();
    expect(developedIdeaSchema.safeParse(normalizeDevelopedIdeaResponse(valid)).success).toBe(true);
  });

  it("preserves a blocked decision and its reason", () => {
    const raw = response({ safetyStatus: "BLOCKED", blockedReasons: "Nguy cơ gây hại", safeAlternative: "Chờ người dùng sửa" });
    const normalized = developedIdeaSchema.parse(normalizeDevelopedIdeaResponse(raw));
    expect(normalized.safetyReview.safetyStatus).toBe("BLOCKED");
    expect(normalized.safetyReview.blockedReasons).toEqual(["Nguy cơ gây hại"]);
    expect(validateContentProjectResponse(raw)).toContain("safetyReview.description");
  });

  it("rejects malformed scene fields instead of reporting browser success", () => {
    const invalid = response({ description: "Đã kiểm tra", safetyStatus: "PASS", blockedReasons: [], safeAlternative: "" });
    invalid.storyboard[0].englishPrompt = 5 as unknown as string;
    expect(validateContentProjectResponse(invalid)).toContain("storyboard[0].englishPrompt");
  });
});
