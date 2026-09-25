import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { selectFacebookSourceVideo } = require("./facebook-source-selection.cjs") as {
  selectFacebookSourceVideo: (items: Array<Record<string, unknown>>, currentUrl: string, expectedUrl: string) => { index: number | null; error: string | null };
};
const target = "https://www.facebook.com/reel/2330591501077995/";
const item = (index: number, y: number, durationSec: number, ready = true, boundToReel = true) => ({ index, connected: true, visible: true, boundToReel, ready, durationSec, rect: { x: 172, y, width: 467, height: 831 }, viewportWidth: 1360, viewportHeight: 925 });

describe("Facebook source video selection", () => {
  it("selects the target reel in the viewport, never the next preloaded reel or closest-duration reel", () => {
    expect(selectFacebookSourceVideo([item(0, 72, 10.4), item(1, 935, 6.8)], target, target)).toMatchObject({ index: 0, error: null });
  });
  it("waits for the target instead of capturing the ready next reel", () => {
    expect(selectFacebookSourceVideo([item(0, 72, 10.4, false), item(1, 935, 6.8)], target, target)).toMatchObject({ index: null, error: "SOURCE_VIDEO_TARGET_NOT_READY" });
  });
  it("fails closed on mismatched pages and multiple centered videos", () => {
    expect(selectFacebookSourceVideo([item(0, 72, 10.4)], "https://www.facebook.com/reel/999/", target).error).toBe("SOURCE_VIDEO_PAGE_MISMATCH");
    expect(selectFacebookSourceVideo([item(0, 72, 10.4), item(1, 95, 6.8)], target, target).error).toBe("SOURCE_VIDEO_VISIBLE_AMBIGUOUS");
  });
  it("never captures a centered video that is not in the requested reel's own DOM subtree", () => {
    expect(selectFacebookSourceVideo([item(0, 72, 6.8, true, false)], target, target).error).toBe("SOURCE_VIDEO_TARGET_NOT_VISIBLE");
  });
});
