import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { confirmDesktopFlowRuntime } from "@/modules/codex-orchestrator/service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const lastRuntimeConfirmation = new Map<string, number>();

export async function GET(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const runtimeRevision = request.headers.get("x-modeling-flow-bridge-revision") ?? "";
    const appVersion = request.headers.get("x-modeling-app-version");
    const lastConfirmedAt = lastRuntimeConfirmation.get(session.userId) ?? 0;
    if (runtimeRevision && Date.now() - lastConfirmedAt >= 10_000) {
      lastRuntimeConfirmation.set(session.userId, Date.now());
      await confirmDesktopFlowRuntime(session.userId, runtimeRevision, appVersion);
    }
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
