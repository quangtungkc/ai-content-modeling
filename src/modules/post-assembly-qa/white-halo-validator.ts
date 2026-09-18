import { spawn } from "node:child_process";
import type { QaContext, QaFinding, QaValidator } from "./types";
import { computeHaloGeometry, parseWhiteHaloParametersFromState, sampleLocalSclera, type HaloGeometry, type PixelRegion, type WhiteHaloParameters, type WhiteHaloVideoMetadata } from "./white-halo-handler";
import { findSmokeRingFfmpegPath, probeSmokeRingVideo } from "./smoke-ring-handler";

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function distance(left: { r: number; g: number; b: number }, right: { r: number; g: number; b: number }) { return Math.max(Math.abs(left.r - right.r), Math.abs(left.g - right.g), Math.abs(left.b - right.b)); }
function point(frame: Buffer, metadata: WhiteHaloVideoMetadata, x: number, y: number) { const offset = (Math.floor(y) * metadata.width + Math.floor(x)) * 4; return { r: frame[offset], g: frame[offset + 1], b: frame[offset + 2] }; }
function inRegion(x: number, y: number, region: PixelRegion) { return x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height; }
function inEllipse(x: number, y: number, region: PixelRegion) { const cx = region.x + region.width / 2; const cy = region.y + region.height / 2; return ((x - cx) / (region.width / 2)) ** 2 + ((y - cy) / (region.height / 2)) ** 2 <= 1; }

function readFrame(ffmpegPath: string, filePath: string, time: number, metadata: WhiteHaloVideoMetadata) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, time).toFixed(3), "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let stderr = ""; child.stdout.on("data", chunk => chunks.push(Buffer.from(chunk))); child.stderr.on("data", chunk => { stderr += String(chunk); }); child.once("error", reject);
    child.once("close", code => { const output = Buffer.concat(chunks); const bytes = metadata.width * metadata.height * 4; if (code !== 0 || output.length < bytes) reject(new Error(`WHITE_HALO_VALIDATOR_FRAME_READ_FAILED:${stderr.slice(-500)}`)); else resolve(output.subarray(0, bytes)); });
  });
}

function average(frame: Buffer, metadata: WhiteHaloVideoMetadata, region: PixelRegion, predicate: (x: number, y: number) => boolean = () => true) {
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (let y = Math.max(0, Math.floor(region.y)); y < Math.min(metadata.height, Math.ceil(region.y + region.height)); y += 1) for (let x = Math.max(0, Math.floor(region.x)); x < Math.min(metadata.width, Math.ceil(region.x + region.width)); x += 1) { if (!predicate(x, y)) continue; const color = point(frame, metadata, x, y); r += color.r; g += color.g; b += color.b; count += 1; }
  return count ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) } : null;
}

function diffRatio(before: Buffer, after: Buffer, metadata: WhiteHaloVideoMetadata, predicate: (x: number, y: number) => boolean) {
  let changed = 0; let total = 0;
  for (let index = 0; index < metadata.width * metadata.height; index += 1) { const x = index % metadata.width; const y = Math.floor(index / metadata.width); if (!predicate(x, y)) continue; const offset = index * 4; if (Math.max(Math.abs(before[offset] - after[offset]), Math.abs(before[offset + 1] - after[offset + 1]), Math.abs(before[offset + 2] - after[offset + 2])) > 30) changed += 1; total += 1; }
  return total ? changed / total : 0;
}

function sideChecks(baseline: Buffer, candidate: Buffer, metadata: WhiteHaloVideoMetadata, geometry: HaloGeometry) {
  return [geometry.left, geometry.right].filter((side): side is NonNullable<typeof side> => Boolean(side)).map(side => {
    const sclera = sampleLocalSclera(baseline, metadata, side);
    const patched = average(candidate, metadata, side.halo, (x, y) => !side.pupil || !inEllipse(x, y, side.pupil));
    const pupilDiff = side.pupil ? diffRatio(baseline, candidate, metadata, (x, y) => inEllipse(x, y, side.pupil!)) : 1;
    const eyeOutsideHalo = diffRatio(baseline, candidate, metadata, (x, y) => inRegion(x, y, side.eye) && !inRegion(x, y, side.halo));
    const edgePoints = [[side.halo.x + 1, side.halo.y + side.halo.height / 2], [side.halo.x + side.halo.width - 2, side.halo.y + side.halo.height / 2], [side.halo.x + side.halo.width / 2, side.halo.y + 1], [side.halo.x + side.halo.width / 2, side.halo.y + side.halo.height - 2]];
    const hardBoundary = sclera ? edgePoints.every(([x, y]) => distance(point(candidate, metadata, x, y), sclera.color) <= 80) : false;
    return { scleraMatch: Boolean(sclera && patched && distance(sclera.color, patched) <= 45), pupilDiff, eyeOutsideHalo, hardBoundary };
  });
}

function finding(status: QaFinding["status"], parameters: WhiteHaloParameters | null, actual: Record<string, unknown>, evidence: unknown[] = []): QaFinding { return { validatorId: "white-halo", status, sceneNumber: parameters?.sceneNumber ?? null, globalTimestamp: parameters ? parameters.sceneStart + parameters.effectStartLocalTime : null, sceneLocalTimestamp: parameters?.effectStartLocalTime ?? null, expected: parameters ? { haloAbsent: true, effectStart: parameters.effectStartLocalTime, effectEnd: parameters.effectEndLocalTime } : null, actual, evidence, confidence: status === "NOT_EVALUATED" ? 0 : 1, severity: "HIGH", suggestedFirstDivergence: "GAZE_OVERLAY_COMPOSITING", affectedRegion: "eyes", affectedFile: null, symptom: status === "PASS" ? undefined : "WHITE_HALO_VALIDATION_FAILED" }; }

export class WhiteHaloValidator implements QaValidator {
  readonly id = "white-halo";
  async validate(context: QaContext): Promise<QaFinding[]> {
    const baselinePath = typeof context.checkpoint.baselineFinalVideoPath === "string" ? context.checkpoint.baselineFinalVideoPath : null; const state = record(context.checkpoint.whiteHaloParameters);
    if (!baselinePath || !Object.keys(state).length) return [finding("NOT_EVALUATED", null, { reason: "MISSING_WHITE_HALO_VALIDATION_CONTEXT" })];
    const parsed = parseWhiteHaloParametersFromState(state, typeof state.sceneNumber === "number" ? state.sceneNumber : null, baselinePath, context.finalVideoPath);
    if ("error" in parsed) return [finding("NOT_EVALUATED", null, { reason: parsed.error })];
    try {
      const ffmpegPath = await findSmokeRingFfmpegPath(); if (!ffmpegPath) return [finding("NOT_EVALUATED", parsed.value, { reason: "WHITE_HALO_VALIDATOR_FFMPEG_NOT_FOUND" })];
      const metadata = await probeSmokeRingVideo(ffmpegPath, context.finalVideoPath); const geometry = computeHaloGeometry(parsed.value, metadata); if ("error" in geometry) return [finding("NOT_EVALUATED", parsed.value, { reason: geometry.error })];
      const middle = Math.max(0, Math.min(metadata.duration - 0.01, parsed.value.sceneStart + (parsed.value.effectStartLocalTime + parsed.value.effectEndLocalTime) / 2)); const baseline = await readFrame(ffmpegPath, baselinePath, middle, metadata); const candidate = await readFrame(ffmpegPath, context.finalVideoPath, middle, metadata);
      const checks = sideChecks(baseline, candidate, metadata, geometry); if (!checks.length) return [finding("NOT_EVALUATED", parsed.value, { reason: "NO_HALO_SIDE_TO_VALIDATE" })];
      const eyes = [geometry.left?.eye, geometry.right?.eye].filter((eye): eye is PixelRegion => Boolean(eye));
      const outside = diffRatio(baseline, candidate, metadata, (x, y) => !eyes.some(eye => inRegion(x, y, eye)));
      const blinkPreserved = await Promise.all(parsed.value.blinkWindowsToPreserve.map(async window => { const time = Math.max(0, Math.min(metadata.duration - 0.01, parsed.value.sceneStart + (window.startLocalTime + window.endLocalTime) / 2)); return diffRatio(await readFrame(ffmpegPath, baselinePath, time, metadata), await readFrame(ffmpegPath, context.finalVideoPath, time, metadata), metadata, (x, y) => eyes.some(eye => inRegion(x, y, eye))) <= 0.05; }));
      const actual = { WHITE_HALO_ABSENT: checks.every(check => check.scleraMatch), SCLERA_COLOR_MATCH: checks.every(check => check.scleraMatch), PUPIL_PRESERVED: checks.every(check => check.pupilDiff <= 0.05), GAZE_PRESERVED: checks.every(check => check.pupilDiff <= 0.05), EYE_SHAPE_PRESERVED: checks.every(check => check.eyeOutsideHalo <= 0.02), BLINK_PRESERVED: blinkPreserved.every(Boolean), SMOKE_RING_PRESERVED: outside <= 0.015, NO_MAJOR_UNINTENDED_CHANGE: outside <= 0.015, NO_HARD_PATCH_BOUNDARY: checks.every(check => check.hardBoundary), outsideDiffRatio: outside };
      const required = ["WHITE_HALO_ABSENT", "SCLERA_COLOR_MATCH", "PUPIL_PRESERVED", "GAZE_PRESERVED", "EYE_SHAPE_PRESERVED", "BLINK_PRESERVED", "NO_MAJOR_UNINTENDED_CHANGE", "NO_HARD_PATCH_BOUNDARY"] as const;
      return [finding(required.every(key => actual[key]) ? "PASS" : "FAIL", parsed.value, actual, [{ kind: "white-halo-pixel-analysis", source: context.finalVideoPath, value: actual }])];
    } catch (error) { return [finding("NOT_EVALUATED", parsed.value, { reason: error instanceof Error ? error.message : String(error) })]; }
  }
}
export const whiteHaloValidator = new WhiteHaloValidator();
