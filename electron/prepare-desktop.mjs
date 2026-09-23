import { access, cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { build } from "esbuild";

const execFileAsync = promisify(execFile);
const output = "electron/dist";
const configuredFfmpeg = process.env.MODELING_AI_FFMPEG_PATH?.trim();
const defaultFfmpeg = "node_modules/ffmpeg-static/ffmpeg.exe";
const requestedFfmpegSource = configuredFfmpeg || defaultFfmpeg;
let ffmpegSource = requestedFfmpegSource;
let stagingDirectory = null;

try {
  await access(requestedFfmpegSource);
  await execFileAsync(requestedFfmpegSource, ["-version"], { windowsHide: true, timeout: 15_000 });
  const outputRoot = path.resolve(output);
  const requestedRoot = path.resolve(requestedFfmpegSource);
  if (requestedRoot === outputRoot || requestedRoot.startsWith(`${outputRoot}${path.sep}`)) {
    stagingDirectory = await mkdtemp(path.join(tmpdir(), "modeling-ai-ffmpeg-"));
    ffmpegSource = path.join(stagingDirectory, path.basename(requestedFfmpegSource));
    await cp(requestedFfmpegSource, ffmpegSource);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  throw new Error(`FFMPEG_RUNTIME_INVALID: ${requestedFfmpegSource}\n${message}`);
}

await rm(output, { recursive: true, force: true });
await mkdir(`${output}/app/.next`, { recursive: true });
await cp(".next/standalone", `${output}/app`, { recursive: true });
await rm(`${output}/app/.env`, { force: true });
await cp(".next/static", `${output}/app/.next/static`, { recursive: true });
await cp("electron/assets/modeling-ai-template.db", `${output}/modeling-ai-template.db`);
await cp("prisma/schema.prisma", `${output}/schema.prisma`);
await mkdir(`${output}/ffmpeg`, { recursive: true });
await cp(ffmpegSource, `${output}/ffmpeg/ffmpeg.exe`);
const configuredLicense = `${requestedFfmpegSource}.LICENSE`;
const packageLicense = "node_modules/ffmpeg-static/ffmpeg.exe.LICENSE";
try {
  await access(configuredLicense);
  await cp(configuredLicense, `${output}/ffmpeg/LICENSE.txt`);
} catch {
  try {
    await cp(packageLicense, `${output}/ffmpeg/LICENSE.txt`);
  } catch {
    await writeFile(`${output}/ffmpeg/LICENSE.txt`, "FFmpeg is distributed under the LGPL/GPL terms described at https://ffmpeg.org/legal.html.\n", "utf8");
  }
}

await build({
  entryPoints: ["src/workers/worker.ts"],
  outfile: `${output}/app/worker.cjs`,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: false,
  external: ["@prisma/client", ".prisma/client"],
});

if (stagingDirectory) await rm(stagingDirectory, { recursive: true, force: true });
