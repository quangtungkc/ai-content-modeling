import { describe, expect, it } from "vitest";
import { UnconfiguredAIProvider } from "./provider";

describe("AI provider abstraction", () => {
  it("fails clearly until a provider is configured", async () => {
    await expect(new UnconfiguredAIProvider().review({})).rejects.toMatchObject({ code: "AI_PROVIDER_NOT_CONFIGURED", status: 503 });
  });
});
