import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { redactSecrets } from "@/modules/codex-orchestrator/policy";

const schema = z.object({
  status: z.enum(["succeeded", "failed"]),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().trim().max(4_000).optional(),
});

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const job = await db.backgroundJob.findUnique({ where: { id }, select: { id: true, name: true, status: true, payload: true } });
    if (!job || !job.name.startsWith("desktop.flow.")) throw new AppError("DESKTOP_FLOW_JOB_NOT_FOUND", "Không tìm thấy job Google Flow.", 404);
    if (record(job.payload).userId !== session.userId) throw new AppError("DESKTOP_FLOW_JOB_FORBIDDEN", "Job Google Flow không thuộc phiên desktop hiện tại.", 403);
    if (job.status !== "running" && job.status !== input.status) throw new AppError("DESKTOP_FLOW_JOB_STATE", "Job Google Flow không còn ở trạng thái đang chạy.", 409);
    const nextPayload = { ...record(job.payload), bridgeStatus: input.status === "succeeded" ? "SUCCEEDED" : "FAILED", bridgeResult: input.status === "succeeded" ? redactSecrets(input.result ?? {}) : null, bridgeCompletedAt: new Date().toISOString() };
    await db.backgroundJob.update({ where: { id }, data: { status: input.status, error: input.status === "failed" ? redactSecrets(input.error ?? "Google Flow không hoàn tất.") : null, completedAt: new Date(), payload: nextPayload as Prisma.InputJsonValue } });
    return Response.json({ data: { id, status: input.status }, requestId });
  } catch (error) {
    const normalized = error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Kết quả Google Flow không hợp lệ.", 400, error.flatten()) : error;
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : normalized, requestId);
  }
}
