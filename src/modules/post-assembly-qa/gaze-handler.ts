import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { PostAssemblyHandlerOutcome, PostAssemblyRepairHandler } from "@/modules/troubleshooting/handlers";
import type { TroubleshootingIncident } from "@/modules/troubleshooting/incident-schema";
import type { TroubleshootingRule } from "@/modules/troubleshooting/schema";
import { findSmokeRingFfmpegPath, probeSmokeRingVideo, type SmokeRingVideoMetadata } from "./smoke-ring-handler";

export const GAZE_HANDLER_ID = "gaze-deterministic-localized";
export const GAZE_HANDLER_VERSION = "1.0.0";

const regionSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), space: z.enum(["PIXELS", "NORMALIZED"]) });
const anchorSchema = z.object({ x: z.number().finite(), y: z.number().finite(), space: z.enum(["PIXELS", "NORMALIZED"]), width: z.number().finite().positive().optional(), height: z.number().finite().positive().optional(), radius: z.number().finite().positive().optional() });
const blinkWindowSchema = z.object({ startLocalTime: z.number().finite().nonnegative(), endLocalTime: z.number().finite().positive() });

export const gazeParametersSchema = z.object({
  sceneNumber: z.number().int().positive(),
  sceneStart: z.number().finite().nonnegative(),
  sceneEnd: z.number().finite().positive(),
  effectStartLocalTime: z.number().finite().nonnegative(),
  effectEndLocalTime: z.number().finite().positive(),
  leftEyeRegion: regionSchema,
  rightEyeRegion: regionSchema,
  leftPupilRegion: regionSchema,
  rightPupilRegion: regionSchema,
  targetAnchor: anchorSchema,
  pupilShiftX: z.number().finite().optional(),
  pupilShiftY: z.number().finite().optional(),
  maxShift: z.number().finite().positive().optional(),
  featherAmount: z.number().finite().nonnegative(),
  interpolation: z.enum(["LINEAR", "SMOOTHSTEP"]),
  blinkWindowsToPreserve: z.array(blinkWindowSchema),
  candidateInputPath: z.string().min(1),
  candidateOutputPath: z.string().min(1),
});

export type GazeParameters = z.infer<typeof gazeParametersSchema>;
export type GazeVideoMetadata = SmokeRingVideoMetadata;
export type PixelRegion = { x: number; y: number; width: number; height: number };
export type GazeGeometry = { leftEye: PixelRegion; rightEye: PixelRegion; leftOldPupil: PixelRegion; rightOldPupil: PixelRegion; leftNewPupil: PixelRegion; rightNewPupil: PixelRegion; target: { x: number; y: number }; movement: { left: { x: number; y: number }; right: { x: number; y: number } } };
export type GazeStyle = { sclera: { r: number; g: number; b: number }; pupil: { r: number; g: number; b: number } };

function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }
function interpolate(value: number, mode: GazeParameters["interpolation"]) { return mode === "SMOOTHSTEP" ? value * value * (3 - 2 * value) : value; }

function parseRegion(value: unknown): GazeParameters["leftEyeRegion"] | null {
  const parsed = regionSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.space === "NORMALIZED" && (parsed.data.x < 0 || parsed.data.y < 0 || parsed.data.x + parsed.data.width > 1 || parsed.data.y + parsed.data.height > 1)) return null;
  return parsed.data;
}

function regionFromAnchor(value: unknown): GazeParameters["leftPupilRegion"] | null {
  const parsed = anchorSchema.safeParse(value);
  if (!parsed.success) return null;
  const width = parsed.data.width ?? (parsed.data.radius ? parsed.data.radius * 2 : null);
  const height = parsed.data.height ?? (parsed.data.radius ? parsed.data.radius * 2 : null);
  if (!width || !height) return null;
  return { x: parsed.data.x - width / 2, y: parsed.data.y - height / 2, width, height, space: parsed.data.space };
}

function targetFromState(state: Record<string, unknown>): z.infer<typeof anchorSchema> | null {
  const direct = anchorSchema.safeParse(state.targetAnchor ?? state.monitorAnchor);
  if (direct.success) return direct.data;
  const targetRegion = parseRegion(state.targetRegion) ?? parseRegion(state.monitorRegion);
  return targetRegion ? { x: targetRegion.x + targetRegion.width / 2, y: targetRegion.y + targetRegion.height / 2, space: targetRegion.space } : null;
}

export function parseGazeParametersFromState(state: Record<string, unknown>, fallbackSceneNumber: number | null, candidateInputPath: string, candidateOutputPath: string) {
  const candidates = Array.isArray(state.faceCandidates) ? state.faceCandidates : [];
  if (state.multipleCharacters === true || candidates.length > 1) return { error: "AMBIGUOUS_GAZE_TARGET" } as const;
  if (state.preexistingWhiteHalo === true || state.whiteHaloPresent === true || state.preexistingDoublePupil === true || state.doublePupilPresent === true || state.independentGazeArtifact === true) return { error: "INDEPENDENT_GAZE_ARTIFACT_PRESENT" } as const;
  const eyeRegions = record(state.eyeRegions);
  const pupilRegions = record(state.pupilRegions);
  const leftEyeRegion = parseRegion(state.leftEyeRegion) ?? parseRegion(eyeRegions.left);
  const rightEyeRegion = parseRegion(state.rightEyeRegion) ?? parseRegion(eyeRegions.right);
  const leftPupilRegion = parseRegion(state.leftPupilRegion) ?? parseRegion(pupilRegions.left) ?? regionFromAnchor(state.leftPupilAnchor);
  const rightPupilRegion = parseRegion(state.rightPupilRegion) ?? parseRegion(pupilRegions.right) ?? regionFromAnchor(state.rightPupilAnchor);
  const targetAnchor = targetFromState(state);
  if (!leftEyeRegion || !rightEyeRegion || !leftPupilRegion || !rightPupilRegion) return { error: "MISSING_EYE_OR_PUPIL_REGION" } as const;
  if (!targetAnchor) return { error: "MISSING_GAZE_TARGET" } as const;
  const parsed = gazeParametersSchema.safeParse({
    sceneNumber: state.sceneNumber ?? fallbackSceneNumber,
    sceneStart: state.sceneStart,
    sceneEnd: state.sceneEnd,
    effectStartLocalTime: state.effectStartLocalTime,
    effectEndLocalTime: state.effectEndLocalTime,
    leftEyeRegion,
    rightEyeRegion,
    leftPupilRegion,
    rightPupilRegion,
    targetAnchor,
    pupilShiftX: state.pupilShiftX,
    pupilShiftY: state.pupilShiftY,
    maxShift: state.maxShift,
    featherAmount: state.featherAmount ?? 1.5,
    interpolation: state.interpolation ?? "SMOOTHSTEP",
    blinkWindowsToPreserve: Array.isArray(state.blinkWindowsToPreserve) ? state.blinkWindowsToPreserve : [],
    candidateInputPath,
    candidateOutputPath,
  });
  if (!parsed.success) return { error: "MISSING_GAZE_PARAMETER", details: parsed.error.issues.map(issue => issue.path.join(".")).join(",") } as const;
  const value = parsed.data;
  const duration = value.sceneEnd - value.sceneStart;
  if (!(value.effectStartLocalTime < value.effectEndLocalTime) || value.effectEndLocalTime > duration || value.blinkWindowsToPreserve.some(window => !(window.startLocalTime < window.endLocalTime) || window.endLocalTime > duration)) return { error: "INVALID_GAZE_TIME_WINDOW" } as const;
  return { value } as const;
}

export function parseGazeParameters(incident: TroubleshootingIncident, candidateInputPath: string, candidateOutputPath: string) {
  const state = record(incident.actualState);
  return parseGazeParametersFromState(state, incident.sceneNumber, candidateInputPath, candidateOutputPath);
}

export function regionPixels(region: GazeParameters["leftEyeRegion"], metadata: GazeVideoMetadata): PixelRegion {
  return region.space === "NORMALIZED" ? { x: region.x * metadata.width, y: region.y * metadata.height, width: region.width * metadata.width, height: region.height * metadata.height } : region;
}
function anchorPixels(anchor: GazeParameters["targetAnchor"], metadata: GazeVideoMetadata) { return anchor.space === "NORMALIZED" ? { x: anchor.x * metadata.width, y: anchor.y * metadata.height } : { x: anchor.x, y: anchor.y }; }
function center(region: PixelRegion) { return { x: region.x + region.width / 2, y: region.y + region.height / 2 }; }
function inside(region: PixelRegion, eye: PixelRegion) { return region.x >= eye.x && region.y >= eye.y && region.x + region.width <= eye.x + eye.width && region.y + region.height <= eye.y + eye.height; }

export function computeGazeGeometry(parameters: GazeParameters, metadata: GazeVideoMetadata): GazeGeometry | { error: string } {
  const leftEye = regionPixels(parameters.leftEyeRegion, metadata);
  const rightEye = regionPixels(parameters.rightEyeRegion, metadata);
  const leftOldPupil = regionPixels(parameters.leftPupilRegion, metadata);
  const rightOldPupil = regionPixels(parameters.rightPupilRegion, metadata);
  const target = anchorPixels(parameters.targetAnchor, metadata);
  if (![leftEye, rightEye, leftOldPupil, rightOldPupil].every(region => inside(region, { x: 0, y: 0, width: metadata.width, height: metadata.height })) || !inside(leftOldPupil, leftEye) || !inside(rightOldPupil, rightEye) || target.x < 0 || target.y < 0 || target.x > metadata.width || target.y > metadata.height) return { error: "INVALID_GAZE_GEOMETRY" };
  const move = (eye: PixelRegion, pupil: PixelRegion) => {
    const origin = center(pupil);
    const vector = { x: target.x - origin.x, y: target.y - origin.y };
    const distance = Math.hypot(vector.x, vector.y);
    if (!distance) return { error: "GAZE_TARGET_DIRECTION_UNDETERMINED" } as const;
    const maxShift = parameters.maxShift ?? Math.min(eye.width, eye.height) * 0.42;
    const requested = parameters.pupilShiftX !== undefined || parameters.pupilShiftY !== undefined
      ? { x: parameters.pupilShiftX ?? 0, y: parameters.pupilShiftY ?? 0 }
      : { x: vector.x / distance * Math.min(Math.min(eye.width, eye.height) * 0.32, maxShift), y: vector.y / distance * Math.min(Math.min(eye.width, eye.height) * 0.32, maxShift) };
    const magnitude = Math.hypot(requested.x, requested.y);
    if (magnitude > maxShift || requested.x * vector.x + requested.y * vector.y <= 0) return { error: "UNSAFE_PUPIL_SHIFT" } as const;
    const next = { ...pupil, x: pupil.x + requested.x, y: pupil.y + requested.y };
    const margin = Math.max(1, parameters.featherAmount);
    if (!inside({ x: next.x - margin, y: next.y - margin, width: next.width + margin * 2, height: next.height + margin * 2 }, eye)) return { error: "UNSAFE_PUPIL_SHIFT" } as const;
    return { next, requested } as const;
  };
  const left = move(leftEye, leftOldPupil);
  const right = move(rightEye, rightOldPupil);
  if ("error" in left && left.error) return { error: left.error };
  if ("error" in right && right.error) return { error: right.error };
  return { leftEye, rightEye, leftOldPupil, rightOldPupil, leftNewPupil: left.next, rightNewPupil: right.next, target, movement: { left: left.requested, right: right.requested } };
}

function readFrame(ffmpegPath: string, filePath: string, time: number, metadata: GazeVideoMetadata) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(ffmpegPath, ["-hide_banner", "-loglevel", "error", "-ss", Math.max(0, time).toFixed(3), "-i", filePath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", chunk => chunks.push(Buffer.from(chunk)));
    child.stderr.on("data", chunk => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", code => {
      const frame = Buffer.concat(chunks);
      const bytes = metadata.width * metadata.height * 4;
      if (code !== 0 || frame.length < bytes) reject(new Error(`GAZE_FRAME_READ_FAILED:${stderr.slice(-500)}`));
      else resolve(frame.subarray(0, bytes));
    });
  });
}

function average(frame: Buffer, metadata: GazeVideoMetadata, region: PixelRegion, predicate: (x: number, y: number) => boolean) {
  let r = 0; let g = 0; let b = 0; let count = 0;
  for (let y = Math.max(0, Math.floor(region.y)); y < Math.min(metadata.height, Math.ceil(region.y + region.height)); y += 1) for (let x = Math.max(0, Math.floor(region.x)); x < Math.min(metadata.width, Math.ceil(region.x + region.width)); x += 1) {
    if (!predicate(x, y)) continue;
    const offset = (y * metadata.width + x) * 4;
    r += frame[offset]; g += frame[offset + 1]; b += frame[offset + 2]; count += 1;
  }
  return count ? { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) } : null;
}

function inEllipse(x: number, y: number, region: PixelRegion, grow = 0) {
  const cx = region.x + region.width / 2; const cy = region.y + region.height / 2;
  const rx = region.width / 2 + grow; const ry = region.height / 2 + grow;
  return ((x - cx) ** 2) / (rx ** 2) + ((y - cy) ** 2) / (ry ** 2) <= 1;
}

export function sampleGazeStyles(frame: Buffer, metadata: GazeVideoMetadata, geometry: GazeGeometry): [GazeStyle, GazeStyle] | null {
  const sample = (eye: PixelRegion, pupil: PixelRegion) => {
    const pupilColor = average(frame, metadata, pupil, () => true);
    const scleraColor = average(frame, metadata, eye, (x, y) => !inEllipse(x, y, pupil, 1));
    return pupilColor && scleraColor ? { pupil: pupilColor, sclera: scleraColor } : null;
  };
  const left = sample(geometry.leftEye, geometry.leftOldPupil);
  const right = sample(geometry.rightEye, geometry.rightOldPupil);
  return left && right ? [left, right] : null;
}

function paintEllipse(frame: Buffer, metadata: GazeVideoMetadata, region: PixelRegion, color: { r: number; g: number; b: number }, feather: number) {
  if (region.width <= 0 || region.height <= 0) return;
  const cx = region.x + region.width / 2; const cy = region.y + region.height / 2;
  const rx = region.width / 2; const ry = region.height / 2;
  for (let y = Math.max(0, Math.floor(region.y - feather)); y < Math.min(metadata.height, Math.ceil(region.y + region.height + feather)); y += 1) for (let x = Math.max(0, Math.floor(region.x - feather)); x < Math.min(metadata.width, Math.ceil(region.x + region.width + feather)); x += 1) {
    const distance = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
    if (distance > 1 + feather / Math.max(rx, ry)) continue;
    const alpha = Math.round(255 * clamp((1 + feather / Math.max(rx, ry) - distance) / Math.max(feather / Math.max(rx, ry), 0.0001), 0, 1));
    const offset = (y * metadata.width + x) * 4;
    frame[offset] = color.r; frame[offset + 1] = color.g; frame[offset + 2] = color.b; frame[offset + 3] = alpha;
  }
}

export function createGazeFrame(parameters: GazeParameters, metadata: GazeVideoMetadata, globalTime: number, geometry: GazeGeometry, styles: [GazeStyle, GazeStyle]) {
  const frame = Buffer.alloc(metadata.width * metadata.height * 4);
  const local = globalTime - parameters.sceneStart;
  if (local < parameters.effectStartLocalTime || local > parameters.effectEndLocalTime || parameters.blinkWindowsToPreserve.some(window => local >= window.startLocalTime && local <= window.endLocalTime)) return frame;
  const progress = interpolate(clamp((local - parameters.effectStartLocalTime) / Math.max(0.001, Math.min(0.12, (parameters.effectEndLocalTime - parameters.effectStartLocalTime) / 2)), 0, 1), parameters.interpolation);
  if (progress <= 0) return frame;
  const layers: Array<[PixelRegion, PixelRegion, GazeStyle]> = [[geometry.leftOldPupil, geometry.leftNewPupil, styles[0]], [geometry.rightOldPupil, geometry.rightNewPupil, styles[1]]];
  layers.forEach(([oldPupil, newPupil, style]) => {
    paintEllipse(frame, metadata, oldPupil, style.sclera, parameters.featherAmount + 1);
    const scaled = { ...newPupil, width: newPupil.width * progress, height: newPupil.height * progress, x: newPupil.x + (newPupil.width * (1 - progress)) / 2, y: newPupil.y + (newPupil.height * (1 - progress)) / 2 };
    paintEllipse(frame, metadata, scaled, style.pupil, parameters.featherAmount);
  });
  return frame;
}

async function writeFrame(stream: NodeJS.WritableStream, frame: Buffer) { if (stream.write(frame)) return; await new Promise<void>(resolve => stream.once("drain", resolve)); }

async function normalizeMp4Timestamps(filePath: string) {
  const bytes = await readFile(filePath);
  const fixed = BigInt(Math.floor(Date.parse("2000-01-01T00:00:00.000Z") / 1000) + 2_082_844_800);
  for (let offset = 4; offset + 4 < bytes.length; offset += 1) {
    const name = bytes.toString("ascii", offset, offset + 4);
    if (!(name === "mvhd" || name === "tkhd" || name === "mdhd")) continue;
    const atom = offset - 4; const size = bytes.readUInt32BE(atom);
    if (size < 24 || atom + size > bytes.length) continue;
    if (bytes[offset + 4] === 0) { bytes.writeUInt32BE(Number(fixed), offset + 8); bytes.writeUInt32BE(Number(fixed), offset + 12); }
    else if (bytes[offset + 4] === 1 && offset + 24 <= bytes.length) { bytes.writeBigUInt64BE(fixed, offset + 8); bytes.writeBigUInt64BE(fixed, offset + 16); }
  }
  await writeFile(filePath, bytes);
}

export async function renderGazeCandidate(parameters: GazeParameters, ffmpegPath: string, metadata?: GazeVideoMetadata) {
  const video = metadata ?? await probeSmokeRingVideo(ffmpegPath, parameters.candidateInputPath);
  const computed = computeGazeGeometry(parameters, video);
  if ("error" in computed) throw new Error(computed.error);
  const reference = await readFrame(ffmpegPath, parameters.candidateInputPath, parameters.sceneStart + Math.max(0, parameters.effectStartLocalTime - 0.05), video);
  const sampled = sampleGazeStyles(reference, video, computed);
  if (!sampled || sampled.some(style => !style)) throw new Error("LOCAL_SCLERA_OR_PUPIL_STYLE_UNAVAILABLE");
  const styles = sampled as [GazeStyle, GazeStyle];
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", parameters.candidateInputPath, "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${video.width}x${video.height}`, "-framerate", String(video.fps), "-i", "pipe:0", "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:eof_action=repeat[outv]", "-map", "[outv]", "-map", "0:a?", "-t", String(video.duration), "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", "-threads", "1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1", "-c:a", "copy", "-movflags", "+faststart", parameters.candidateOutputPath];
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = ""; child.stderr.on("data", chunk => { stderr += String(chunk); });
  const completion = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(`GAZE_FFMPEG_FAILED:${stderr.slice(-2_000)}`))); });
  const count = Math.ceil(video.duration * video.fps) + 2;
  for (let index = 0; index < count; index += 1) await writeFrame(child.stdin, createGazeFrame(parameters, video, index / video.fps, computed, styles));
  child.stdin.end();
  await completion;
  await normalizeMp4Timestamps(parameters.candidateOutputPath);
  return { video, geometry: computed, styles };
}

function review(reason: string): PostAssemblyHandlerOutcome { return { status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], affectedScene: null, affectedRegion: "eyes", warnings: [reason], validatorsToRecheck: ["gaze"], preserveRequirements: ["Do not modify CURRENT output.", "Preserve blink windows and approved effects."] }; }

export function createGazePostAssemblyHandler(): PostAssemblyRepairHandler {
  return {
    issueId: "GAZE_NOT_TO_MONITOR",
    mode: "AUTO",
    handle: async () => ({ status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], stateChanged: {}, validationSignals: {}, warnings: ["Gaze handler chỉ được gọi qua Post-Assembly coordinator."], nextAction: "Use PostAssemblyRepairCoordinator." }),
    postAssembly: { handlerId: GAZE_HANDLER_ID, handlerVersion: GAZE_HANDLER_VERSION, supportsPostAssembly: true, repairScope: "FRAME_REGION", mutatesOutputFile: true, requiresCandidate: true, supportedValidatorIds: ["gaze", "GAZE_NOT_TO_MONITOR", "visual-artifacts", "post-assembly-visual"], preserveRequirements: ["Preserve blink windows, smoke/effects, face identity, clothing, monitor, background and other scenes.", "Only modify supplied pupil regions within the supplied gaze time window."], validationPlan: { validatorIds: ["gaze"], requiredValidatorIds: ["gaze"], preserveValidatorIds: [] } },
    handlePostAssembly: async ({ incident, candidatePath, candidateVersionId }) => {
      if (!candidatePath) return review("MISSING_GAZE_CANDIDATE");
      const temporary = `${candidatePath}.gaze.tmp.mp4`;
      const parsed = parseGazeParameters(incident, candidatePath, temporary);
      if ("error" in parsed) return review(parsed.error ?? "MISSING_GAZE_PARAMETER");
      const ffmpegPath = await findSmokeRingFfmpegPath();
      if (!ffmpegPath) return review("GAZE_FFMPEG_NOT_FOUND");
      try {
        const metadata = await probeSmokeRingVideo(ffmpegPath, candidatePath);
        const geometry = computeGazeGeometry(parsed.value, metadata);
        if ("error" in geometry) return review(geometry.error);
        await renderGazeCandidate(parsed.value, ffmpegPath, metadata);
        const { rename } = await import("node:fs/promises");
        await rename(temporary, candidatePath);
        return { status: "REPAIRED", actionsTaken: ["renderDeterministicGazeToCandidate"], filesChanged: [candidatePath], affectedScene: parsed.value.sceneNumber, affectedRegion: "eyes", warnings: [], validatorsToRecheck: ["gaze"], preserveRequirements: ["CURRENT output remains unchanged until promote PASS.", "Blink windows and approved effects remain untouched."], auditMetadata: { handlerId: GAZE_HANDLER_ID, handlerVersion: GAZE_HANDLER_VERSION, sceneNumber: parsed.value.sceneNumber, eyeRegions: { left: parsed.value.leftEyeRegion, right: parsed.value.rightEyeRegion }, oldPupilRegions: { left: parsed.value.leftPupilRegion, right: parsed.value.rightPupilRegion }, targetAnchor: parsed.value.targetAnchor, computedPupilMovement: geometry.movement, localTimeWindow: { start: parsed.value.effectStartLocalTime, end: parsed.value.effectEndLocalTime }, globalTimeWindow: { start: parsed.value.sceneStart + parsed.value.effectStartLocalTime, end: parsed.value.sceneStart + parsed.value.effectEndLocalTime }, candidateVersionId } };
      } catch (error) {
        return { status: "REPAIR_FAILED", actionsTaken: [], filesChanged: [], affectedScene: parsed.value.sceneNumber, affectedRegion: "eyes", warnings: [error instanceof Error ? error.message : String(error)], validatorsToRecheck: ["gaze"], preserveRequirements: ["CURRENT output remains unchanged."] };
      }
    },
  };
}
