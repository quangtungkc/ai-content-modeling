import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { channelInputSchema, type ChannelInput } from "./schema";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { AIImageReference } from "@/services/ai/types";

function serializeChannel<T extends { id: string; mainCharacterImageKey?: string | null }>(channel: T) {
  return {
    ...channel,
    mainCharacterImageUrl: channel.mainCharacterImageKey
      ? `/api/v1/channels/${channel.id}/character-image`
      : null,
  };
}

export async function listChannels(userId: string) {
  const channels = await db.channel.findMany({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
  return channels.map(serializeChannel);
}

export async function getChannel(id: string, userId: string) {
  const channel = await db.channel.findFirst({ where: { id, userId } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404);
  return serializeChannel(channel);
}

export async function createChannel(userId: string, input: unknown) {
  const data = channelInputSchema.parse(input);
  const { videoDuration, ...channelData } = data;
  return serializeChannel(await db.channel.create({ data: { ...channelData, userId, videoDurationSec: videoDuration } }));
}

export async function updateChannel(id: string, userId: string, input: unknown) {
  const parsed = channelInputSchema.parse(input) as ChannelInput;
  const { videoDuration, ...data } = parsed;
  await getChannel(id, userId);
  return serializeChannel(await db.channel.update({ where: { id }, data: { ...data, videoDurationSec: videoDuration } }));
}

export async function deleteChannel(id: string, userId: string) {
  await getChannel(id, userId);
  return db.channel.update({ where: { id }, data: { status: "INACTIVE" } });
}

export async function readChannelMainCharacterImage(channel: { mainCharacterImageKey?: string | null; mainCharacterImageMimeType?: string | null; mainCharacterImageName?: string | null }): Promise<AIImageReference | undefined> {
  if (!channel.mainCharacterImageKey) return undefined;
  const fileName = path.basename(channel.mainCharacterImageKey);
  if (fileName !== channel.mainCharacterImageKey || !/^[A-Za-z0-9_-]+\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(fileName)) {
    throw new AppError("CHANNEL_CHARACTER_IMAGE_INVALID", "Ảnh nhân vật chính của kênh không hợp lệ.", 409);
  }
  const root = path.join(process.env.APPDATA ?? process.env.LOCALAPPDATA ?? process.cwd(), "ai-content-modeling", "channel-characters");
  const filePath = path.join(root, fileName);
  let metadata;
  try {
    metadata = await stat(filePath);
  } catch {
    throw new AppError("CHANNEL_CHARACTER_IMAGE_MISSING", "Ảnh nhân vật chính đã khai báo nhưng không còn trên máy.", 409);
  }
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > 20 * 1024 * 1024) {
    throw new AppError("CHANNEL_CHARACTER_IMAGE_INVALID", "Ảnh nhân vật chính phải là tệp hợp lệ và không vượt quá 20 MB.", 409);
  }
  const data = (await readFile(filePath)).toString("base64");
  return { mimeType: channel.mainCharacterImageMimeType ?? "image/png", data, name: channel.mainCharacterImageName ?? fileName };
}
