import { describe, expect, it } from "vitest";
import { stripHashtagsFromPostText } from "./post-text";

describe("post text hashtag separation", () => {
  it("removes suggested hashtags but keeps the caption", () => {
    expect(stripHashtagsFromPostText("Goodnight... or not! 🕯️ 💗 Wait for it! #goodnight #chubbychaos #3DAnimation")).toBe("Goodnight... or not! 🕯️ 💗 Wait for it!");
  });

  it("handles hashtag-only lines and Vietnamese words", () => {
    expect(stripHashtagsFromPostText("Một cú twist bất ngờ.\n#hài #hoạthình")).toBe("Một cú twist bất ngờ.");
  });
});
