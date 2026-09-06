import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { listVideoMetricSnapshots, recordVideoMetricSnapshot } from "@/modules/videos/service";

type Context = { params: Promise<{ id: string }> };
const normalizeError = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;

export async function GET(_request: Request, context: Context) {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await listVideoMetricSnapshots(id, session.userId), requestId }); }
  catch (error) { return toErrorResponse(normalizeError(error), requestId); }
}

export async function POST(request: Request, context: Context) {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await recordVideoMetricSnapshot(id, session.userId, await request.json()), requestId }, { status: 201 }); }
  catch (error) { const normalized = error instanceof ZodError ? new AppError("VALIDATION_ERROR", "Metric snapshot không hợp lệ.", 400, error.flatten()) : error; return toErrorResponse(normalizeError(normalized), requestId); }
}
