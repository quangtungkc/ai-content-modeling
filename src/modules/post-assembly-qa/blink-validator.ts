import { spawn } from "node:child_process";
import type { QaContext, QaFinding, QaValidator } from "./types";
import { findSmokeRingFfmpegPath, probeSmokeRingVideo } from "./smoke-ring-handler";
import { parseBlinkParametersFromState, type BlinkParameters, type BlinkVideoMetadata } from "./blink-handler";

type PixelRegion = { x: number; y: number; width: number; height: number };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function regionPixels(region: BlinkParameters["leftEyeRegion"], metadata: BlinkVideoMetadata): PixelRegion {
  return region.space === "NORMALIZED"
    ? { x: region.x * metadata.width, y: region.y * metadata.height, width: region.width * metadata.width, height: region.height * metadata.height }
    : region;
}

function readFrame(ffmpegPath: string, filePath: string, time: number, metadata: BlinkVideoMetadata) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, time).toFixed(3), "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", code => {
      const frame = Buffer.concat(chunks);
      const expectedBytes = metadata.width * metadata.height * 4;
      if (code !== 0 || frame.length < expectedBytes) reject(new Error(`BLINK_VALIDATOR_FRAME_READ_FAILED:${stderr.slice(-500)}`));
      else resolve(frame.subarray(0, expectedBytes));
    });
  });
}

function inRegion(x: number, y: number, region: PixelRegion) {
  return x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height;
}

function compareFrames(before: Buffer, after: Buffer, metadata: BlinkVideoMetadata, regions: PixelRegion[]) {
  let insideChanged = 0;
  let insideTotal = 0;
  let outsideChanged = 0;
  let outsideTotal = 0;
  const threshold = 30;
  for (let index = 0; index < metadata.width * metadata.height; index += 1) {
    const x = index % metadata.width;
    const y = Math.floor(index / metadata.width);
    const offset = index * 4;
    const changed = Math.max(Math.abs(before[offset] - after[offset]), Math.abs(before[offset + 1] - after[offset + 1]), Math.abs(before[offset + 2] - after[offset + 2])) > threshold;
    if (regions.some(region => inRegion(x, y, region))) {
      insideTotal += 1;
      if (changed) insideChanged += 1;
    } else {
      outsideTotal += 1;
      if (changed) outsideChanged += 1;
    }
  }
  return { insideRatio: insideTotal ? insideChanged / insideTotal : 1, outsideRatio: outsideTotal ? outsideChanged / outsideTotal : 1 };
}

function finding(status: QaFinding["status"], parameters: BlinkParameters | null, actual: Record<string, unknown>, evidence: unknown[] = []): QaFinding {
  return {
    validatorId: "blink",
    status,
    sceneNumber: parameters?.sceneNumber ?? null,
    globalTimestamp: parameters ? parameters.sceneStart + parameters.blinkStartLocalTime : null,
    sceneLocalTimestamp: parameters?.blinkStartLocalTime ?? null,
    expected: parameters ? { openBefore: true, closeBetween: [parameters.blinkCloseTime, parameters.blinkReopenTime], reopenAfter: true } : null,
    actual,
    evidence,
    confidence: status === "NOT_EVALUATED" ? 0 : 1,
    severity: "HIGH",
    suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT",
    affectedRegion: "eyes",
    affectedFile: null,
    symptom: status === "PASS" ? undefined : "BLINK_VALIDATION_FAILED",
  };
}

function parseState(context: QaContext) {
  const state = record(context.checkpoint.blinkParameters);
  const input = typeof context.checkpoint.baselineFinalVideoPath === "string" ? context.checkpoint.baselineFinalVideoPath : null;
  if (!input || !Object.keys(state).length) return { error: "MISSING_BLINK_VALIDATION_CONTEXT" } as const;
  return parseBlinkParametersFromState(state, typeof state.sceneNumber === "number" ? state.sceneNumber : null, input, context.finalVideoPath);
}

function sampleTimes(parameters: BlinkParameters, duration: number) {
  const local = {
    before: Math.max(0, parameters.blinkStartLocalTime - Math.min(0.1, Math.max(0.01, (parameters.blinkCloseTime - parameters.blinkStartLocalTime) / 2))),
    closing: (parameters.blinkStartLocalTime + parameters.blinkCloseTime) / 2,
    closed: (parameters.blinkCloseTime + parameters.blinkReopenTime) / 2,
    reopening: (parameters.blinkReopenTime + parameters.blinkEndLocalTime) / 2,
    after: Math.min(parameters.blinkEndLocalTime + Math.min(0.2, Math.max(0.02, (parameters.blinkEndLocalTime - parameters.blinkReopenTime) / 2)), parameters.sceneEnd - parameters.sceneStart - 0.01),
  };
  return Object.fromEntries(Object.entries(local).map(([key, value]) => [key, Math.max(0, Math.min(duration - 0.01, parameters.sceneStart + value))])) as Record<keyof typeof local, number>;
}

export class BlinkValidator implements QaValidator {
  readonly id = "blink";

  async validate(context: QaContext): Promise<QaFinding[]> {
    const parsed = parseState(context);
    if ("error" in parsed) return [finding("NOT_EVALUATED", null, { reason: parsed.error })];
    try {
      const ffmpegPath = await findSmokeRingFfmpegPath();
      if (!ffmpegPath) return [finding("NOT_EVALUATED", parsed.value, { reason: "BLINK_VALIDATOR_FFMPEG_NOT_FOUND" })];
      const metadata = await probeSmokeRingVideo(ffmpegPath, context.finalVideoPath);
      const baselinePath = context.checkpoint.baselineFinalVideoPath as string;
      const regions = [regionPixels(parsed.value.leftEyeRegion, metadata), regionPixels(parsed.value.rightEyeRegion, metadata)];
      const times = sampleTimes(parsed.value, metadata.duration);
      const openReference = await readFrame(ffmpegPath, baselinePath, times.before, metadata);
      const compared = await Promise.all(Object.entries(times).map(async ([name, time]) => {
        const baseline = name === "after" ? openReference : await readFrame(ffmpegPath, baselinePath, time, metadata);
        const candidate = await readFrame(ffmpegPath, context.finalVideoPath, time, metadata);
        return [name, compareFrames(baseline, candidate, metadata, regions)] as const;
      }));
      const stats = Object.fromEntries(compared) as Record<keyof typeof times, ReturnType<typeof compareFrames>>;
      const openThreshold = 0.12;
      const closeThreshold = 0.08;
      const outsideThreshold = 0.015;
      const actual = {
        EYES_OPEN_BEFORE_BLINK: stats.before.insideRatio <= openThreshold,
        EYES_CLOSE_DURING_BLINK: Math.max(stats.closed.insideRatio, stats.closing.insideRatio) >= closeThreshold,
        EYES_REOPEN_FULLY: stats.after.insideRatio <= openThreshold,
        BLINK_COMPLETES_WITHIN_WINDOW: times.after >= parsed.value.sceneStart + parsed.value.blinkEndLocalTime,
        BLINK_NATURAL: stats.closing.insideRatio > closeThreshold && stats.reopening.insideRatio <= stats.closing.insideRatio && stats.after.insideRatio <= openThreshold,
        EYE_REGION_NO_MAJOR_ARTIFACT: stats.closed.outsideRatio <= outsideThreshold && stats.reopening.outsideRatio <= outsideThreshold,
        GAZE_NOT_UNINTENTIONALLY_CHANGED: stats.before.outsideRatio <= outsideThreshold && stats.after.outsideRatio <= outsideThreshold,
        SMOKE_RING_PRESERVED: stats.closed.outsideRatio <= outsideThreshold,
        sampleTimes: times,
        eyeDiffRatios: Object.fromEntries(Object.entries(stats).map(([name, value]) => [name, value.insideRatio])),
        outsideDiffRatios: Object.fromEntries(Object.entries(stats).map(([name, value]) => [name, value.outsideRatio])),
      };
      const required = ["EYES_OPEN_BEFORE_BLINK", "EYES_CLOSE_DURING_BLINK", "EYES_REOPEN_FULLY", "BLINK_COMPLETES_WITHIN_WINDOW", "BLINK_NATURAL", "EYE_REGION_NO_MAJOR_ARTIFACT", "GAZE_NOT_UNINTENTIONALLY_CHANGED"] as const;
      const passed = required.every(key => actual[key]);
      return [finding(passed ? "PASS" : "FAIL", parsed.value, actual, [{ kind: "blink-pixel-diff-analysis", source: context.finalVideoPath, value: actual }])];
    } catch (error) {
      return [finding("NOT_EVALUATED", parsed.value, { reason: error instanceof Error ? error.message : String(error) })];
    }
  }
}

export const blinkValidator = new BlinkValidator();
