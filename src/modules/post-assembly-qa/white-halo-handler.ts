import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { PostAssemblyHandlerOutcome, PostAssemblyRepairHandler } from "@/modules/troubleshooting/handlers";
import type { TroubleshootingIncident } from "@/modules/troubleshooting/incident-schema";
import { findSmokeRingFfmpegPath, probeSmokeRingVideo, type SmokeRingVideoMetadata } from "./smoke-ring-handler";

export const WHITE_HALO_HANDLER_ID = "white-halo-local-sclera-compositor";
export const WHITE_HALO_HANDLER_VERSION = "1.0.0";

const regionSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), space: z.enum(["PIXELS", "NORMALIZED"]) });
const blinkWindowSchema = z.object({ startLocalTime: z.number().finite().nonnegative(), endLocalTime: z.number().finite().positive() });
export const whiteHaloParametersSchema = z.object({
  sceneNumber: z.number().int().positive(), sceneStart: z.number().finite().nonnegative(), sceneEnd: z.number().finite().positive(),
  effectStartLocalTime: z.number().finite().nonnegative(), effectEndLocalTime: z.number().finite().positive(),
  leftEyeRegion: regionSchema, rightEyeRegion: regionSchema,
  leftHaloRegion: regionSchema.nullable(), rightHaloRegion: regionSchema.nullable(),
  leftPupilRegion: regionSchema.nullable(), rightPupilRegion: regionSchema.nullable(),
  featherAmount: z.number().finite().nonnegative(), interpolation: z.enum(["LINEAR", "SMOOTHSTEP"]), blinkWindowsToPreserve: z.array(blinkWindowSchema),
  candidateInputPath: z.string().min(1), candidateOutputPath: z.string().min(1),
});
export type WhiteHaloParameters = z.infer<typeof whiteHaloParametersSchema>;
export type WhiteHaloVideoMetadata = SmokeRingVideoMetadata;
export type PixelRegion = { x: number; y: number; width: number; height: number };
export type HaloSide = { eye: PixelRegion; halo: PixelRegion; pupil: PixelRegion | null };
export type HaloGeometry = { left: HaloSide | null; right: HaloSide | null };
export type ScleraStyle = { color: { r: number; g: number; b: number }; sampleCount: number; maxDeviation: number };

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function interpolate(value: number, mode: WhiteHaloParameters["interpolation"]) { return mode === "SMOOTHSTEP" ? value * value * (3 - 2 * value) : value; }
function parseRegion(value: unknown): WhiteHaloParameters["leftEyeRegion"] | null {
  const parsed = regionSchema.safeParse(value);
  if (!parsed.success || (parsed.data.space === "NORMALIZED" && (parsed.data.x < 0 || parsed.data.y < 0 || parsed.data.x + parsed.data.width > 1 || parsed.data.y + parsed.data.height > 1))) return null;
  return parsed.data;
}

export function parseWhiteHaloParametersFromState(state: Record<string, unknown>, fallbackSceneNumber: number | null, candidateInputPath: string, candidateOutputPath: string) {
  if (state.multipleCharacters === true || (Array.isArray(state.faceCandidates) && state.faceCandidates.length > 1)) return { error: "AMBIGUOUS_HALO_TARGET" } as const;
  if (state.preexistingDoublePupil === true || state.doublePupilPresent === true) return { error: "INDEPENDENT_DOUBLE_PUPIL_PRESENT" } as const;
  const eyes = record(state.eyeRegions); const halos = record(state.haloRegions); const pupils = record(state.pupilRegions);
  const leftEyeRegion = parseRegion(state.leftEyeRegion) ?? parseRegion(eyes.left);
  const rightEyeRegion = parseRegion(state.rightEyeRegion) ?? parseRegion(eyes.right);
  const side = typeof state.affectedEye === "string" ? state.affectedEye.toUpperCase() : null;
  const shared = parseRegion(state.haloRegion ?? state.artifactRegion);
  const leftHaloRegion = parseRegion(state.leftHaloRegion) ?? parseRegion(halos.left) ?? (side === "LEFT" ? shared : null);
  const rightHaloRegion = parseRegion(state.rightHaloRegion) ?? parseRegion(halos.right) ?? (side === "RIGHT" ? shared : null);
  const leftPupilRegion = parseRegion(state.leftPupilRegion) ?? parseRegion(pupils.left);
  const rightPupilRegion = parseRegion(state.rightPupilRegion) ?? parseRegion(pupils.right);
  if (!leftEyeRegion || !rightEyeRegion) return { error: "MISSING_EYE_REGION" } as const;
  if (!leftHaloRegion && !rightHaloRegion) return { error: "MISSING_HALO_REGION" } as const;
  if ((leftHaloRegion && !leftPupilRegion) || (rightHaloRegion && !rightPupilRegion)) return { error: "MISSING_PUPIL_REGION_FOR_HALO_PRESERVATION" } as const;
  const parsed = whiteHaloParametersSchema.safeParse({ sceneNumber: state.sceneNumber ?? fallbackSceneNumber, sceneStart: state.sceneStart, sceneEnd: state.sceneEnd, effectStartLocalTime: state.effectStartLocalTime, effectEndLocalTime: state.effectEndLocalTime, leftEyeRegion, rightEyeRegion, leftHaloRegion, rightHaloRegion, leftPupilRegion, rightPupilRegion, featherAmount: state.featherAmount ?? 2, interpolation: state.interpolation ?? "SMOOTHSTEP", blinkWindowsToPreserve: Array.isArray(state.blinkWindowsToPreserve) ? state.blinkWindowsToPreserve : [], candidateInputPath, candidateOutputPath });
  if (!parsed.success) return { error: "MISSING_WHITE_HALO_PARAMETER", details: parsed.error.issues.map(issue => issue.path.join(".")).join(",") } as const;
  const value = parsed.data; const duration = value.sceneEnd - value.sceneStart;
  if (!(value.effectStartLocalTime < value.effectEndLocalTime) || value.effectEndLocalTime > duration || value.blinkWindowsToPreserve.some(window => !(window.startLocalTime < window.endLocalTime) || window.endLocalTime > duration)) return { error: "INVALID_WHITE_HALO_TIME_WINDOW" } as const;
  return { value } as const;
}
export function parseWhiteHaloParameters(incident: TroubleshootingIncident, candidateInputPath: string, candidateOutputPath: string) { return parseWhiteHaloParametersFromState(record(incident.actualState), incident.sceneNumber, candidateInputPath, candidateOutputPath); }

export function regionPixels(region: WhiteHaloParameters["leftEyeRegion"], metadata: WhiteHaloVideoMetadata): PixelRegion { return region.space === "NORMALIZED" ? { x: region.x * metadata.width, y: region.y * metadata.height, width: region.width * metadata.width, height: region.height * metadata.height } : region; }
function contains(inner: PixelRegion, outer: PixelRegion) { return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height; }
function inEllipse(x: number, y: number, region: PixelRegion, grow = 0) { const cx = region.x + region.width / 2; const cy = region.y + region.height / 2; const rx = region.width / 2 + grow; const ry = region.height / 2 + grow; return ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1; }

export function computeHaloGeometry(parameters: WhiteHaloParameters, metadata: WhiteHaloVideoMetadata): HaloGeometry | { error: string } {
  const frame = { x: 0, y: 0, width: metadata.width, height: metadata.height };
  const side = (eyeInput: WhiteHaloParameters["leftEyeRegion"], haloInput: WhiteHaloParameters["leftHaloRegion"], pupilInput: WhiteHaloParameters["leftPupilRegion"]) => {
    if (!haloInput) return null;
    const eye = regionPixels(eyeInput, metadata); const halo = regionPixels(haloInput, metadata); const pupil = pupilInput ? regionPixels(pupilInput, metadata) : null;
    if (!contains(eye, frame) || !contains(halo, eye) || !pupil || !contains(pupil, eye)) return { error: "INVALID_HALO_GEOMETRY" } as const;
    return { eye, halo, pupil } as const;
  };
  const left = side(parameters.leftEyeRegion, parameters.leftHaloRegion, parameters.leftPupilRegion);
  const right = side(parameters.rightEyeRegion, parameters.rightHaloRegion, parameters.rightPupilRegion);
  if (left && "error" in left && left.error) return { error: left.error };
  if (right && "error" in right && right.error) return { error: right.error };
  return { left, right };
}

function readFrame(ffmpegPath: string, filePath: string, time: number, metadata: WhiteHaloVideoMetadata) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, time).toFixed(3), "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = []; let stderr = "";
    child.stdout.on("data", chunk => chunks.push(Buffer.from(chunk))); child.stderr.on("data", chunk => { stderr += String(chunk); }); child.once("error", reject);
    child.once("close", code => { const output = Buffer.concat(chunks); const bytes = metadata.width * metadata.height * 4; if (code !== 0 || output.length < bytes) reject(new Error(`HALO_FRAME_READ_FAILED:${stderr.slice(-500)}`)); else resolve(output.subarray(0, bytes)); });
  });
}

export function sampleLocalSclera(frame: Buffer, metadata: WhiteHaloVideoMetadata, side: HaloSide): ScleraStyle | null {
  const values: Array<{ r: number; g: number; b: number }> = [];
  for (let y = Math.max(0, Math.floor(side.eye.y)); y < Math.min(metadata.height, Math.ceil(side.eye.y + side.eye.height)); y += 1) for (let x = Math.max(0, Math.floor(side.eye.x)); x < Math.min(metadata.width, Math.ceil(side.eye.x + side.eye.width)); x += 1) {
    if (x - side.eye.x < 2 || side.eye.x + side.eye.width - x < 2 || y - side.eye.y < 2 || side.eye.y + side.eye.height - y < 2) continue;
    if (x >= side.halo.x - 2 && x <= side.halo.x + side.halo.width + 2 && y >= side.halo.y - 2 && y <= side.halo.y + side.halo.height + 2) continue;
    if (side.pupil && inEllipse(x, y, side.pupil, 2)) continue;
    const offset = (y * metadata.width + x) * 4; values.push({ r: frame[offset], g: frame[offset + 1], b: frame[offset + 2] });
  }
  if (values.length < 12) return null;
  values.sort((a, b) => (a.r + a.g + a.b) - (b.r + b.g + b.b));
  const median = values[Math.floor(values.length / 2)];
  const maxDeviation = Math.max(...values.map(value => Math.max(Math.abs(value.r - median.r), Math.abs(value.g - median.g), Math.abs(value.b - median.b))));
  if (maxDeviation > 70) return null;
  return { color: median, sampleCount: values.length, maxDeviation };
}

function paintHaloMask(frame: Buffer, metadata: WhiteHaloVideoMetadata, side: HaloSide, style: ScleraStyle, feather: number) {
  for (let y = Math.max(0, Math.floor(side.halo.y)); y < Math.min(metadata.height, Math.ceil(side.halo.y + side.halo.height)); y += 1) for (let x = Math.max(0, Math.floor(side.halo.x)); x < Math.min(metadata.width, Math.ceil(side.halo.x + side.halo.width)); x += 1) {
    if (side.pupil && inEllipse(x, y, side.pupil, 0.5)) continue;
    const edge = Math.min(x - side.halo.x, side.halo.x + side.halo.width - x, y - side.halo.y, side.halo.y + side.halo.height - y);
    const alpha = Math.round(255 * (feather ? clamp(edge / feather, 0, 1) : 1));
    if (!alpha) continue;
    const offset = (y * metadata.width + x) * 4; frame[offset] = style.color.r; frame[offset + 1] = style.color.g; frame[offset + 2] = style.color.b; frame[offset + 3] = alpha;
  }
}

export function createWhiteHaloFrame(parameters: WhiteHaloParameters, metadata: WhiteHaloVideoMetadata, globalTime: number, geometry: HaloGeometry, styles: { left: ScleraStyle | null; right: ScleraStyle | null }) {
  const frame = Buffer.alloc(metadata.width * metadata.height * 4); const local = globalTime - parameters.sceneStart;
  if (local < parameters.effectStartLocalTime || local > parameters.effectEndLocalTime || parameters.blinkWindowsToPreserve.some(window => local >= window.startLocalTime && local <= window.endLocalTime)) return frame;
  const fade = interpolate(clamp((local - parameters.effectStartLocalTime) / Math.max(0.001, Math.min(0.12, (parameters.effectEndLocalTime - parameters.effectStartLocalTime) / 2)), 0, 1), parameters.interpolation);
  if (fade <= 0) return frame;
  if (geometry.left && styles.left) paintHaloMask(frame, metadata, geometry.left, styles.left, parameters.featherAmount);
  if (geometry.right && styles.right) paintHaloMask(frame, metadata, geometry.right, styles.right, parameters.featherAmount);
  return frame;
}

async function writeFrame(stream: NodeJS.WritableStream, frame: Buffer) { if (stream.write(frame)) return; await new Promise<void>(resolve => stream.once("drain", resolve)); }
export async function normalizeMp4Timestamps(filePath: string) { const bytes = await readFile(filePath); const fixed = BigInt(Math.floor(Date.parse("2000-01-01T00:00:00.000Z") / 1000) + 2_082_844_800); for (let offset = 4; offset + 4 < bytes.length; offset += 1) { const name = bytes.toString("ascii", offset, offset + 4); if (!(name === "mvhd" || name === "tkhd" || name === "mdhd")) continue; const atom = offset - 4; const size = bytes.readUInt32BE(atom); if (size < 24 || atom + size > bytes.length) continue; if (bytes[offset + 4] === 0) { bytes.writeUInt32BE(Number(fixed), offset + 8); bytes.writeUInt32BE(Number(fixed), offset + 12); } else if (bytes[offset + 4] === 1 && offset + 24 <= bytes.length) { bytes.writeBigUInt64BE(fixed, offset + 8); bytes.writeBigUInt64BE(fixed, offset + 16); } } await writeFile(filePath, bytes); }

export async function renderWhiteHaloCandidate(parameters: WhiteHaloParameters, ffmpegPath: string, metadata?: WhiteHaloVideoMetadata) {
  const video = metadata ?? await probeSmokeRingVideo(ffmpegPath, parameters.candidateInputPath); const geometry = computeHaloGeometry(parameters, video); if ("error" in geometry) throw new Error(geometry.error);
  const reference = await readFrame(ffmpegPath, parameters.candidateInputPath, parameters.sceneStart + Math.max(0, parameters.effectStartLocalTime - 0.05), video);
  const styles = { left: geometry.left ? sampleLocalSclera(reference, video, geometry.left) : null, right: geometry.right ? sampleLocalSclera(reference, video, geometry.right) : null };
  if ((geometry.left && !styles.left) || (geometry.right && !styles.right)) throw new Error("UNRELIABLE_SCLERA_SAMPLE");
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", parameters.candidateInputPath, "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${video.width}x${video.height}`, "-framerate", String(video.fps), "-i", "pipe:0", "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:eof_action=repeat[outv]", "-map", "[outv]", "-map", "0:a?", "-t", String(video.duration), "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", "-threads", "1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1", "-c:a", "copy", "-movflags", "+faststart", parameters.candidateOutputPath];
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] }); let stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); });
  const completion = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(`WHITE_HALO_FFMPEG_FAILED:${stderr.slice(-2_000)}`))); });
  for (let index = 0; index < Math.ceil(video.duration * video.fps) + 2; index += 1) await writeFrame(child.stdin, createWhiteHaloFrame(parameters, video, index / video.fps, geometry, styles));
  child.stdin.end(); await completion; await normalizeMp4Timestamps(parameters.candidateOutputPath); return { video, geometry, styles };
}

function review(reason: string): PostAssemblyHandlerOutcome { return { status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], affectedScene: null, affectedRegion: "eyes", warnings: [reason], validatorsToRecheck: ["white-halo"], preserveRequirements: ["Do not modify CURRENT output.", "Preserve pupil, gaze, blink and approved effects."] }; }
export function createWhiteHaloPostAssemblyHandler(): PostAssemblyRepairHandler {
  return { issueId: "GAZE_WHITE_HALO_COMPOSITING", mode: "AUTO", handle: async () => ({ status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], stateChanged: {}, validationSignals: {}, warnings: ["White-halo handler chỉ được gọi qua Post-Assembly coordinator."], nextAction: "Use PostAssemblyRepairCoordinator." }),
    postAssembly: { handlerId: WHITE_HALO_HANDLER_ID, handlerVersion: WHITE_HALO_HANDLER_VERSION, supportsPostAssembly: true, repairScope: "FRAME_REGION", mutatesOutputFile: true, requiresCandidate: true, supportedValidatorIds: ["white-halo", "GAZE_WHITE_HALO_COMPOSITING", "visual-artifacts", "post-assembly-visual"], preserveRequirements: ["Preserve pupil position/style, gaze, blink, smoke/effects, face identity, background and other scenes.", "Only patch supplied halo artifact regions during the supplied time window."], validationPlan: { validatorIds: ["white-halo"], requiredValidatorIds: ["white-halo"], preserveValidatorIds: [] } },
    handlePostAssembly: async ({ incident, candidatePath, candidateVersionId }) => {
      if (!candidatePath) return review("MISSING_WHITE_HALO_CANDIDATE"); const temporary = `${candidatePath}.white-halo.tmp.mp4`; const parsed = parseWhiteHaloParameters(incident, candidatePath, temporary); if ("error" in parsed) return review(parsed.error ?? "MISSING_WHITE_HALO_PARAMETER");
      const ffmpegPath = await findSmokeRingFfmpegPath(); if (!ffmpegPath) return review("WHITE_HALO_FFMPEG_NOT_FOUND");
      try { const metadata = await probeSmokeRingVideo(ffmpegPath, candidatePath); const geometry = computeHaloGeometry(parsed.value, metadata); if ("error" in geometry) return review(geometry.error); await renderWhiteHaloCandidate(parsed.value, ffmpegPath, metadata); const { rename } = await import("node:fs/promises"); await rename(temporary, candidatePath); return { status: "REPAIRED", actionsTaken: ["renderLocalScleraWhiteHaloPatchToCandidate"], filesChanged: [candidatePath], affectedScene: parsed.value.sceneNumber, affectedRegion: "halo", warnings: [], validatorsToRecheck: ["white-halo"], preserveRequirements: ["CURRENT output remains unchanged until promote PASS.", "Pupil, gaze, blink and approved effects remain untouched."], auditMetadata: { handlerId: WHITE_HALO_HANDLER_ID, handlerVersion: WHITE_HALO_HANDLER_VERSION, sceneNumber: parsed.value.sceneNumber, eyeRegions: { left: parsed.value.leftEyeRegion, right: parsed.value.rightEyeRegion }, haloRegions: { left: parsed.value.leftHaloRegion, right: parsed.value.rightHaloRegion }, localTimeWindow: { start: parsed.value.effectStartLocalTime, end: parsed.value.effectEndLocalTime }, globalTimeWindow: { start: parsed.value.sceneStart + parsed.value.effectStartLocalTime, end: parsed.value.sceneStart + parsed.value.effectEndLocalTime }, candidateVersionId } }; }
      catch (error) { const message = error instanceof Error ? error.message : String(error); return message === "UNRELIABLE_SCLERA_SAMPLE" ? review(message) : { status: "REPAIR_FAILED", actionsTaken: [], filesChanged: [], affectedScene: parsed.value.sceneNumber, affectedRegion: "halo", warnings: [message], validatorsToRecheck: ["white-halo"], preserveRequirements: ["CURRENT output remains unchanged."] }; }
    },
  };
}
