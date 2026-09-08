import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { developApprovedIdea } from "@/modules/ideas/approval-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; const body = await request.json().catch(() => ({})) as { aspectRatio?: string }; return Response.json({ data: await developApprovedIdea(id, session.userId, undefined, body.aspectRatio?.trim() || "9:16"), requestId }, { status: 201 }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } }
