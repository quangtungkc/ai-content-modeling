import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { findFacebookVideoCard, verifiedFacebookPublishedAt } = require("./facebook-video-date.cjs") as {
  findFacebookVideoCard: (anchor: unknown) => unknown;
  verifiedFacebookPublishedAt: (container: unknown, nowMs: number) => string | null;
};
const now = Date.parse("2026-09-25T06:00:00.000Z");

function card(attributes: Record<string, string>, text = "", kind = "time") {
  return {
    querySelectorAll: () => [{ getAttribute: (name: string) => attributes[name] ?? null, textContent: text, matches: (selector: string) => selector.includes(kind) }],
    innerText: "This caption says 2h ago, but is not a publication timestamp.",
  };
}

describe("Facebook Page scan publication date", () => {
  it("finds the timestamp beside a caption link within its own video card", () => {
    const anchor = { parentElement: null, querySelector: () => null } as { parentElement: unknown; querySelector: () => null };
    const videoCard = {
      parentElement: null,
      querySelector: () => ({}),
      querySelectorAll: () => [
        { href: "https://www.facebook.com/reel/1413146514119749/" },
        { href: "https://www.facebook.com/123/videos/1413146514119749" },
      ],
    };
    anchor.parentElement = videoCard;
    expect(findFacebookVideoCard(anchor)).toBe(videoCard);
  });

  it("accepts verified timestamps within seven days", () => {
    expect(verifiedFacebookPublishedAt(card({ datetime: "2026-09-19T06:00:00.000Z" }), now)).toBe("2026-09-19T06:00:00.000Z");
    expect(verifiedFacebookPublishedAt(card({}, "6 ngày"), now)).toBe("2026-09-19T06:00:00.000Z");
  });

  it("rejects an old reel even if it is among the first links", () => {
    const exampleReel = "https://www.facebook.com/reel/1121765030409934";
    expect(exampleReel).toContain("/reel/");
    expect(verifiedFacebookPublishedAt(card({ "data-utime": String(Date.parse("2026-09-17T06:00:00.000Z") / 1000) }), now)).toBeNull();
    expect(verifiedFacebookPublishedAt(card({}, "7 ngày"), now)).toBeNull();
    expect(verifiedFacebookPublishedAt(card({ "aria-label": "3 tuần trước" }, "3 tuần"), now)).toBeNull();
  });

  it("rejects unknown or future dates rather than using caption text", () => {
    expect(verifiedFacebookPublishedAt({ querySelectorAll: () => [], innerText: "2h ago" }, now)).toBeNull();
    expect(verifiedFacebookPublishedAt(card({ datetime: "2026-09-26T06:00:00.000Z" }), now)).toBeNull();
  });
});
