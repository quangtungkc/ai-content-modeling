import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

export type GeneratedImageKind = "character" | "background" | "scene";
const appDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "ai-content-modeling");
const legacyAppDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "Modeling AI");
const root = () => path.join(appDataRoot(), "generated-images");
const videoRoot = () => path.join(appDataRoot(), "generated-videos");
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

export async function readProjectImage(projectId: string, userId: string, kind: GeneratedImageKind, sceneNumber?: number) {
  await ownedProject(projectId, userId);
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
