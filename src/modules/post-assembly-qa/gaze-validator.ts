import { spawn } from "node:child_process";
import type { QaContext, QaFinding, QaValidator } from "./types";
import { computeGazeGeometry, parseGazeParametersFromState, regionPixels, type GazeParameters, type GazeVideoMetadata, type PixelRegion } from "./gaze-handler";
import { findSmokeRingFfmpegPath, probeSmokeRingVideo } from "./smoke-ring-handler";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function luminance(r: number, g: number, b: number) { return r * 0.2126 + g * 0.7152 + b * 0.0722; }
function colorDistance(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) { return Math.max(Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b)); }

function readFrame(ffmpegPath: string, filePath: string, time: number, metadata: GazeVideoMetadata) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, time).toFixed(3), "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let stderr = "";
    child.stdout.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", code => {
      const frame = Buffer.concat(chunks); const expected = metadata.width * metadata.height * 4;
      if (code !== 0 || frame.length < expected) reject(new Error(`GAZE_VALIDATOR_FRAME_READ_FAILED:${stderr.slice(-500)}`));
      else resolve(frame.subarray(0, expected));
    });
  });
}

function inEllipse(x: number, y: number, region: PixelRegion, grow = 0) {
  const cx = region.x + region.width / 2; const cy = region.y + region.height / 2;
  const rx = region.width / 2 + grow; const ry = region.height / 2 + grow;
  return ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1;
}

function average(frame: Buffer, metadata: GazeVideoMetadata, region: PixelRegion, predicate: (x: number, y: number) => boolean = () => true) {
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (let y = Math.max(0, Math.floor(region.y)); y < Math.min(metadata.height, Math.ceil(region.y + region.height)); y += 1) for (let x = Math.max(0, Math.floor(region.x)); x < Math.min(metadata.width, Math.ceil(region.x + region.width)); x += 1) {
    if (!predicate(x, y)) continue;
    const offset = (y * metadata.width + x) * 4;
    r += frame[offset]; g += frame[offset + 1]; b += frame[offset + 2]; count += 1;
  }
  return count ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) } : null;
}

function darkRatio(frame: Buffer, metadata: GazeVideoMetadata, region: PixelRegion, threshold: number) {
  let dark = 0; let total = 0;
  for (let y = Math.max(0, Math.floor(region.y)); y < Math.min(metadata.height, Math.ceil(region.y + region.height)); y += 1) for (let x = Math.max(0, Math.floor(region.x)); x < Math.min(metadata.width, Math.ceil(region.x + region.width)); x += 1) {
    if (!inEllipse(x, y, region)) continue;
    const offset = (y * metadata.width + x) * 4;
    if (luminance(frame[offset], frame[offset + 1], frame[offset + 2]) <= threshold) dark += 1;
    total += 1;
  }
  return total ? dark / total : 0;
}

function outsideDiffRatio(before: Buffer, after: Buffer, metadata: GazeVideoMetadata, eyes: PixelRegion[]) {
  let changed = 0; let total = 0;
  for (let index = 0; index < metadata.width * metadata.height; index += 1) {
    const x = index % metadata.width; const y = Math.floor(index / metadata.width);
    if (eyes.some(eye => x >= eye.x && x < eye.x + eye.width && y >= eye.y && y < eye.y + eye.height)) continue;
    const offset = index * 4;
    if (Math.max(Math.abs(before[offset] - after[offset]), Math.abs(before[offset + 1] - after[offset + 1]), Math.abs(before[offset + 2] - after[offset + 2])) > 30) changed += 1;
    total += 1;
  }
  return total ? changed / total : 1;
}

function eyeDiffRatio(before: Buffer, after: Buffer, metadata: GazeVideoMetadata, eyes: PixelRegion[]) {
  let changed = 0; let total = 0;
  for (let index = 0; index < metadata.width * metadata.height; index += 1) {
    const x = index % metadata.width; const y = Math.floor(index / metadata.width);
    if (!eyes.some(eye => x >= eye.x && x < eye.x + eye.width && y >= eye.y && y < eye.y + eye.height)) continue;
    const offset = index * 4;
    if (Math.max(Math.abs(before[offset] - after[offset]), Math.abs(before[offset + 1] - after[offset + 1]), Math.abs(before[offset + 2] - after[offset + 2])) > 30) changed += 1;
    total += 1;
  }
  return total ? changed / total : 1;
}

function finding(status: QaFinding["status"], parameters: GazeParameters | null, actual: Record<string, unknown>, evidence: unknown[] = []): QaFinding {
  return { validatorId: "gaze", status, sceneNumber: parameters?.sceneNumber ?? null, globalTimestamp: parameters ? parameters.sceneStart + parameters.effectStartLocalTime : null, sceneLocalTimestamp: parameters?.effectStartLocalTime ?? null, expected: parameters ? { target: parameters.targetAnchor, effectStart: parameters.effectStartLocalTime, effectEnd: parameters.effectEndLocalTime } : null, actual, evidence, confidence: status === "NOT_EVALUATED" ? 0 : 1, severity: "HIGH", suggestedFirstDivergence: "FLOW_VIDEO_OUTPUT", affectedRegion: "eyes", affectedFile: null, symptom: status === "PASS" ? undefined : "GAZE_VALIDATION_FAILED" };
}

export class GazeValidator implements QaValidator {
  readonly id = "gaze";

  async validate(context: QaContext): Promise<QaFinding[]> {
    const baselinePath = typeof context.checkpoint.baselineFinalVideoPath === "string" ? context.checkpoint.baselineFinalVideoPath : null;
    const state = record(context.checkpoint.gazeParameters);
    if (!baselinePath || !Object.keys(state).length) return [finding("NOT_EVALUATED", null, { reason: "MISSING_GAZE_VALIDATION_CONTEXT" })];
    const parsed = parseGazeParametersFromState(state, typeof state.sceneNumber === "number" ? state.sceneNumber : null, baselinePath, context.finalVideoPath);
    if ("error" in parsed) return [finding("NOT_EVALUATED", null, { reason: parsed.error })];
    try {
      const ffmpegPath = await findSmokeRingFfmpegPath();
      if (!ffmpegPath) return [finding("NOT_EVALUATED", parsed.value, { reason: "GAZE_VALIDATOR_FFMPEG_NOT_FOUND" })];
      const metadata = await probeSmokeRingVideo(ffmpegPath, context.finalVideoPath);
      const geometry = computeGazeGeometry(parsed.value, metadata);
      if ("error" in geometry) return [finding("NOT_EVALUATED", parsed.value, { reason: geometry.error })];
      const middle = Math.max(0, Math.min(metadata.duration - 0.01, parsed.value.sceneStart + (parsed.value.effectStartLocalTime + parsed.value.effectEndLocalTime) / 2));
      const baseline = await readFrame(ffmpegPath, baselinePath, middle, metadata);
      const candidate = await readFrame(ffmpegPath, context.finalVideoPath, middle, metadata);
      const pairs = [[geometry.leftEye, geometry.leftOldPupil, geometry.leftNewPupil], [geometry.rightEye, geometry.rightOldPupil, geometry.rightNewPupil]] as const;
      const checks = pairs.map(([eye, oldPupil, newPupil]) => {
        const baselinePupil = average(baseline, metadata, oldPupil);
        const sclera = average(baseline, metadata, eye, (x, y) => !inEllipse(x, y, oldPupil, 1));
        const candidateOld = average(candidate, metadata, oldPupil);
        const oldDark = baselinePupil ? darkRatio(candidate, metadata, oldPupil, luminance(baselinePupil.r, baselinePupil.g, baselinePupil.b) + 22) : 1;
        const newDark = baselinePupil ? darkRatio(candidate, metadata, newPupil, luminance(baselinePupil.r, baselinePupil.g, baselinePupil.b) + 22) : 0;
        const expectedDark = baselinePupil ? darkRatio(baseline, metadata, oldPupil, luminance(baselinePupil.r, baselinePupil.g, baselinePupil.b) + 22) : 0;
        return { oldDark, newDark, expectedDark, scleraMatch: Boolean(sclera && candidateOld && colorDistance(sclera, candidateOld) <= 45), styleMatch: expectedDark > 0 && Math.abs(newDark - expectedDark) <= 0.35 };
      });
      const outside = outsideDiffRatio(baseline, candidate, metadata, [geometry.leftEye, geometry.rightEye]);
      const blinkPreserved = await Promise.all(parsed.value.blinkWindowsToPreserve.map(async window => {
        const time = Math.max(0, Math.min(metadata.duration - 0.01, parsed.value.sceneStart + (window.startLocalTime + window.endLocalTime) / 2));
        return eyeDiffRatio(await readFrame(ffmpegPath, baselinePath, time, metadata), await readFrame(ffmpegPath, context.finalVideoPath, time, metadata), metadata, [geometry.leftEye, geometry.rightEye]) <= 0.05;
      }));
      const moves: Array<{ move: { x: number; y: number }; pupil: PixelRegion }> = [{ move: geometry.movement.left, pupil: geometry.leftOldPupil }, { move: geometry.movement.right, pupil: geometry.rightOldPupil }];
      const towardTarget = moves.every(({ move, pupil }) => move.x * (geometry.target.x - (pupil.x + pupil.width / 2)) + move.y * (geometry.target.y - (pupil.y + pupil.height / 2)) > 0);
      const actual = {
        GAZE_DIRECTION_TOWARD_TARGET: towardTarget && checks.every(check => check.newDark >= 0.25),
        PUPIL_INSIDE_EYE_BOUNDS: true,
        OLD_PUPIL_ABSENT: checks.every(check => check.oldDark <= 0.2),
        DOUBLE_PUPIL_ABSENT: checks.every(check => check.oldDark <= 0.2 && check.newDark >= 0.25),
        PUPIL_SIZE_STYLE_MATCH: checks.every(check => check.styleMatch),
        SCLERA_COLOR_MATCH: checks.every(check => check.scleraMatch),
        WHITE_HALO_ABSENT: checks.every(check => check.scleraMatch),
        BLINK_PRESERVED: blinkPreserved.every(Boolean),
        SMOKE_RING_PRESERVED: outside <= 0.015,
        NO_MAJOR_UNINTENDED_CHANGE: outside <= 0.015,
        outsideDiffRatio: outside,
        localTimeWindow: { start: parsed.value.effectStartLocalTime, end: parsed.value.effectEndLocalTime },
        movement: geometry.movement,
        target: geometry.target,
      };
      const required = ["GAZE_DIRECTION_TOWARD_TARGET", "PUPIL_INSIDE_EYE_BOUNDS", "OLD_PUPIL_ABSENT", "DOUBLE_PUPIL_ABSENT", "PUPIL_SIZE_STYLE_MATCH", "SCLERA_COLOR_MATCH", "WHITE_HALO_ABSENT", "BLINK_PRESERVED", "NO_MAJOR_UNINTENDED_CHANGE"] as const;
      return [finding(required.every(key => actual[key]) ? "PASS" : "FAIL", parsed.value, actual, [{ kind: "gaze-pixel-analysis", source: context.finalVideoPath, value: actual }])];
    } catch (error) {
      return [finding("NOT_EVALUATED", parsed.value, { reason: error instanceof Error ? error.message : String(error) })];
    }
  }
}

export const gazeValidator = new GazeValidator();
