import { describe, expect, it } from "vitest";

import { normalizeCompetitorUrl } from "./url";

describe("competitor URL normalization", () => {
  it("detects and normalizes TikTok", () => expect(normalizeCompetitorUrl("https://tiktok.com/@Creator/")).toEqual({ platform: "TikTok", url: "https://www.tiktok.com/@creator", externalId: "creator", handle: "@creator" }));
  it("detects YouTube", () => expect(normalizeCompetitorUrl("https://www.youtube.com/@ScienceLab")).toMatchObject({ platform: "YouTube", url: "https://www.youtube.com/@sciencelab" }));
  it("detects and normalizes a Facebook Page", () => expect(normalizeCompetitorUrl("https://www.facebook.com/giftedartcartoon/")).toEqual({ platform: "Facebook", url: "https://www.facebook.com/giftedartcartoon", externalId: "giftedartcartoon", handle: "@giftedartcartoon" }));
  it("keeps Facebook profile IDs distinct", () => expect(normalizeCompetitorUrl("https://www.facebook.com/profile.php?id=61563718813970&mibextid=wwXIfr")).toEqual({ platform: "Facebook", url: "https://www.facebook.com/profile.php?id=61563718813970", externalId: "profile:61563718813970", handle: "@profile-61563718813970" }));
  it("rejects insecure URLs", () => expect(() => normalizeCompetitorUrl("http://tiktok.com/@creator")).toThrow("HTTPS"));
});
