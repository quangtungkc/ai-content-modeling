import { spawn } from "node:child_process";
import type { QaContext, QaFinding, QaValidator } from "./types";
import { anchorPixels, findSmokeRingFfmpegPath, parseSmokeRingParametersFromState, type SmokeRingParameters, type SmokeRingVideoMetadata } from "./smoke-ring-handler";

type DiffStats = { changedPixels: number; ratio: number; centroid: { x: number; y: number } | null; maxDistanceFromAnchor: number };

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function sampleFrame(ffmpegPath: string, filePath: string, time: number, metadata: SmokeRingVideoMetadata) {
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
      if (code !== 0 || frame.length < expectedBytes) reject(new Error(`SMOKE_RING_FRAME_READ_FAILED:${stderr.slice(-500)}`));
      else resolve(frame.subarray(0, expectedBytes));
    });
  });
}

function diffStats(before: Buffer, after: Buffer, metadata: SmokeRingVideoMetadata, anchor: { x: number; y: number }): DiffStats {
  const totalPixels = metadata.width * metadata.height;
  let changedPixels = 0;
  let sumX = 0;
  let sumY = 0;
  let maxDistanceFromAnchor = 0;
  for (let index = 0; index < totalPixels; index += 1) {
    const offset = index * 4;
    const changed = Math.abs(before[offset] - after[offset]) > 24 || Math.abs(before[offset + 1] - after[offset + 1]) > 24 || Math.abs(before[offset + 2] - after[offset + 2]) > 24;
    if (!changed) continue;
    const x = index % metadata.width;
    const y = Math.floor(index / metadata.width);
    changedPixels += 1;
    sumX += x;
    sumY += y;
    maxDistanceFromAnchor = Math.max(maxDistanceFromAnchor, Math.hypot(x - anchor.x, y - anchor.y));
  }
  return { changedPixels, ratio: changedPixels / totalPixels, centroid: changedPixels ? { x: sumX / changedPixels, y: sumY / changedPixels } : null, maxDistanceFromAnchor };
}

function smokeFinding(status: QaFinding["status"], parameters: SmokeRingParameters | null, actual: Record<string, unknown>, evidence: unknown[]): QaFinding {
  return { validatorId: "smoke-ring", status, sceneNumber: parameters?.sceneNumber ?? null, globalTimestamp: parameters ? parameters.sceneStart + parameters.effectStartLocalTime : null, sceneLocalTimestamp: parameters?.effectStartLocalTime ?? null, expected: parameters ? { startLocal: parameters.effectStartLocalTime, endLocal: parameters.effectEndLocalTime, origin: parameters.mouthAnchor, region: "mouth" } : null, actual, evidence, confidence: status === "NOT_EVALUATED" ? 0 : 1, severity: "HIGH", suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT", affectedRegion: "mouth", affectedFile: null, symptom: status === "PASS" ? undefined : "SMOKE_RING_VALIDATION_FAILED" };
}

export class SmokeRingValidator implements QaValidator {
  readonly id = "smoke-ring";

  async validate(context: QaContext): Promise<QaFinding[]> {
    const baselinePath = typeof context.checkpoint.baselineFinalVideoPath === "string" ? context.checkpoint.baselineFinalVideoPath : null;
    const state = record(context.checkpoint.smokeRingParameters);
    if (!baselinePath || !Object.keys(state).length) return [smokeFinding("NOT_EVALUATED", null, { reason: "MISSING_SMOKE_RING_VALIDATION_CONTEXT" }, [])];
    const parsed = parseSmokeRingParametersFromState(state, typeof state.sceneNumber === "number" ? state.sceneNumber : null, baselinePath, context.finalVideoPath);
    if ("error" in parsed) return [smokeFinding("NOT_EVALUATED", null, { reason: parsed.error, details: "details" in parsed ? parsed.details : null }, [])];
    try {
      const ffmpegPath = await findSmokeRingFfmpegPath();
      if (!ffmpegPath) return [smokeFinding("NOT_EVALUATED", parsed.value, { reason: "SMOKE_RING_FFMPEG_NOT_FOUND" }, [])];
      const metadata = await import("./smoke-ring-handler").then(module => module.probeSmokeRingVideo(ffmpegPath, context.finalVideoPath));
      const anchor = anchorPixels(parsed.value, metadata);
      const duration = metadata.duration;
      const insideTimes = [parsed.value.effectStartLocalTime + parsed.value.fadeIn + 0.05, (parsed.value.effectStartLocalTime + parsed.value.effectEndLocalTime) / 2, parsed.value.effectEndLocalTime - parsed.value.fadeOut - 0.05].map(local => Math.max(0, Math.min(parsed.value.effectEndLocalTime, local + parsed.value.sceneStart))).filter((time, index, all) => all.indexOf(time) === index && time < duration);
      const outsideTimes = [parsed.value.sceneStart + Math.max(0, parsed.value.effectStartLocalTime - 0.2), parsed.value.sceneStart + Math.min(parsed.value.effectEndLocalTime + 0.2, parsed.value.sceneEnd - parsed.value.sceneStart - 0.01)].map(time => Math.max(0, Math.min(duration - 0.01, time))).filter((time, index, all) => all.indexOf(time) === index);
      if (!insideTimes.length || !outsideTimes.length) return [smokeFinding("NOT_EVALUATED", parsed.value, { reason: "SMOKE_RING_VALIDATION_WINDOW_OUTSIDE_VIDEO" }, [])];
      const inside = await Promise.all(insideTimes.map(async time => diffStats(await sampleFrame(ffmpegPath, baselinePath, time, metadata), await sampleFrame(ffmpegPath, context.finalVideoPath, time, metadata), metadata, anchor)));
      const outside = await Promise.all(outsideTimes.map(async time => diffStats(await sampleFrame(ffmpegPath, baselinePath, time, metadata), await sampleFrame(ffmpegPath, context.finalVideoPath, time, metadata), metadata, anchor)));
      const allowedRadius = Math.max(parsed.value.ringInitialSize, parsed.value.ringFinalSize) + parsed.value.thickness + 8;
      const present = inside.some(stats => stats.changedPixels > 10);
      const visibleInWindow = inside.length >= 2 && inside.every(stats => stats.changedPixels > 10);
      const originNearAnchor = inside.some(stats => stats.centroid && Math.hypot(stats.centroid.x - anchor.x, stats.centroid.y - anchor.y) <= allowedRadius);
      const absentOutside = outside.every(stats => stats.ratio <= 0.002);
      const noLargeUnintendedChange = inside.every(stats => stats.maxDistanceFromAnchor <= allowedRadius);
      const actual = { SMOKE_RING_PRESENT: present, SMOKE_RING_ORIGIN_NEAR_EXPECTED_ANCHOR: originNearAnchor, SMOKE_RING_VISIBLE_IN_REQUIRED_WINDOW: visibleInWindow, SMOKE_RING_ABSENT_OUTSIDE_ALLOWED_WINDOW: absentOutside, NO_LARGE_UNINTENDED_VISUAL_CHANGE: noLargeUnintendedChange, insideTimes, outsideTimes, insideDiffRatios: inside.map(stats => stats.ratio), outsideDiffRatios: outside.map(stats => stats.ratio) };
      return [smokeFinding(Object.values(actual).slice(0, 5).every(value => value === true) ? "PASS" : "FAIL", parsed.value, actual, [{ kind: "pixel-diff-analysis", source: context.finalVideoPath, value: actual }])];
    } catch (error) {
      return [smokeFinding("NOT_EVALUATED", parsed.value, { reason: error instanceof Error ? error.message : String(error) }, [])];
    }
  }
}

export const smokeRingValidator = new SmokeRingValidator();
