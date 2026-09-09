import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { decryptSecret } from "@/lib/secrets";
import { GeminiProvider } from "@/services/ai/gemini";

export type GeneratedImageKind = "character" | "background" | "scene";
const appDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "ai-content-modeling");
const legacyAppDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "Modeling AI");
const root = () => path.join(appDataRoot(), "generated-images");
const videoRoot = () => path.join(appDataRoot(), "generated-videos");
const legacyImageRoot = () => path.join(legacyAppDataRoot(), "generated-images");
const legacyVideoRoot = () => path.join(legacyAppDataRoot(), "generated-videos");
const filePath = (projectId: string, kind: GeneratedImageKind, sceneNumber?: number, extension = ".png") => path.join(root(), projectId, `${kind}-${sceneNumber ?? 0}${extension}`);
const imageFormats = [
  { extension: ".png", mimeType: "image/png" },
  { extension: ".jpg", mimeType: "image/jpeg" },
  { extension: ".jpeg", mimeType: "image/jpeg" },
  { extension: ".webp", mimeType: "image/webp" },
  { extension: ".gif", mimeType: "image/gif" },
  { extension: ".bmp", mimeType: "image/bmp" },
  { extension: ".avif", mimeType: "image/avif" },
] as const;

async function ownedProject(projectId: string, userId: string) {
  const project = await db.contentProject.findFirst({ where: { id: projectId, channel: { userId } }, select: { id: true } });
  if (!project) throw new AppError("PROJECT_NOT_FOUND", "Không tìm thấy content project.", 404);
}

export async function generateProjectImage(projectId: string, userId: string, input: { kind: GeneratedImageKind; sceneNumber?: number; prompt: string; aspectRatio: string }) {
  await ownedProject(projectId, userId);
  const connection = await db.aIConnection.findFirst({ where: { userId, kind: "AI", provider: "GEMINI", revokedAt: null }, orderBy: { updatedAt: "desc" } });
  if (!connection) throw new AppError("AI_CONNECTION_REQUIRED", "Vào Cài đặt AI và kết nối Gemini trước khi tạo ảnh.", 409);
  const image = await new GeminiProvider(decryptSecret(connection.encryptedKey)).generateImage(input.prompt, input.aspectRatio);
  const target = filePath(projectId, input.kind, input.sceneNumber);
  await mkdir(path.dirname(target), { recursive: true });
  const buffer = Buffer.from(image.data, "base64");
  await writeFile(target, buffer);
  return { url: `/api/v1/projects/${projectId}/images?kind=${input.kind}&sceneNumber=${input.sceneNumber ?? 0}`, checksum: createHash("sha256").update(buffer).digest("hex") };
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
