import { describe, expect, it } from "vitest";
import { getCompetitorProvider, TikTokProvider } from "./index";

describe("competitor platform providers", () => {
  it("resolves TikTok through the provider registry", async () => {
    const provider = getCompetitorProvider("https://tiktok.com/@creator");
    expect(provider).toBeInstanceOf(TikTokProvider);
    await expect(provider.resolveChannel("https://tiktok.com/@creator")).resolves.toMatchObject({ handle: "@creator", platform: "tiktok" });
  });

  it("rejects unsupported platforms at the registry boundary", () => {
    expect(() => getCompetitorProvider("https://youtube.com/@creator")).toThrow("chưa được hỗ trợ");
  });

  it("does not pretend to fetch data without TikTok access", async () => {
    const provider = new TikTokProvider();
    const channel = await provider.resolveChannel("https://tiktok.com/@creator");
    await expect(provider.getRecentVideos(channel)).rejects.toMatchObject({ code: "PLATFORM_PROVIDER_NOT_CONFIGURED" });
  });
});
