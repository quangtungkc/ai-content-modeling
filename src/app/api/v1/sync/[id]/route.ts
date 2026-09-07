import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const requestId = crypto.randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const progress = await db.syncRun.findFirst({ where: { id, userId: session.userId } });
    if (!progress) {
      throw new AppError("SYNC_NOT_FOUND", "Không tìm thấy tiến trình đồng bộ.", 404);
    }
    return Response.json({
      data: {
        syncId: id,
        status: progress.status,
        total: progress.total,
        processed: progress.processed,
        failed: progress.failed,
        error: progress.error ?? null,
      },
      requestId,
    });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  }
}
