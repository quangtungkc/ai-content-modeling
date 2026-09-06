import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { createChannel, listChannels } from "@/modules/channels/service";

export async function GET() {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); return Response.json({ data: await listChannels(session.userId), requestId }); }
  catch (error) { logger.error("List channels failed", { requestId }); return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); return Response.json({ data: await createChannel(session.userId, await request.json()), requestId }, { status: 201 }); }
  catch (error) { const normalized = error instanceof ZodError ? new AppError("VALIDATION_ERROR", "Dữ liệu Channel không hợp lệ.", 400, error.flatten()) : error; return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : normalized, requestId); }
}
