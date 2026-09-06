import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getChannel, updateChannel, deleteChannel } from "@/modules/channels/service";

type Context = { params: Promise<{ id: string }> };
const authError = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;

export async function GET(_request: Request, context: Context) {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await getChannel(id, session.userId), requestId }); }
  catch (error) { return toErrorResponse(authError(error), requestId); }
}

export async function PATCH(request: Request, context: Context) {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await updateChannel(id, session.userId, await request.json()), requestId }); }
  catch (error) { const normalized = error instanceof ZodError ? new AppError("VALIDATION_ERROR", "Dữ liệu Channel không hợp lệ.", 400, error.flatten()) : error; return toErrorResponse(authError(normalized), requestId); }
}

export async function DELETE(_request: Request, context: Context) {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); const { id } = await context.params; await deleteChannel(id, session.userId); return new Response(null, { status: 204 }); }
  catch (error) { return toErrorResponse(authError(error), requestId); }
}
