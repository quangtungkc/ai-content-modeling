import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { confirmDesktopFlowRuntime } from "@/modules/codex-orchestrator/service";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

const lastRuntimeConfirmation = new Map<string, number>();
// Electron heartbeats a claimed Flow job every 30 seconds. Two missed
// heartbeats means the desktop bridge is gone, so recover from its checkpoint
// promptly instead of leaving the automatic run stuck for five minutes.
const FLOW_BRIDGE_STALE_AFTER_MS = 90_000;

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
    await db.backgroundJob.updateMany({
      where: {
        status: "running",
        OR: [{ name: { startsWith: "desktop.flow." } }, { name: { startsWith: "desktop.gemini." } }],
        startedAt: { lt: new Date(Date.now() - FLOW_BRIDGE_STALE_AFTER_MS) },
      },
      data: { status: "queued", startedAt: null, error: "Electron Flow mất heartbeat quá 90 giây; job được resume từ checkpoint." },
    });
    const jobs = await db.backgroundJob.findMany({
      where: { status: "queued", OR: [{ name: { startsWith: "desktop.flow." } }, { name: { startsWith: "desktop.gemini." } }] },
      // Pull a wider window so a new source-analysis job cannot be hidden
      // behind an old recovery backlog; priority is applied after ownership.
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, name: true, payload: true, idempotencyKey: true, attempts: true, maxAttempts: true, createdAt: true },
    });
    const priority = (job: typeof jobs[number]) => {
      const purpose = record(job.payload).purpose;
      return purpose === "SOURCE_ANALYSIS" ? 0 : purpose === "REPAIR_PROMPT" ? 2 : 1;
    };
    const visibleJobs = jobs
      .filter((job) => record(job.payload).userId === session.userId)
      .sort((left, right) => priority(left) - priority(right) || right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 8);
    return Response.json({ data: visibleJobs.map((job) => ({ id: job.id, name: job.name, payload: job.payload, idempotencyKey: job.idempotencyKey, attempts: job.attempts, maxAttempts: job.maxAttempts })), requestId });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  }
}
