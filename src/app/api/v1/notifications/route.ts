import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";

export async function GET() { const requestId = randomUUID(); try { const session = await getRequiredSession(); return Response.json({ data: await db.inAppNotification.findMany({ where: { userId: session.userId }, orderBy: { createdAt: "desc" }, take: 50 }), requestId }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } }
