// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validateFinalVideoProbe } = require("./final-video-validation.cjs") as { validateFinalVideoProbe: (output: string) => { durationSec: number; width: number; height: number } };
import { describe, expect, it } from "vitest";

const valid = `Duration: 00:00:11.43, start: 0.000000, bitrate: 4281 kb/s\nStream #0:0: Video: h264 (Constrained Baseline), yuv420p, 720x1280, 30 fps\nStream #0:1: Audio: aac (LC), 48000 Hz, stereo`;

describe("final video validation before cleanup", () => {
  it("accepts the observed 9:16 H.264/AAC output", () => {
    expect(validateFinalVideoProbe(valid)).toMatchObject({ durationSec: 11.43, width: 720, height: 1280 });
  });
  it.each([
    valid.replace("720x1280", "1280x720"),
    valid.replace("Video: h264", "Video: vp9"),
    valid.replace("Audio: aac", "Audio: opus"),
    valid.replace("00:00:11.43", "00:00:00.00"),
    "Invalid data found when processing input",
  ])("rejects invalid media before deleting scene sources", (probe) => {
    expect(() => validateFinalVideoProbe(probe)).toThrow("FINAL_MEDIA_VALIDATION_FAILED");
  });
});
