import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; const channel = await db.channel.findFirst({ where: { id, userId: session.userId }, select: { id: true } }); if (!channel) throw new AppError("CHANNEL_NOT_FOUND", "Không tìm thấy Channel.", 404); return Response.json({ data: await db.dailyReport.findMany({ where: { channelId: id }, include: { items: { include: { sourceVideo: true }, orderBy: { rank: "asc" } } }, orderBy: { localDate: "desc" } }), requestId }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } }
