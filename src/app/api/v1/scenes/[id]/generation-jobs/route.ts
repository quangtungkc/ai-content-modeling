import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { getRequiredSession } from "@/lib/auth/provider";
import { getRequiredRedisUrl } from "@/lib/env";
import { AppError, toErrorResponse } from "@/lib/errors";
import { createGenerationJob } from "@/modules/generation/job-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { const requestId = randomUUID(); let redis: Redis | undefined; try { redis = new Redis(getRequiredRedisUrl()); const session = await getRequiredSession(); const { id } = await context.params; const job = await createGenerationJob(id, session.userId, await request.json(), redis); return Response.json({ data: job, requestId }, { status: 202 }); } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); } finally { await redis?.quit(); } }
