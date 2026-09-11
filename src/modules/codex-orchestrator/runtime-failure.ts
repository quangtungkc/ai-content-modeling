import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { ensureCodexStorage } from "./storage";
import { appendCodexEvent, reportCodexEvent } from "./service";
import { classifyFailure, createErrorSignature, redactSecrets } from "./policy";
import { CodexReasoner } from "./reasoner";
import { CODEX_STAGES, type CodexStage, type FailureKind } from "./types";

const MAX_MESSAGE_LENGTH = 4_000;
const MAX_STACK_LENGTH = 12_000;
const MAX_CONTEXT_LENGTH = 24_000;
const validStages = new Set<string>(CODEX_STAGES);
type ActiveWorkerJob = { jobId: string; name: string; payload: Record<string, unknown> };
const runtimeState = globalThis as typeof globalThis & { __viralModelingActiveWorkerJob?: ActiveWorkerJob | null };

export type RuntimeFailureInput = {
  userId?: string | null;
  codexJobId?: string | null;
  backgroundJobId?: string | null;
  source: string;
  stage?: string | null;
  code?: string;
  failureKind?: FailureKind;
  error: unknown;
  context?: Record<string, unknown>;
  dispatch?: boolean;
};

export function setActiveWorkerJob(job: ActiveWorkerJob | null) {
  runtimeState.__viralModelingActiveWorkerJob = job;
}

export function getActiveWorkerJob() {
  return runtimeState.__viralModelingActiveWorkerJob ?? null;
}

function errorDetails(error: unknown) {
  if (error instanceof Error) return { message: error.message, stack: error.stack ?? error.message, name: error.name };
  if (typeof error === "string") return { message: error, stack: error };
  return { message: "Unknown runtime failure.", stack: JSON.stringify(error) };
}

function compactContext(value: Record<string, unknown> | undefined) {
  const redacted = redactSecrets(value ?? {});
  const serialized = JSON.stringify(redacted);
  if (!serialized || serialized.length <= MAX_CONTEXT_LENGTH) return redacted;
  return { truncated: true, preview: serialized.slice(0, MAX_CONTEXT_LENGTH) };
}

function safeStage(stage: string | null | undefined): CodexStage | undefined {
  return stage && validStages.has(stage) ? stage as CodexStage : undefined;
}

function safeCode(code: string | undefined, source: string) {
  return (code || `${source.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_FAILED`).slice(0, 120);
}

export async function resolveRuntimeUserId(input: { userId?: unknown; codexJobId?: unknown; channelId?: unknown; syncId?: unknown; generationJobId?: unknown }) {
  if (typeof input.userId === "string" && input.userId) return input.userId;
  if (typeof input.codexJobId === "string" && input.codexJobId) {
    const job = await db.codexJob.findUnique({ where: { id: input.codexJobId }, select: { userId: true } });
    if (job) return job.userId;
  }
  if (typeof input.channelId === "string" && input.channelId) {
    const channel = await db.channel.findUnique({ where: { id: input.channelId }, select: { userId: true } });
    if (channel) return channel.userId;
  }
  if (typeof input.syncId === "string" && input.syncId) {
    const sync = await db.syncRun.findUnique({ where: { id: input.syncId }, select: { userId: true } });
    if (sync) return sync.userId;
  }
  if (typeof input.generationJobId === "string" && input.generationJobId) {
    const generation = await db.videoGenerationJob.findUnique({
      where: { id: input.generationJobId },
      select: { scene: { select: { project: { select: { channel: { select: { userId: true } } } } } } },
    });
    return generation?.scene.project.channel.userId ?? null;
  }
  return null;
}

async function findCodexJobId(input: RuntimeFailureInput, userId: string | null) {
  if (input.codexJobId) {
    const owned = await db.codexJob.findFirst({ where: { id: input.codexJobId, ...(userId ? { userId } : {}) }, select: { id: true } });
    return owned?.id ?? null;
  }
  const context = input.context ?? {};
  const fromContext = context.codexJobId;
  if (typeof fromContext === "string" && fromContext && userId) {
    const owned = await db.codexJob.findFirst({ where: { id: fromContext, userId }, select: { id: true } });
    return owned?.id ?? null;
  }
  return null;
}

export async function reportRuntimeFailure(input: RuntimeFailureInput) {
  await ensureCodexStorage();
  const details = errorDetails(input.error);
  const message = redactSecrets(details.message).slice(0, MAX_MESSAGE_LENGTH);
  const stack = redactSecrets(details.stack).slice(0, MAX_STACK_LENGTH);
  const userId = await resolveRuntimeUserId({ userId: input.userId, codexJobId: input.codexJobId, channelId: input.context?.channelId, syncId: input.context?.syncId, generationJobId: input.context?.generationJobId });
  const codexJobId = await findCodexJobId(input, userId);
  const stage = safeStage(input.stage);
  const failureKind = input.failureKind ?? classifyFailure(message);
  const context = compactContext({ ...input.context, errorName: details.name, failureKind, errorSignature: createErrorSignature(stage ?? "ANALYSIS", message) });
  const failure = await db.runtimeFailure.create({
    data: {
      userId,
      codexJobId,
      backgroundJobId: input.backgroundJobId ?? null,
      source: input.source.slice(0, 120),
      stage,
      failureKind,
      code: safeCode(input.code, input.source),
      message,
      stack,
      context: context as Prisma.InputJsonValue,
    },
  });

  if (codexJobId && userId) {
    try {
      await appendCodexEvent(codexJobId, "RUNTIME_FAILURE_REPORTED", stage, { runtimeFailureId: failure.id, source: input.source, code: failure.code, message, context });
      if (input.source.includes("worker") || input.source.includes("server")) await appendCodexEvent(codexJobId, "WORKER_CRASHED", stage, { runtimeFailureId: failure.id, source: input.source });
      await appendCodexEvent(codexJobId, "CODEX_WAKE_REQUESTED", stage, { runtimeFailureId: failure.id, source: input.source });
      if (stage) {
        await reportCodexEvent(userId, codexJobId, { type: "STAGE_FAILED", stage, error: message, actualState: { runtimeFailureId: failure.id, source: input.source, context }, provider: input.source });
        await db.runtimeFailure.update({ where: { id: failure.id }, data: { status: "RECOVERY_REQUESTED", resolvedAt: new Date() } });
      } else {
        await new LocalJobQueue().enqueue("codex.job.execute", { jobId: codexJobId, userId }, `codex-runtime-wake:${failure.id}`);
        await db.runtimeFailure.update({ where: { id: failure.id }, data: { status: "QUEUED" } });
      }
      return failure;
    } catch (dispatchError) {
      logger.error("Unable to wake Codex for runtime failure", { runtimeFailureId: failure.id, error: dispatchError instanceof Error ? dispatchError.message : "unknown" });
      try { await appendCodexEvent(codexJobId, "CODEX_WAKE_FAILED", stage, { runtimeFailureId: failure.id, error: dispatchError instanceof Error ? dispatchError.message : "unknown" }); } catch { /* Keep the primary failure when the event store is also unavailable. */ }
    }
  }

  if (input.dispatch !== false && userId && getEnv().CODEX_ORCHESTRATOR_ENABLED) {
    await new LocalJobQueue().enqueue("codex.runtime.failure", { runtimeFailureId: failure.id, userId }, `codex-runtime-report:${failure.id}`);
    await db.runtimeFailure.update({ where: { id: failure.id }, data: { status: "QUEUED" } });
  }
  return failure;
}

export async function dispatchRuntimeFailure(runtimeFailureId: string) {
  await ensureCodexStorage();
  const failure = await db.runtimeFailure.findUnique({ where: { id: runtimeFailureId } });
  if (!failure || ["SENT_TO_CODEX", "RECOVERY_REQUESTED"].includes(failure.status)) return failure;
  if (!failure.userId) {
    return db.runtimeFailure.update({ where: { id: runtimeFailureId }, data: { status: "NEEDS_USER_CONTEXT", attempts: { increment: 1 }, lastAttemptAt: new Date() } });
  }
  await db.runtimeFailure.update({ where: { id: runtimeFailureId }, data: { status: "SENDING", attempts: { increment: 1 }, lastAttemptAt: new Date() } });
  try {
    const result = await new CodexReasoner().decide(failure.userId, {
      purpose: "RUNTIME_FAILURE",
      stage: safeStage(failure.stage),
      state: {
        runtimeFailureId: failure.id,
        source: failure.source,
        code: failure.code,
        failureKind: failure.failureKind,
        message: failure.message,
        stack: failure.stack,
        context: failure.context,
        backgroundJobId: failure.backgroundJobId,
        codexJobId: failure.codexJobId,
      },
      allowedTools: ["getLogs", "getFailureContext", "waitForHuman"],
    });
    const updatedContext = compactContext({ ...(failure.context as Record<string, unknown>), codexDecision: result.decision });
    return db.runtimeFailure.update({ where: { id: runtimeFailureId }, data: { status: "SENT_TO_CODEX", codexResponseId: result.responseId, context: updatedContext as Prisma.InputJsonValue, resolvedAt: new Date() } });
  } catch (error) {
    await db.runtimeFailure.update({ where: { id: runtimeFailureId }, data: { status: "PENDING", context: compactContext({ ...(failure.context as Record<string, unknown>), codexDispatchError: error instanceof Error ? error.message : "unknown" }) as Prisma.InputJsonValue } });
    throw error;
  }
}

export async function pumpPendingRuntimeFailures() {
  await ensureCodexStorage();
  if (!getEnv().CODEX_ORCHESTRATOR_ENABLED) return 0;
  const candidates = await db.runtimeFailure.findMany({
    where: { status: "PENDING", userId: { not: null }, OR: [{ lastAttemptAt: null }, { lastAttemptAt: { lt: new Date(Date.now() - 60_000) } }] },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true, userId: true },
  });
  let queued = 0;
  for (const candidate of candidates) {
    const claimed = await db.runtimeFailure.updateMany({ where: { id: candidate.id, status: "PENDING" }, data: { status: "QUEUED", lastAttemptAt: new Date() } });
    if (!claimed.count) continue;
    try {
      await new LocalJobQueue().enqueue("codex.runtime.failure", { runtimeFailureId: candidate.id, userId: candidate.userId }, `codex-runtime-retry:${candidate.id}:${Math.floor(Date.now() / 60_000)}`);
      queued += 1;
    } catch (error) {
      await db.runtimeFailure.update({ where: { id: candidate.id }, data: { status: "PENDING", context: compactContext({ retryQueueError: error instanceof Error ? error.message : "unknown" }) as Prisma.InputJsonValue } });
    }
  }
  return queued;
}

export async function requeueStaleRuntimeFailures(staleBefore: Date) {
  await ensureCodexStorage();
  return db.runtimeFailure.updateMany({ where: { status: "SENDING", lastAttemptAt: { lt: staleBefore } }, data: { status: "PENDING" } });
}

export async function reportBackgroundJobFailure(job: { jobId: string; name: string; payload: Record<string, unknown> }, error: unknown) {
  if (job.name === "codex.runtime.failure") return null;
  const payload = job.payload;
  const codexJobId = job.name === "codex.job.execute" && typeof payload.jobId === "string" ? payload.jobId : undefined;
  return reportRuntimeFailure({
    userId: typeof payload.userId === "string" ? payload.userId : undefined,
    codexJobId,
    backgroundJobId: job.jobId,
    source: `background-job:${job.name}`,
    stage: typeof payload.stage === "string" ? payload.stage : undefined,
    code: "BACKGROUND_JOB_FAILED",
    error,
    context: { jobName: job.name, channelId: payload.channelId, syncId: payload.syncId, generationJobId: job.name === "video.generate" ? payload.jobId : undefined, payload },
  });
}

export async function reportStalledBackgroundJob(job: { jobId: string; name: string; payload: Record<string, unknown> }) {
  if (job.name === "codex.runtime.failure") return null;
  const payload = job.payload;
  return reportRuntimeFailure({
    userId: typeof payload.userId === "string" ? payload.userId : undefined,
    backgroundJobId: job.jobId,
    source: "background-job:stall-watchdog",
    code: "JOB_STALLED_OVER_5_MINUTES",
    error: new Error("Job vẫn đang chạy sau 5 phút; Codex cần kiểm tra trạng thái và checkpoint."),
    context: {
      jobName: job.name,
      channelId: payload.channelId,
      syncId: payload.syncId,
      generationJobId: job.name === "video.generate" ? payload.jobId : undefined,
      observedAfterMs: 5 * 60_000,
      payload,
    },
  });
}

export async function reportWorkerProcessFailure(source: string, error: unknown, activeJob?: { jobId: string; name: string; payload: Record<string, unknown> } | null) {
  return reportRuntimeFailure({
    userId: activeJob?.payload.userId as string | undefined,
    codexJobId: activeJob?.name === "codex.job.execute" ? String(activeJob.payload.jobId ?? "") || undefined : undefined,
    backgroundJobId: activeJob?.jobId,
    source,
    code: "WORKER_PROCESS_INTERRUPTED",
    error,
    context: { activeJobName: activeJob?.name, channelId: activeJob?.payload.channelId, syncId: activeJob?.payload.syncId, generationJobId: activeJob?.name === "video.generate" ? activeJob.payload.jobId : undefined, activeJobPayload: activeJob?.payload },
  });
}
