import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { PostAssemblyRepairHandler, PostAssemblyHandlerOutcome } from "@/modules/troubleshooting/handlers";
import type { TroubleshootingIncident } from "@/modules/troubleshooting/incident-schema";
import type { TroubleshootingRule } from "@/modules/troubleshooting/schema";
import { normalizeMp4Timestamps } from "./white-halo-handler";

const execFileAsync = promisify(execFile);

export const SMOKE_RING_HANDLER_ID = "flow-smoke-ring-deterministic";
export const SMOKE_RING_HANDLER_VERSION = "1.0.0";

const anchorSchema = z.object({ x: z.number().finite(), y: z.number().finite(), space: z.enum(["PIXELS", "NORMALIZED"]) });
export const smokeRingParametersSchema = z.object({
  sceneNumber: z.number().int().positive(),
  sceneStart: z.number().finite().nonnegative(),
  sceneEnd: z.number().finite().positive(),
  effectStartLocalTime: z.number().finite().nonnegative(),
  effectEndLocalTime: z.number().finite().positive(),
  mouthAnchor: anchorSchema,
  ringSizeUnit: z.literal("PIXELS"),
  ringInitialSize: z.number().finite().positive(),
  ringFinalSize: z.number().finite().positive(),
  opacity: z.number().finite().positive().max(1),
  thickness: z.number().finite().positive(),
  fadeIn: z.number().finite().nonnegative(),
  fadeOut: z.number().finite().nonnegative(),
  candidateInputPath: z.string().min(1),
  candidateOutputPath: z.string().min(1),
});

export type SmokeRingParameters = z.infer<typeof smokeRingParametersSchema>;
export type SmokeRingVideoMetadata = { width: number; height: number; fps: number; duration: number };

function actualState(incident: TroubleshootingIncident) {
  return incident.actualState && typeof incident.actualState === "object" && !Array.isArray(incident.actualState) ? incident.actualState as Record<string, unknown> : {};
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function findAnchor(value: unknown): { x: number; y: number; space: "PIXELS" | "NORMALIZED" } | null {
  const parsed = anchorSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSmokeRingParametersFromState(state: Record<string, unknown>, fallbackSceneNumber: number | null, candidateInputPath: string, candidateOutputPath: string) {
  const candidates = Array.isArray(state.originCandidates) ? state.originCandidates : [];
  if (state.multipleCharacters === true || candidates.length > 1) return { error: "AMBIGUOUS_SMOKE_RING_ORIGIN" } as const;
  const affectedRegion = state.affectedRegion && typeof state.affectedRegion === "object" && !Array.isArray(state.affectedRegion) ? state.affectedRegion as Record<string, unknown> : {};
  const mouthAnchor = findAnchor(state.mouthAnchor) ?? findAnchor(state.origin) ?? findAnchor(state.anchor) ?? findAnchor(affectedRegion.anchor) ?? findAnchor(affectedRegion.mouthAnchor);
  if (!mouthAnchor) return { error: "MISSING_SMOKE_RING_ORIGIN" } as const;
  const parsed = smokeRingParametersSchema.safeParse({
    sceneNumber: state.sceneNumber ?? fallbackSceneNumber,
    sceneStart: state.sceneStart,
    sceneEnd: state.sceneEnd,
    effectStartLocalTime: state.effectStartLocalTime,
    effectEndLocalTime: state.effectEndLocalTime,
    mouthAnchor,
    ringSizeUnit: state.ringSizeUnit ?? "PIXELS",
    ringInitialSize: state.ringInitialSize,
    ringFinalSize: state.ringFinalSize,
    opacity: state.opacity,
    thickness: state.thickness,
    fadeIn: state.fadeIn,
    fadeOut: state.fadeOut,
    candidateInputPath,
    candidateOutputPath,
  });
  if (!parsed.success) return { error: "MISSING_SMOKE_RING_PARAMETER", details: parsed.error.issues.map(issue => issue.path.join(".")).join(",") } as const;
  const value = parsed.data;
  const sceneDuration = value.sceneEnd - value.sceneStart;
  const effectDuration = value.effectEndLocalTime - value.effectStartLocalTime;
  if (sceneDuration <= 0 || value.effectEndLocalTime > sceneDuration || effectDuration <= 0 || value.fadeIn + value.fadeOut > effectDuration) return { error: "INVALID_SMOKE_RING_TIME_WINDOW" } as const;
  return { value } as const;
}

export function parseSmokeRingParameters(incident: TroubleshootingIncident, candidateInputPath: string, candidateOutputPath: string) {
  return parseSmokeRingParametersFromState(actualState(incident), incident.sceneNumber, candidateInputPath, candidateOutputPath);
}

export async function findSmokeRingFfmpegPath() {
  const configured = process.env.MODELING_AI_FFMPEG_PATH;
  if (configured) return configured;
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const executable = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const candidates = [
    ...(resourcesPath ? [path.join(resourcesPath, "ffmpeg", executable)] : []),
    path.join(process.cwd(), "electron", "dist", "ffmpeg", executable),
  ];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ["-version"], { windowsHide: true });
      return candidate;
    } catch { /* try the next bundled runtime */ }
  }
  const root = path.join(process.env.LOCALAPPDATA ?? "", "CapCut", "Apps");
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const capCutCandidates = entries.filter(entry => entry.isDirectory()).map(entry => path.join(root, entry.name, executable)).sort().reverse();
    for (const candidate of capCutCandidates) {
      try { await execFileAsync(candidate, ["-version"], { windowsHide: true }); return candidate; } catch { /* try the next installed runtime */ }
    }
  } catch { /* optional local runtime directory */ }
  return null;
}

function parseDuration(text: string) {
  const match = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : null;
}

export async function probeSmokeRingVideo(ffmpegPath: string, filePath: string): Promise<SmokeRingVideoMetadata> {
  let output = "";
  try {
    const result = await execFileAsync(ffmpegPath, ["-hide_banner", "-i", filePath, "-f", "null", "-"], { windowsHide: true, maxBuffer: 2_000_000 });
    output = `${result.stdout}\n${result.stderr}`;
  } catch (error) {
    output = `${(error as { stdout?: string; stderr?: string }).stdout ?? ""}\n${(error as { stdout?: string; stderr?: string }).stderr ?? ""}`;
  }
  const dimension = output.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const fpsMatch = output.match(/(\d+(?:\.\d+)?)\s+(?:fps|tbr)\b/i);
  const duration = parseDuration(output);
  if (!dimension || !fpsMatch || !duration || Number(fpsMatch[1]) <= 0) throw new Error("SMOKE_RING_VIDEO_METADATA_UNAVAILABLE");
  return { width: Number(dimension[1]), height: Number(dimension[2]), fps: Number(fpsMatch[1]), duration };
}

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

export function anchorPixels(parameters: SmokeRingParameters, metadata: SmokeRingVideoMetadata) {
  return parameters.mouthAnchor.space === "NORMALIZED"
    ? { x: parameters.mouthAnchor.x * metadata.width, y: parameters.mouthAnchor.y * metadata.height }
    : { x: parameters.mouthAnchor.x, y: parameters.mouthAnchor.y };
}

export function createSmokeRingFrame(parameters: SmokeRingParameters, metadata: SmokeRingVideoMetadata, globalTime: number) {
  const frame = Buffer.alloc(metadata.width * metadata.height * 4);
  const localTime = globalTime - parameters.sceneStart;
  if (localTime < parameters.effectStartLocalTime || localTime > parameters.effectEndLocalTime) return frame;
  const duration = parameters.effectEndLocalTime - parameters.effectStartLocalTime;
  const progress = clamp((localTime - parameters.effectStartLocalTime) / duration, 0, 1);
  const fadeIn = parameters.fadeIn ? clamp((localTime - parameters.effectStartLocalTime) / parameters.fadeIn, 0, 1) : 1;
  const fadeOut = parameters.fadeOut ? clamp((parameters.effectEndLocalTime - localTime) / parameters.fadeOut, 0, 1) : 1;
  const alpha = Math.round(210 * parameters.opacity * Math.min(fadeIn, fadeOut));
  const radius = parameters.ringInitialSize + (parameters.ringFinalSize - parameters.ringInitialSize) * progress;
  const halfThickness = parameters.thickness / 2;
  const anchor = anchorPixels(parameters, metadata);
  const minX = Math.max(0, Math.floor(anchor.x - radius - halfThickness - 2));
  const maxX = Math.min(metadata.width - 1, Math.ceil(anchor.x + radius + halfThickness + 2));
  const minY = Math.max(0, Math.floor(anchor.y - radius - halfThickness - 2));
  const maxY = Math.min(metadata.height - 1, Math.ceil(anchor.y + radius + halfThickness + 2));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const distance = Math.hypot(x - anchor.x, y - anchor.y);
      const edgeDistance = Math.abs(distance - radius);
      if (edgeDistance > halfThickness + 1) continue;
      const edgeAlpha = clamp(1 - Math.max(0, edgeDistance - halfThickness + 1), 0, 1);
      const offset = (y * metadata.width + x) * 4;
      frame[offset] = 210;
      frame[offset + 1] = 210;
      frame[offset + 2] = 210;
      frame[offset + 3] = Math.round(alpha * edgeAlpha);
    }
  }
  return frame;
}

async function writeFrame(stream: NodeJS.WritableStream, frame: Buffer) {
  if (stream.write(frame)) return;
  await new Promise<void>(resolve => stream.once("drain", resolve));
}

export async function renderSmokeRingCandidate(parameters: SmokeRingParameters, ffmpegPath: string, metadata?: SmokeRingVideoMetadata) {
  const videoMetadata = metadata ?? await probeSmokeRingVideo(ffmpegPath, parameters.candidateInputPath);
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-i", parameters.candidateInputPath, "-f", "rawvideo", "-pix_fmt", "rgba", "-video_size", `${videoMetadata.width}x${videoMetadata.height}`, "-framerate", String(videoMetadata.fps), "-i", "pipe:0", "-filter_complex", "[0:v][1:v]overlay=0:0:format=auto:eof_action=repeat[outv]", "-map", "[outv]", "-map", "0:a?", "-t", String(videoMetadata.duration), "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p", "-threads", "1", "-fflags", "+bitexact", "-flags:v", "+bitexact", "-map_metadata", "-1", "-c:a", "copy", "-movflags", "+faststart", parameters.candidateOutputPath];
  const child = spawn(ffmpegPath, args, { windowsHide: true, stdio: ["pipe", "ignore", "pipe"] });
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += String(chunk); });
  const completion = new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", code => code === 0 ? resolve() : reject(new Error(`SMOKE_RING_FFMPEG_FAILED:${stderr.slice(-2_000)}`)));
  });
  const frameCount = Math.ceil(videoMetadata.duration * videoMetadata.fps) + 2;
  for (let index = 0; index < frameCount; index += 1) await writeFrame(child.stdin, createSmokeRingFrame(parameters, videoMetadata, index / videoMetadata.fps));
  child.stdin.end();
  await completion;
  await normalizeMp4Timestamps(parameters.candidateOutputPath);
  return videoMetadata;
}

function missingOutcome(reason: string): PostAssemblyHandlerOutcome {
  return { status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], affectedScene: null, affectedRegion: "mouth", warnings: [reason], validatorsToRecheck: ["smoke-ring"], preserveRequirements: ["Do not modify CURRENT output.", "Preserve approved scenes outside the affected region."] };
}

export function createSmokeRingPostAssemblyHandler(): PostAssemblyRepairHandler {
  const rulePlaceholder = { issueId: "FLOW_SMOKE_RING_OMITTED" } as TroubleshootingRule;
  return {
    issueId: rulePlaceholder.issueId,
    mode: "AUTO",
    handle: async () => ({ status: "NEEDS_REVIEW", actionsTaken: [], filesChanged: [], stateChanged: {}, validationSignals: {}, warnings: ["Smoke ring handler chỉ được gọi qua Post-Assembly coordinator."], nextAction: "Use PostAssemblyRepairCoordinator." }),
    postAssembly: {
      supportsPostAssembly: true,
      repairScope: "FRAME_REGION",
      mutatesOutputFile: true,
      requiresCandidate: true,
      supportedValidatorIds: ["smoke-ring", "visual-artifacts", "post-assembly-visual"],
      preserveRequirements: ["Preserve character identity, clothing, eyes, monitor, background and other scenes.", "Only modify the smoke-ring frame region within the supplied time window."],
      validationPlan: { validatorIds: ["smoke-ring"], requiredValidatorIds: ["smoke-ring"], preserveValidatorIds: [] },
    },
    handlePostAssembly: async ({ incident, candidatePath, currentOutputPath }) => {
      if (!candidatePath) return missingOutcome("MISSING_SMOKE_RING_CANDIDATE");
      const temporaryOutputPath = `${candidatePath}.smoke-ring.tmp.mp4`;
      const parsed = parseSmokeRingParameters(incident, candidatePath, temporaryOutputPath);
      if ("error" in parsed) return missingOutcome(parsed.error ?? "MISSING_SMOKE_RING_PARAMETER");
      const ffmpegPath = await findSmokeRingFfmpegPath();
      if (!ffmpegPath) return missingOutcome("SMOKE_RING_FFMPEG_NOT_FOUND");
      try {
        await renderSmokeRingCandidate(parsed.value, ffmpegPath);
        const { rename } = await import("node:fs/promises");
        await rename(temporaryOutputPath, candidatePath);
        return { status: "REPAIRED", actionsTaken: ["renderDeterministicSmokeRingToCandidate"], filesChanged: [candidatePath], affectedScene: parsed.value.sceneNumber, affectedRegion: "mouth", warnings: [], validatorsToRecheck: ["smoke-ring"], preserveRequirements: ["CURRENT output remains unchanged until promote PASS.", "No other scene or approved source may be changed."] };
      } catch (error) {
        return { status: "REPAIR_FAILED", actionsTaken: [], filesChanged: [], affectedScene: parsed.value.sceneNumber, affectedRegion: "mouth", warnings: [errorMessage(error)], validatorsToRecheck: ["smoke-ring"], preserveRequirements: ["CURRENT output remains unchanged."] };
      }
    },
  };
}
