import { access, mkdir, readFile, stat, writeFile, rename, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { applicationDataDirectory } from "@/lib/app-data";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type GeneratedImageKind = "character" | "background" | "scene";
const appDataRoot = () => applicationDataDirectory(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd());
const legacyAppDataRoot = () => applicationDataDirectory(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "Modeling AI");
const generatedMediaRoot = () => process.env.MODELING_AI_GENERATED_MEDIA_ROOT
  ? path.resolve(process.env.MODELING_AI_GENERATED_MEDIA_ROOT)
  : appDataRoot();
const root = () => path.join(generatedMediaRoot(), "generated-images");
const videoRoot = () => path.join(generatedMediaRoot(), "generated-videos");
const legacyImageRoot = () => path.join(legacyAppDataRoot(), "generated-images");
const legacyVideoRoot = () => path.join(legacyAppDataRoot(), "generated-videos");
const imageFormats = [
  { extension: ".png", mimeType: "image/png" },
  { extension: ".jpg", mimeType: "image/jpeg" },
  { extension: ".jpeg", mimeType: "image/jpeg" },
  { extension: ".webp", mimeType: "image/webp" },
  { extension: ".gif", mimeType: "image/gif" },
  { extension: ".bmp", mimeType: "image/bmp" },
  { extension: ".avif", mimeType: "image/avif" },
] as const;

function imageFormat(mimeType: string) {
  return imageFormats.find((format) => format.mimeType === mimeType.toLowerCase()) ?? imageFormats[0];
}

async function ownedProject(projectId: string, userId: string) {
  const project = await db.contentProject.findFirst({ where: { id: projectId, channel: { userId } }, select: { id: true } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
}

export async function readProjectImage(projectId: string, userId: string, kind: GeneratedImageKind, sceneNumber?: number, candidateId?: string) {
  await ownedProject(projectId, userId);
  const directory = path.join(root(), projectId);
  if (candidateId) {
    if (!/^[a-f0-9-]{36}$/.test(candidateId)) throw new AppError("IMAGE_CANDIDATE_ID_INVALID", "Candidate ảnh không hợp lệ.", 400);
    for (const format of imageFormats) {
      const target = path.join(directory, "candidates", candidateId, `${kind}-${sceneNumber ?? 0}${format.extension}`);
      try { return { data: await readFile(target), mimeType: format.mimeType }; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    throw new AppError("IMAGE_CANDIDATE_MISSING", "Chưa có ảnh candidate cho mục này.", 404);
  }
  let approved: Record<string, string> = {};
  try { approved = JSON.parse(await readFile(path.join(directory, "approved-images.json"), "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const selected = approved[`${kind}-${sceneNumber ?? 0}`];
  if (selected) {
    if (!/^candidates\/[a-f0-9-]{36}\/(?:scene|background)-\d+\.(?:png|jpg|jpeg|webp|gif|bmp|avif)$/.test(selected)) throw new AppError("IMAGE_VERSION_INVALID", "Phiên bản ảnh đã duyệt không hợp lệ.", 500);
    const format = imageFormats.find(item => selected.endsWith(item.extension));
    return { data: await readFile(path.join(directory, selected)), mimeType: format!.mimeType };
  }
  for (const imageRoot of [root(), legacyImageRoot()]) {
    for (const format of imageFormats) {
      const target = path.join(imageRoot, projectId, `${kind}-${sceneNumber ?? 0}${format.extension}`);
      try {
        await access(target);
        return { data: await readFile(target), mimeType: format.mimeType };
      } catch {
        // Try the next supported image format.
      }
    }
  }
  throw new AppError("IMAGE_NOT_FOUND", "Chưa có ảnh cho mục này.", 404);
}

export async function preserveImageCandidateBaseline(projectId: string, userId: string, candidateId: string, previousCandidateId: string | undefined, scenes: number[]) {
  await ownedProject(projectId, userId);
  if (!/^[a-f0-9-]{36}$/.test(candidateId) || (previousCandidateId && !/^[a-f0-9-]{36}$/.test(previousCandidateId)) || scenes.some(number => !Number.isInteger(number) || number < 1)) throw new Error("IMAGE_CANDIDATE_INVALID");
  const directory = path.join(root(), projectId, "candidates", candidateId);
  await mkdir(directory, { recursive: true });
  const preserved: number[] = [];
  for (const number of [...new Set(scenes)]) {
    for (const format of imageFormats) {
      const filename = `scene-${number}${format.extension}`;
      const target = path.join(directory, filename);
      try { if ((await stat(target)).size >= 1024) { preserved.push(number); break; } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const sources = [
        previousCandidateId && previousCandidateId !== candidateId ? path.join(root(), projectId, "candidates", previousCandidateId, filename) : null,
        path.join(root(), projectId, filename),
        path.join(legacyImageRoot(), projectId, filename),
      ].filter((source): source is string => Boolean(source));
      for (const source of sources) {
        try {
          if ((await stat(source)).size < 1024) continue;
          await copyFile(source, target, constants.COPYFILE_EXCL);
          preserved.push(number);
          break;
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      }
    }
  }
  return preserved;
}

export async function promoteImageCandidates(projectId: string, userId: string, candidateId: string, scenes: number[], validation: { verdict: string }) {
  await ownedProject(projectId, userId);
  if (validation.verdict !== "PASS" || !/^[a-f0-9-]{36}$/.test(candidateId) || !scenes.length) throw new AppError("IMAGE_NOT_APPROVED", "Ảnh và nối cảnh chưa đạt PASS; giữ nguyên bản chính thức.", 409);
  const directory = path.join(root(), projectId);
  const manifestPath = path.join(directory, "approved-images.json");
  let manifest: Record<string, string> = {};
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  for (const number of scenes) {
    if (!Number.isInteger(number) || number < 1) throw new Error("IMAGE_SCENE_INVALID");
    let selected: string | undefined;
    for (const format of imageFormats) {
      const relative = `candidates/${candidateId}/scene-${number}${format.extension}`;
      try { if ((await stat(path.join(directory, relative))).size >= 1024) { selected = relative; break; } }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    if (!selected) throw new Error("IMAGE_CANDIDATE_MISSING");
    manifest[`scene-${number}`] = selected;
  }
  const temporary = `${manifestPath}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(manifest), { flag: "wx" });
  await rename(temporary, manifestPath);
  return manifest;
}

export async function readProjectVideo(projectId: string, userId: string, sceneNumber: number) {
  await ownedProject(projectId, userId);
  for (const rootPath of [videoRoot(), legacyVideoRoot()]) {
    const target = path.join(rootPath, projectId, `scene-${sceneNumber}.mp4`);
    try {
      await access(target);
      return await readFile(target);
    } catch {
      // Try the legacy data location when necessary.
    }
  }
  throw new AppError("VIDEO_NOT_FOUND", "Chưa có video cho phân cảnh này.", 404);
}

export async function readProjectFinalVideo(projectId: string, userId: string) {
  await ownedProject(projectId, userId);
  for (const rootPath of [videoRoot(), legacyVideoRoot()]) {
    const target = path.join(rootPath, projectId, "final.mp4");
    try {
      await access(target);
      return await readFile(target);
    } catch {
      // Try the legacy data location when necessary.
    }
  }
  throw new AppError("VIDEO_NOT_FOUND", "Chưa có video hoàn chỉnh.", 404);
}

export async function hasProjectFinalVideo(projectId: string) {
  for (const rootPath of [videoRoot(), legacyVideoRoot()]) {
    const target = path.join(rootPath, projectId, "final.mp4");
    try {
      const metadata = await stat(target);
      if (metadata.isFile() && metadata.size > 1024) return true;
    } catch {
      // Try the legacy data location when necessary.
    }
  }
  return false;
}

export async function writeProjectImage(projectId: string, kind: GeneratedImageKind, sceneNumber: number, data: Buffer, mimeType: string) {
  if (data.length < 1024 || data.length > 20 * 1024 * 1024) throw new AppError("IMAGE_INVALID", "Provider không trả về ảnh hợp lệ.", 502);
  const format = imageFormat(mimeType);
  const directory = path.join(root(), projectId);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `${kind}-${sceneNumber}${format.extension}`);
  await writeFile(target, data);
  return target;
}

export async function writeProjectVideo(projectId: string, sceneNumber: number, data: Buffer) {
  if (data.length < 1024 || data.length > 200 * 1024 * 1024) throw new AppError("VIDEO_INVALID", "Provider không trả về video hợp lệ.", 502);
  const directory = path.join(videoRoot(), projectId);
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, `scene-${sceneNumber}.mp4`);
  await writeFile(target, data);
  return target;
}
