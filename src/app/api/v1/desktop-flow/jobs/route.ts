import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function GET() {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const jobs = await db.backgroundJob.findMany({
      where: { status: "queued", name: { startsWith: "desktop.flow." } },
      orderBy: { createdAt: "asc" },
      take: 8,
      select: { id: true, name: true, payload: true, idempotencyKey: true, attempts: true, maxAttempts: true },
    });
    return Response.json({ data: jobs.filter((job) => record(job.payload).userId === session.userId).map((job) => ({ id: job.id, name: job.name, payload: job.payload, idempotencyKey: job.idempotencyKey, attempts: job.attempts, maxAttempts: job.maxAttempts })), requestId });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  }
}
