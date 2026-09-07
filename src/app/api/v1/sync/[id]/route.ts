import Redis from "ioredis";
import { getRequiredSession } from "@/lib/auth/provider";
import { getRequiredRedisUrl } from "@/lib/env";
import { AppError, toErrorResponse } from "@/lib/errors";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  let redis: Redis | undefined;
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    redis = new Redis(getRequiredRedisUrl());
    const progress = await redis.hgetall(`sync:${id}`);
    if (!progress.userId || progress.userId !== session.userId) {
      throw new AppError("SYNC_NOT_FOUND", "Không tìm thấy tiến trình đồng bộ.", 404);
    }
    return Response.json({
      data: {
        syncId: id,
        status: progress.status,
        total: Number(progress.total ?? 0),
        processed: Number(progress.processed ?? 0),
        failed: Number(progress.failed ?? 0),
        error: progress.error ?? null,
      },
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  } finally {
    await redis?.quit();
  }
}
