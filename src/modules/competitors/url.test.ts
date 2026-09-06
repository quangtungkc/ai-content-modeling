import { describe, expect, it } from "vitest";
import { normalizeCompetitorUrl } from "./url";

describe("competitor URL normalization", () => {
  it("detects and normalizes TikTok", () => expect(normalizeCompetitorUrl("https://tiktok.com/@Creator/")).toEqual({ platform: "TikTok", url: "https://www.tiktok.com/@creator", externalId: "creator", handle: "@creator" }));
  it("detects YouTube", () => expect(normalizeCompetitorUrl("https://www.youtube.com/@ScienceLab")).toMatchObject({ platform: "YouTube", url: "https://www.youtube.com/@sciencelab" }));
  it("rejects unsupported or non-channel URLs", () => { expect(() => normalizeCompetitorUrl("https://facebook.com/page")).toThrow("chưa được hỗ trợ"); expect(() => normalizeCompetitorUrl("http://tiktok.com/@creator")).toThrow("HTTPS"); });
});
