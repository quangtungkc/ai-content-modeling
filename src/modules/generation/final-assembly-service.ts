import { access, copyFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { AppError } from "@/lib/errors";

const appDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "ai-content-modeling");

async function firstExisting(candidates: string[]) {
  for (const candidate of candidates) {
    try { await access(candidate); return candidate; } catch { /* continue */ }
  }
  return null;
}

async function findFfmpeg() {
  const configured = process.env.MODELING_AI_FFMPEG_PATH;
  const direct = await firstExisting([
    ...(configured ? [configured] : []),
    path.join((process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? "", "ffmpeg", "ffmpeg.exe"),
  ]);
  if (direct) return direct;
  const capCutRoot = path.join(process.env.LOCALAPPDATA ?? "", "CapCut", "Apps");
  try {
    const entries = await import("node:fs/promises").then(({ readdir }) => readdir(capCutRoot, { withFileTypes: true }));
    const candidates = entries.filter((entry) => entry.isDirectory()).map((entry) => path.join(capCutRoot, entry.name, "ffmpeg.exe")).sort().reverse();
    const capCut = await firstExisting(candidates);
    if (capCut) return capCut;
  } catch { /* CapCut is optional. */ }
  throw new AppError("FFMPEG_NOT_FOUND", "Chưa tìm thấy runtime FFmpeg để ghép video.", 503);
}

async function runFfmpeg(args: string[], allowFailure = false) {
  const executable = await findFfmpeg();
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 || allowFailure ? resolve(output) : reject(new Error(`FFmpeg dừng với mã ${code}: ${output.trim().slice(-1200)}`)));
  });
}

async function duration(file: string) {
  const output = await runFfmpeg(["-hide_banner", "-i", file, "-f", "null", "-"], true);
  const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (!match) throw new Error(`Không đọc được thời lượng ${path.basename(file)}.`);
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

export async function assembleProjectVideo(projectId: string, sceneNumbers: number[], onProgress?: (detail: string, processed: number, total: number) => Promise<void> | void) {
  const ordered = [...new Set(sceneNumbers)].sort((a, b) => a - b);
  if (!ordered.length) throw new AppError("SCENES_REQUIRED", "Không có video phân cảnh để ghép.", 409);
  const videoDirectory = path.join(appDataRoot(), "generated-videos", projectId);
  const sources = ordered.map((number) => path.join(videoDirectory, `scene-${number}.mp4`));
  for (const source of sources) {
    try { if ((await stat(source)).size < 1024) throw new Error(); } catch { throw new AppError("SCENE_VIDEO_MISSING", `Thiếu video ${path.basename(source)}.`, 409); }
  }
  await mkdir(videoDirectory, { recursive: true });
  const temporary = await mkdtemp(path.join(os.tmpdir(), "modeling-ai-worker-edit-"));
  const finalPath = path.join(videoDirectory, "final.mp4");
  try {
    const normalized: string[] = [];
    const durations: number[] = [];
    for (let index = 0; index < sources.length; index += 1) {
      const target = path.join(temporary, `scene-${index + 1}.mp4`);
      await runFfmpeg(["-y", "-hide_banner", "-i", sources[index], "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30", "-c:v", "h264_mf", "-b:v", "4500k", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target]);
      normalized.push(target);
      durations.push(await duration(target));
      await onProgress?.(`Đã chuẩn hóa cảnh ${ordered[index]}.`, index + 1, sources.length);
    }
    if (normalized.length === 1) await copyFile(normalized[0], finalPath);
    else {
      const transition = 0.3;
      const filters: string[] = [];
      let videoLabel = "0:v";
      let audioLabel = "0:a";
      let accumulated = durations[0];
      for (let index = 1; index < normalized.length; index += 1) {
        const nextVideo = `video${index}`;
        const nextAudio = `audio${index}`;
        filters.push(`[${videoLabel}][${index}:v]xfade=transition=fade:duration=${transition}:offset=${Math.max(0.01, accumulated - transition).toFixed(3)}[${nextVideo}]`);
        filters.push(`[${audioLabel}][${index}:a]acrossfade=d=${transition}:c1=tri:c2=tri[${nextAudio}]`);
        videoLabel = nextVideo;
        audioLabel = nextAudio;
        accumulated += durations[index] - transition;
      }
      await runFfmpeg(["-y", "-hide_banner", ...normalized.flatMap((file) => ["-i", file]), "-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, "-c:v", "h264_mf", "-b:v", "4500k", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", finalPath]);
    }
    if ((await stat(finalPath)).size < 1024) throw new Error("Video cuối không hợp lệ.");
    await onProgress?.("Đã xuất video hoàn chỉnh.", sources.length, sources.length);
    return { finalPath, finalVideoUrl: `/api/v1/projects/${projectId}/videos?final=1&v=${Date.now()}`, sceneOrder: ordered, aspectRatio: "9:16", hasAudio: true };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
