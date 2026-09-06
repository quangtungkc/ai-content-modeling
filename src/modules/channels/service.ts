import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { channelInputSchema, type ChannelInput } from "./schema";

export async function listChannels(userId: string) {
  return db.channel.findMany({ where: { userId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } });
}

export async function getChannel(id: string, userId: string) {
  const channel = await db.channel.findFirst({ where: { id, userId } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404);
  return channel;
}

export async function createChannel(userId: string, input: unknown) {
  const data = channelInputSchema.parse(input);
  const { videoDuration, ...channelData } = data;
  return db.channel.create({ data: { ...channelData, userId, videoDurationSec: videoDuration } });
}

export async function updateChannel(id: string, userId: string, input: unknown) {
  const parsed = channelInputSchema.parse(input) as ChannelInput;
  const { videoDuration, ...data } = parsed;
  await getChannel(id, userId);
  return db.channel.update({ where: { id }, data: { ...data, videoDurationSec: videoDuration } });
}

export async function deleteChannel(id: string, userId: string) {
  await getChannel(id, userId);
  return db.channel.update({ where: { id }, data: { status: "INACTIVE" } });
}
