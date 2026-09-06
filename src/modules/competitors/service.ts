import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { normalizeCompetitorUrl } from "./url";
import { competitorInputSchema, competitorStatusSchema } from "./schema";

async function assertChannelOwner(channelId: string, userId: string) {
  const channel = await db.channel.findFirst({ where: { id: channelId, userId, status: "ACTIVE" }, select: { id: true } });
  if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404);
}

export async function listCompetitors(channelId: string, userId: string) {
  await assertChannelOwner(channelId, userId);
  return db.competitor.findMany({ where: { channelId }, orderBy: { createdAt: "asc" } });
}

export async function addCompetitor(channelId: string, userId: string, input: unknown) {
  await assertChannelOwner(channelId, userId);
  const { url } = competitorInputSchema.parse(input);
  const normalized = normalizeCompetitorUrl(url);
  const existing = await db.competitor.findUnique({ where: { channelId_normalizedUrl: { channelId, normalizedUrl: normalized.url } } });
  if (existing) throw new AppError("DUPLICATE_COMPETITOR", "Competitor URL này đã tồn tại trong Channel.", 409);
  return db.competitor.create({ data: { channelId, ...normalized, normalizedUrl: normalized.url, displayName: normalized.handle, avatar: null } });
}

export async function updateCompetitor(id: string, userId: string, input: unknown) {
  const { status } = competitorStatusSchema.parse(input);
  const competitor = await db.competitor.findFirst({ where: { id, channel: { userId } } });
  if (!competitor) throw new AppError("COMPETITOR_NOT_FOUND", "Không tìm thấy competitor.", 404);
  return db.competitor.update({ where: { id }, data: { status } });
}

export async function deleteCompetitor(id: string, userId: string) {
  const competitor = await db.competitor.findFirst({ where: { id, channel: { userId } } });
  if (!competitor) throw new AppError("COMPETITOR_NOT_FOUND", "Không tìm thấy competitor.", 404);
  return db.competitor.update({ where: { id }, data: { status: "INACTIVE" } });
}
