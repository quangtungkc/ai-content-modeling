import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { listProjectAssets, registerAsset } from "@/modules/assets/service";

type Context = { params: Promise<{ id: string }> };
const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;

export async function GET(_request: Request, context: Context) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await listProjectAssets(id, session.userId), requestId }); } catch (error) { return toErrorResponse(normalize(error), requestId); } }
export async function POST(request: Request, context: Context) { const requestId = randomUUID(); try { const session = await getRequiredSession(); const { id } = await context.params; return Response.json({ data: await registerAsset(id, session.userId, await request.json()), requestId }, { status: 201 }); } catch (error) { const normalized = error instanceof ZodError ? new AppError("VALIDATION_ERROR", "Asset metadata không hợp lệ.", 400, error.flatten()) : error; return toErrorResponse(normalize(normalized), requestId); } }
