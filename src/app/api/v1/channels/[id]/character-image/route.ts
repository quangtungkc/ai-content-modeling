import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { getChannel } from "@/modules/channels/service";

type Context = { params: Promise<{ id: string }> };
const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
const supportedTypes = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/bmp", ".bmp"],
  ["image/avif", ".avif"],
]);
const appDataRoot = () => path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "ai-content-modeling");
const characterRoot = () => path.join(appDataRoot(), "channel-characters");

function authError(error: unknown) {
  return error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
    ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
    : error;
}

async function characterFiles(channelId: string) {
  const files = await readdir(characterRoot()).catch(() => [] as string[]);
  return files.filter((file) => file.startsWith(`${channelId}.`));
}

export async function GET(_request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const channel = await getChannel(id, session.userId);
    if (!channel.mainCharacterImageKey) throw new AppError("IMAGE_NOT_FOUND", "Kênh chưa có ảnh nhân vật chính.", 404);
    const key = path.basename(channel.mainCharacterImageKey);
    if (key !== channel.mainCharacterImageKey || !key.startsWith(`${id}.`)) throw new AppError("IMAGE_NOT_FOUND", "Ảnh nhân vật chính không hợp lệ.", 404);
    const filePath = path.join(characterRoot(), key);
    const file = await readFile(filePath);
    return new Response(file, { headers: { "Content-Type": channel.mainCharacterImageMimeType ?? "image/png", "Cache-Control": "private, max-age=300" } });
  } catch (error) {
    logger.error("Read channel character image failed", { requestId });
    return toErrorResponse(authError(error), requestId);
  }
}

export async function POST(request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    await getChannel(id, session.userId);
    const form = await request.formData();
    const value = form.get("file");
    if (!(value instanceof File)) throw new AppError("VALIDATION_ERROR", "Hãy chọn ảnh nhân vật chính.", 400);
    const extension = supportedTypes.get(value.type.toLowerCase());
    if (!extension) throw new AppError("VALIDATION_ERROR", "Ảnh phải có định dạng PNG, JPG, WEBP, GIF, BMP hoặc AVIF.", 400);
    if (value.size <= 0 || value.size > MAX_IMAGE_SIZE) throw new AppError("VALIDATION_ERROR", "Ảnh phải lớn hơn 0 và không vượt quá 20 MB.", 400);
    const rootPath = characterRoot();
    await mkdir(rootPath, { recursive: true });
    for (const oldFile of await characterFiles(id)) await rm(path.join(rootPath, oldFile), { force: true });
    const key = `${id}${extension}`;
    await writeFile(path.join(rootPath, key), Buffer.from(await value.arrayBuffer()));
    const channel = await db.channel.update({ where: { id }, data: { mainCharacterImageKey: key, mainCharacterImageName: value.name, mainCharacterImageMimeType: value.type.toLowerCase() } });
    return Response.json({ data: { id: channel.id, mainCharacterImageName: channel.mainCharacterImageName, mainCharacterImageUrl: `/api/v1/channels/${id}/character-image` }, requestId });
  } catch (error) {
    logger.error("Save channel character image failed", { requestId });
    return toErrorResponse(authError(error), requestId);
  }
}
