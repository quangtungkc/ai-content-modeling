import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { saveIdea } from "@/modules/ideas/approval-service";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await saveIdea(id, session.userId), requestId }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } }
