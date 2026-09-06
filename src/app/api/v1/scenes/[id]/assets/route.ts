import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getSceneAssets, replaceSceneAssets } from "@/modules/assets/mapping-service";

type Context = { params: Promise<{ id: string }> };
const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;

export async function GET(_request: Request, context: Context) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await getSceneAssets(id, session.userId), requestId }); } catch (error) { return toErrorResponse(normalize(error), requestId); } }
export async function PUT(request: Request, context: Context) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await replaceSceneAssets(id, session.userId, await request.json()), requestId }); } catch (error) { const normalized = error instanceof ZodError ? new AppError("VALIDATION_ERROR", "Danh sách asset không hợp lệ.", 400, error.flatten()) : error; return toErrorResponse(normalize(normalized), requestId); } }
