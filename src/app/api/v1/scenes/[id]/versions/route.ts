import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { listSceneVersions, reviewSceneVersion } from "@/modules/generation/review-service";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await listSceneVersions(id, session.userId), requestId }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } }
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await reviewSceneVersion(id, session.userId, await request.json()), requestId }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } }
