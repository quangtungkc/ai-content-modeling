import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import type { PostAssemblyRepairHandler, PostAssemblyHandlerOutcome } from "@/modules/troubleshooting/handlers";
import type { TroubleshootingIncident } from "@/modules/troubleshooting/incident-schema";
import type { TroubleshootingRule } from "@/modules/troubleshooting/schema";
import { findSmokeRingFfmpegPath, probeSmokeRingVideo, type SmokeRingVideoMetadata } from "./smoke-ring-handler";

export const BLINK_HANDLER_ID = "blink-deterministic-localized";
export const BLINK_HANDLER_VERSION = "1.0.0";

const eyeRegionSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().positive(), height: z.number().finite().positive(), space: z.enum(["PIXELS", "NORMALIZED"]) });
export const blinkParametersSchema = z.object({
  sceneNumber: z.number().int().positive(),
  sceneStart: z.number().finite().nonnegative(),
  sceneEnd: z.number().finite().positive(),
  blinkStartLocalTime: z.number().finite().nonnegative(),
  blinkCloseTime: z.number().finite().positive(),
  blinkReopenTime: z.number().finite().positive(),
  blinkEndLocalTime: z.number().finite().positive(),
  leftEyeRegion: eyeRegionSchema,
  rightEyeRegion: eyeRegionSchema,
  blinkStrength: z.number().finite().positive().max(1),
  closeAmount: z.number().finite().positive().max(1),
  featherAmount: z.number().finite().nonnegative(),
  interpolation: z.enum(["LINEAR", "SMOOTHSTEP"]),
  candidateInputPath: z.string().min(1),
  candidateOutputPath: z.string().min(1),
});

export type BlinkParameters = z.infer<typeof blinkParametersSchema>;
export type BlinkVideoMetadata = SmokeRingVideoMetadata;
type RgbaColor = { r: number; g: number; b: number };

function stateOf(incident: TroubleshootingIncident) {
  return incident.actualState && typeof incident.actualState === "object" && !Array.isArray(incident.actualState) ? incident.actualState as Record<string, unknown> : {};
}

function parseEyeRegion(value: unknown): BlinkParameters["leftEyeRegion"] | null {
  const parsed = eyeRegionSchema.safeParse(value);
  if (!parsed.success) return null;
  if (parsed.data.space === "NORMALIZED" && (parsed.data.x < 0 || parsed.data.y < 0 || parsed.data.x + parsed.data.width > 1 || parsed.data.y + parsed.data.height > 1)) return null;
  return parsed.data;
}

export function parseBlinkParametersFromState(state: Record<string, unknown>, fallbackSceneNumber: number | null, candidateInputPath: string, candidateOutputPath: string) {
  const candidates = Array.isArray(state.eyeRegionCandidates) ? state.eyeRegionCandidates : [];
  if (state.multipleCharacters === true || candidates.length > 1) return { error: "AMBIGUOUS_BLINK_TARGET" } as const;
  if ((Array.isArray(state.additionalBlinkWindows) && state.additionalBlinkWindows.length > 0) || state.multipleBlinks === true) return { error: "MULTIPLE_BLINK_WINDOWS_UNSUPPORTED" } as const;
  const eyeRegions = state.eyeRegions && typeof state.eyeRegions === "object" && !Array.isArray(state.eyeRegions) ? state.eyeRegions as Record<string, unknown> : {};
  const affectedRegion = state.affectedRegion && typeof state.affectedRegion === "object" && !Array.isArray(state.affectedRegion) ? state.affectedRegion as Record<string, unknown> : {};
  const leftEyeRegion = parseEyeRegion(state.leftEyeRegion) ?? parseEyeRegion(eyeRegions.left) ?? parseEyeRegion(affectedRegion.leftEyeRegion) ?? parseEyeRegion(affectedRegion.left);
  const rightEyeRegion = parseEyeRegion(state.rightEyeRegion) ?? parseEyeRegion(eyeRegions.right) ?? parseEyeRegion(affectedRegion.rightEyeRegion) ?? parseEyeRegion(affectedRegion.right);
  if (!leftEyeRegion || !rightEyeRegion) return { error: "MISSING_EYE_REGION" } as const;
  const parsed = blinkParametersSchema.safeParse({
    sceneNumber: state.sceneNumber ?? fallbackSceneNumber,
    sceneStart: state.sceneStart,
    sceneEnd: state.sceneEnd,
    blinkStartLocalTime: state.blinkStartLocalTime,
    blinkCloseTime: state.blinkCloseTime,
    blinkReopenTime: state.blinkReopenTime,
    blinkEndLocalTime: state.blinkEndLocalTime,
    leftEyeRegion,
    rightEyeRegion,
    blinkStrength: state.blinkStrength ?? 0.95,
    closeAmount: state.closeAmount ?? 1,
    featherAmount: state.featherAmount ?? 3,
    interpolation: state.interpolation ?? "SMOOTHSTEP",
    candidateInputPath,
    candidateOutputPath,
  });
  if (!parsed.success) return { error: "MISSING_BLINK_PARAMETER", details: parsed.error.issues.map(issue => issue.path.join(".")).join(",") } as const;
  const value = parsed.data;
  const duration = value.sceneEnd - value.sceneStart;
  if (!(value.blinkStartLocalTime < value.blinkCloseTime && value.blinkCloseTime <= value.blinkReopenTime && value.blinkReopenTime < value.blinkEndLocalTime) || value.blinkEndLocalTime > duration) return { error: "INVALID_BLINK_TIME_WINDOW" } as const;
  return { value } as const;
}

export function parseBlinkParameters(incident: TroubleshootingIncident, candidateInputPath: string, candidateOutputPath: string) {
  return parseBlinkParametersFromState(stateOf(incident), incident.sceneNumber, candidateInputPath, candidateOutputPath);
}

function regionPixels(region: BlinkParameters["leftEyeRegion"], metadata: BlinkVideoMetadata) {
  return region.space === "NORMALIZED"
    ? { x: region.x * metadata.width, y: region.y * metadata.height, width: region.width * metadata.width, height: region.height * metadata.height }
    : region;
}

function regionsFitVideo(parameters: BlinkParameters, metadata: BlinkVideoMetadata) {
  return [parameters.leftEyeRegion, parameters.rightEyeRegion].every(region => {
    const pixels = regionPixels(region, metadata);
    return pixels.x >= 0 && pixels.y >= 0 && pixels.x + pixels.width <= metadata.width && pixels.y + pixels.height <= metadata.height;
  });
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function interpolate(value: number, mode: BlinkParameters["interpolation"]) {
  return mode === "SMOOTHSTEP" ? value * value * (3 - 2 * value) : value;
}

export function createBlinkFrame(parameters: BlinkParameters, metadata: BlinkVideoMetadata, globalTime: number, colors: [RgbaColor, RgbaColor] = [{ r: 180, g: 180, b: 180 }, { r: 180, g: 180, b: 180 }], openReferenceFrame?: Buffer) {
  const frame = Buffer.alloc(metadata.width * metadata.height * 4);
  const localTime = globalTime - parameters.sceneStart;
  let coverage = 0;
  if (localTime >= parameters.blinkStartLocalTime && localTime <= parameters.blinkCloseTime) coverage = interpolate(clamp((localTime - parameters.blinkStartLocalTime) / (parameters.blinkCloseTime - parameters.blinkStartLocalTime), 0, 1), parameters.interpolation);
  else if (localTime > parameters.blinkCloseTime && localTime < parameters.blinkReopenTime) coverage = 1;
  else if (localTime >= parameters.blinkReopenTime && localTime <= parameters.blinkEndLocalTime) coverage = 1 - interpolate(clamp((localTime - parameters.blinkReopenTime) / (parameters.blinkEndLocalTime - parameters.blinkReopenTime), 0, 1), parameters.interpolation);
  const regions = [parameters.leftEyeRegion, parameters.rightEyeRegion].map(region => regionPixels(region, metadata));
  if (openReferenceFrame && localTime >= parameters.blinkReopenTime) {
    const restoration = interpolate(clamp((localTime - parameters.blinkReopenTime) / (parameters.blinkEndLocalTime - parameters.blinkReopenTime), 0, 1), parameters.interpolation);
    regions.forEach(region => {
      const minX = Math.max(0, Math.floor(region.x));
      const maxX = Math.min(metadata.width - 1, Math.ceil(region.x + region.width));
      const minY = Math.max(0, Math.floor(region.y));
      const maxY = Math.min(metadata.height - 1, Math.ceil(region.y + region.height));
      for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
        const offset = (y * metadata.width + x) * 4;
        frame[offset] = openReferenceFrame[offset];
        frame[offset + 1] = openReferenceFrame[offset + 1];
        frame[offset + 2] = openReferenceFrame[offset + 2];
        frame[offset + 3] = Math.round(255 * restoration);
      }
    });
    return frame;
  }
  if (coverage <= 0) return frame;
  regions.forEach((region, index) => {
    const color = colors[index];
    const minX = Math.max(0, Math.floor(region.x));
    const maxX = Math.min(metadata.width - 1, Math.ceil(region.x + region.width));
    const minY = Math.max(0, Math.floor(region.y));
    const maxY = Math.min(metadata.height - 1, Math.ceil(region.y + region.height));
    for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
      const edge = Math.min(x - region.x, region.x + region.width - x, y - region.y, region.y + region.height - y);
      const feather = parameters.featherAmount ? clamp(edge / parameters.featherAmount, 0, 1) : 1;
      const alpha = Math.round(255 * parameters.blinkStrength * parameters.closeAmount * coverage * feather);
      const offset = (y * metadata.width + x) * 4;
      frame[offset] = color.r;
      frame[offset + 1] = color.g;
      frame[offset + 2] = color.b;
      frame[offset + 3] = alpha;
    }
  });
  return frame;
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
      const bytes = metadata.width * metadata.height * 4;
      if (code !== 0 || frame.length < bytes) reject(new Error(`BLINK_FRAME_READ_FAILED:${stderr.slice(-500)}`));
      else resolve(frame.subarray(0, bytes));
    });
  });
}

async function cornerColors(ffmpegPath: string, filePath: string, metadata: BlinkVideoMetadata, parameters: BlinkParameters): Promise<[RgbaColor, RgbaColor]> {
  const frame = await readFrame(ffmpegPath, filePath, parameters.sceneStart + Math.max(0, parameters.blinkStartLocalTime - 0.05), metadata);
  return [parameters.leftEyeRegion, parameters.rightEyeRegion].map(region => {
    const pixels = regionPixels(region, metadata);
    const points = [[pixels.x + 1, pixels.y + 1], [pixels.x + pixels.width - 2, pixels.y + 1], [pixels.x + 1, pixels.y + pixels.height - 2], [pixels.x + pixels.width - 2, pixels.y + pixels.height - 2]];
    const color = points.reduce((sum, [x, y]) => { const offset = (Math.floor(y) * metadata.width + Math.floor(x)) * 4; return { r: sum.r + frame[offset], g: sum.g + frame[offset + 1], b: sum.b + frame[offset + 2] }; }, { r: 0, g: 0, b: 0 });
    return { r: Math.round(color.r / points.length), g: Math.round(color.g / points.length), b: Math.round(color.b / points.length) };
  }) as [RgbaColor, RgbaColor];
}

async function writeFrame(stream: NodeJS.WritableStream, frame: Buffer) {
  if (stream.write(frame)) return;
  await new Promise<void>(resolve => stream.once("drain", resolve));
}

async function normalizeMp4Timestamps(filePath: string) {
  const bytes = await readFile(filePath);
  const fixedTimestamp = BigInt(Math.floor(Date.parse("2000-01-01T00:00:00.000Z") / 1000) + 2_082_844_800);
  for (let nameOffset = 4; nameOffset + 4 < bytes.length; nameOffset += 1) {
    const name = bytes.toString("ascii", nameOffset, nameOffset + 4);
    if (!(name === "mvhd" || name === "tkhd" || name === "mdhd")) continue;
    const atomOffset = nameOffset - 4;
    const atomSize = bytes.readUInt32BE(atomOffset);
    if (atomSize < 24 || atomOffset + atomSize > bytes.length) continue;
    const version = bytes[nameOffset + 4];
    if (version === 0) {
      bytes.writeUInt32BE(Number(fixedTimestamp), nameOffset + 8);
      bytes.writeUInt32BE(Number(fixedTimestamp), nameOffset + 12);
    } else if (version === 1 && nameOffset + 24 <= bytes.length) {
      bytes.writeBigUInt64BE(fixedTimestamp, nameOffset + 8);
      bytes.writeBigUInt64BE(fixedTimestamp, nameOffset + 16);
    }
  }
  await writeFile(filePath, bytes);
}

export async function renderBlinkCandidate(parameters: BlinkParameters, ffmpegPath: string, metadata?: BlinkVideoMetadata) {
  const videoMetadata = metadata ?? await probeSmokeRingVideo(ffmpegPath, parameters.candidateInputPath);
  const colors = await cornerColors(ffmpegPath, parameters.candidateInputPath, videoMetadata, parameters);
  const openReferenceFrame = await readFrame(ffmpegPath, parameters.candidateInputPath, parameters.sceneStart + Math.max(0, parameters.blinkStartLocalTime - 0.05), videoMetadata);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", parameters.candidateInputPath, "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${videoMetadata.width}x${videoMetadata.height}`, "-framerate", String(videoMetadata.fps), "-i", "pipe:0", "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:eof_action=repeat[outv]", "-map", "[outv]", "-map", "0:a?", "-t", String(videoMetadata.duration), "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", "-threads", "1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1", "-metadata", "creation_time=1970-01-01T00:00:00Z", "-metadata:s:v:0", "creation_time=1970-01-01T00:00:00Z", "-c:a", "copy", "-movflags", "+faststart", parameters.candidateOutputPath];
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const completion = new Promise<void>((resolve, reject) => { child.once("error", reject); child.once("close", code => code === 0 ? resolve() : reject(new Error(`BLINK_FFMPEG_FAILED:${stderr.slice(-2_000)}`))); });
  const frameCount = Math.ceil(videoMetadata.duration * videoMetadata.fps) + 2;
  for (let index = 0; index < frameCount; index += 1) await writeFrame(child.stdin, createBlinkFrame(parameters, videoMetadata, index / videoMetadata.fps, colors, openReferenceFrame));
  child.stdin.end();
  await completion;
  await normalizeMp4Timestamps(parameters.candidateOutputPath);
  return videoMetadata;
}

function missingOutcome(reason: string): PostAssemblyHandlerOutcome {
  return { status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], affectedScene: null, affectedRegion: "eyes", warnings: [reason], validatorsToRecheck: ["blink"], preserveRequirements: ["Do not modify CURRENT output.", "Do not move pupils or change gaze."] };
}

export function createBlinkPostAssemblyHandler(): PostAssemblyRepairHandler {
  const rulePlaceholder = { issueId: "BLINK_DOES_NOT_REOPEN" } as TroubleshootingRule;
  return {
    issueId: rulePlaceholder.issueId,
    mode: "AUTO",
    handle: async () => ({ status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], stateChanged: {}, validationSignals: {}, warnings: ["Blink handler chỉ được gọi qua Post-Assembly coordinator."], nextAction: "Use PostAssemblyRepairCoordinator." }),
    postAssembly: { handlerId: BLINK_HANDLER_ID, handlerVersion: BLINK_HANDLER_VERSION, supportsPostAssembly: true, repairScope: "FRAME_REGION", mutatesOutputFile: true, requiresCandidate: true, supportedValidatorIds: ["blink", "BLINK_DOES_NOT_REOPEN", "visual-artifacts", "post-assembly-visual"], preserveRequirements: ["Preserve gaze, pupil identity, smoke ring, clothing, monitor, background and other scenes.", "Only modify the supplied left/right eye regions within the supplied blink window."], validationPlan: { validatorIds: ["blink"], requiredValidatorIds: ["blink"], preserveValidatorIds: [] } },
    handlePostAssembly: async ({ incident, candidatePath }) => {
      if (!candidatePath) return missingOutcome("MISSING_BLINK_CANDIDATE");
      const temporaryOutputPath = `${candidatePath}.blink.tmp.mp4`;
      const parsed = parseBlinkParameters(incident, candidatePath, temporaryOutputPath);
      if ("error" in parsed) return missingOutcome(parsed.error ?? "MISSING_BLINK_PARAMETER");
      const ffmpegPath = await findSmokeRingFfmpegPath();
      if (!ffmpegPath) return missingOutcome("BLINK_FFMPEG_NOT_FOUND");
      try {
        const metadata = await probeSmokeRingVideo(ffmpegPath, parsed.value.candidateInputPath);
        if (!regionsFitVideo(parsed.value, metadata)) return missingOutcome("INVALID_EYE_REGION_BOUNDS");
        await renderBlinkCandidate(parsed.value, ffmpegPath, metadata);
        const { rename } = await import("node:fs/promises");
        await rename(temporaryOutputPath, candidatePath);
        return { status: "REPAIRED", actionsTaken: ["renderDeterministicBlinkToCandidate"], filesChanged: [candidatePath], affectedScene: parsed.value.sceneNumber, affectedRegion: "eyes", warnings: [], validatorsToRecheck: ["blink"], preserveRequirements: ["CURRENT output remains unchanged until promote PASS.", "Do not move pupils or change gaze."], auditMetadata: { handlerId: BLINK_HANDLER_ID, handlerVersion: BLINK_HANDLER_VERSION, sceneNumber: parsed.value.sceneNumber, localTimeWindow: { start: parsed.value.blinkStartLocalTime, close: parsed.value.blinkCloseTime, reopen: parsed.value.blinkReopenTime, end: parsed.value.blinkEndLocalTime }, globalTimeWindow: { start: parsed.value.sceneStart + parsed.value.blinkStartLocalTime, end: parsed.value.sceneStart + parsed.value.blinkEndLocalTime }, eyeRegions: { left: parsed.value.leftEyeRegion, right: parsed.value.rightEyeRegion }, parameters: { blinkStrength: parsed.value.blinkStrength, closeAmount: parsed.value.closeAmount, featherAmount: parsed.value.featherAmount, interpolation: parsed.value.interpolation } } };
      } catch (error) {
        return { status: "REPAIR_FAILED", actionsTaken: [], filesChanged: [], affectedScene: parsed.value.sceneNumber, affectedRegion: "eyes", warnings: [error instanceof Error ? error.message : String(error)], validatorsToRecheck: ["blink"], preserveRequirements: ["CURRENT output remains unchanged."] };
      }
    },
  };
}
