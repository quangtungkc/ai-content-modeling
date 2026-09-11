import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const job = await db.backgroundJob.findUnique({ where: { id }, select: { id: true, name: true, status: true, payload: true, idempotencyKey: true, attempts: true, maxAttempts: true } });
    if (!job || !job.name.startsWith("desktop.flow.")) throw new AppError("DESKTOP_FLOW_JOB_NOT_FOUND", "Không tìm thấy job Google Flow.", 404);
    if (record(job.payload).userId !== session.userId) throw new AppError("DESKTOP_FLOW_JOB_FORBIDDEN", "Job Google Flow không thuộc phiên desktop hiện tại.", 403);
    const claimed = await db.backgroundJob.updateMany({ where: { id, status: "queued" }, data: { status: "running", startedAt: new Date(), error: null } });
    if (!claimed.count) return Response.json({ data: null, requestId });
    return Response.json({ data: { id: job.id, name: job.name, payload: job.payload, idempotencyKey: job.idempotencyKey, attempts: job.attempts, maxAttempts: job.maxAttempts }, requestId });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  }
}
