import { Prisma, UsageMetric } from "@prisma/client";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

export type UsageContext = { userId: string; channelId?: string; projectId?: string };
export type UsageRecord = UsageContext & { metric: UsageMetric; quantity?: number; inputTokens?: number; outputTokens?: number; bytes?: bigint; idempotencyKey: string; metadata?: Prisma.InputJsonValue };

function startOfDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }

export async function recordUsage(record: UsageRecord) {
  try {
    return await db.usageEvent.create({ data: { idempotencyKey: record.idempotencyKey, userId: record.userId, channelId: record.channelId, projectId: record.projectId, metric: record.metric, quantity: record.quantity ?? 1, inputTokens: record.inputTokens, outputTokens: record.outputTokens, bytes: record.bytes, usageDate: startOfDay(new Date()), metadata: record.metadata } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return null;
    logger.error("Usage recording failed", { metric: record.metric, userId: record.userId, channelId: record.channelId, projectId: record.projectId });
    return null;
  }
}

export async function getUsageSummary(userId: string, from?: Date, to?: Date) {
  const events = await db.usageEvent.findMany({ where: { userId, ...(from || to ? { usageDate: { ...(from ? { gte: startOfDay(from) } : {}), ...(to ? { lte: startOfDay(to) } : {}) } } : {}) }, orderBy: { usageDate: "desc" } });
  const totals = new Map<UsageMetric, { quantity: number; inputTokens: number; outputTokens: number; bytes: bigint }>();
  for (const event of events) { const current = totals.get(event.metric) ?? { quantity: 0, inputTokens: 0, outputTokens: 0, bytes: BigInt(0) }; current.quantity += event.quantity; current.inputTokens += event.inputTokens ?? 0; current.outputTokens += event.outputTokens ?? 0; current.bytes += event.bytes ?? BigInt(0); totals.set(event.metric, current); }
  return { totals: Object.fromEntries([...totals.entries()].map(([metric, value]) => [metric, { ...value, bytes: value.bytes.toString() }])), events: events.map((event) => ({ ...event, bytes: event.bytes?.toString() ?? null })) };
}
