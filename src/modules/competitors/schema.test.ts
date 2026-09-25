import { describe, expect, it } from "vitest";
import { competitorInputSchema } from "./schema";

describe("competitor discovery source", () => {
  it("defaults manually entered competitors to MANUAL", () => {
    expect(competitorInputSchema.parse({ url: "https://www.facebook.com/example" }).source).toBe("MANUAL");
  });

  it("preserves the following-page discovery source", () => {
    expect(competitorInputSchema.parse({ url: "https://www.facebook.com/example", source: "FOLLOWING_PAGE" }).source).toBe("FOLLOWING_PAGE");
  });
});
