import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const electronMain = readFileSync(path.resolve(process.cwd(), "electron/main.cjs"), "utf8");

describe("Gemini browser modeling safety prompt", () => {
  it("injects the shared safety policy before Stage 1 and Stage 2 modeling prompts", () => {
    expect(electronMain).toContain('require("./modeling-safety-policy.cjs")');
    expect(electronMain).toContain("const prompt = `${MODELING_SAFETY_POLICY}\\nThe attached canonical main-character reference image");
    expect(electronMain).toContain("const prompt = `${MODELING_SAFETY_POLICY}\\nDevelop the approved modeling idea");
  });
});
