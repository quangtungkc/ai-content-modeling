import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getGenerationJob } from "@/modules/generation/job-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await getGenerationJob(id, session.userId), requestId }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } }
