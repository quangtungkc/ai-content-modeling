import { describe, expect, it } from "vitest";
import { channelInputSchema } from "./schema";

const baseChannel = {
  name: "Demo Channel",
  platform: "Facebook",
  topic: "Animation",
  targetCountry: "Vietnam",
  language: "vi",
  audience: "General",
  contentStyle: "Short video",
  visualStyle: "3D",
  timezone: "Asia/Ho_Chi_Minh",
};

describe("Facebook Page channel binding", () => {
  it("accepts a Facebook Page URL", () => {
    expect(channelInputSchema.parse({ ...baseChannel, facebookPageUrl: "https://www.facebook.com/chubbychaos" }).facebookPageUrl).toBe("https://www.facebook.com/chubbychaos");
  });

  it("rejects non-Page Facebook URLs", () => {
    expect(() => channelInputSchema.parse({ ...baseChannel, facebookPageUrl: "https://www.facebook.com/reel/123" })).toThrow();
    expect(() => channelInputSchema.parse({ ...baseChannel, facebookPageUrl: "http://example.com/page" })).toThrow();
  });
});
