import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { updateAssetStatus } from "@/modules/assets/service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await updateAssetStatus(id, session.userId, await request.json()), requestId }); } catch (error) { const normalized = error instanceof ZodError ? new AppError("VALIDATION_ERROR", "Asset status không hợp lệ.", 400, error.flatten()) : error; return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : normalized, requestId); } }
