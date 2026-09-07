import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { JobPayload, JobQueue, QueuedJob } from "./types";

export class LocalJobQueue implements JobQueue {
  async enqueue(name: string, payload: JobPayload, idempotencyKey: string) {
    const existing = await db.backgroundJob.findUnique({ where: { idempotencyKey }, select: { id: true } });
    if (existing) return { jobId: existing.id };
    const job = await db.backgroundJob.create({ data: { id: randomUUID(), name, payload: payload as Prisma.InputJsonValue, idempotencyKey }, select: { id: true } });
    return { jobId: job.id };
  }

  async claim(): Promise<QueuedJob | null> {
    const job = await db.backgroundJob.findFirst({ where: { status: "queued" }, orderBy: { createdAt: "asc" } });
    if (!job) return null;
    const claimed = await db.backgroundJob.updateMany({ where: { id: job.id, status: "queued" }, data: { status: "running", startedAt: new Date() } });
    if (!claimed.count) return this.claim();
    return { jobId: job.id, name: job.name, payload: job.payload as JobPayload, idempotencyKey: job.idempotencyKey, attempts: job.attempts, maxAttempts: job.maxAttempts };
  }

  async markSucceeded(job: QueuedJob) {
    await db.backgroundJob.update({ where: { id: job.jobId }, data: { status: "succeeded", completedAt: new Date(), error: null } });
  }

  async markFailed(job: QueuedJob, error: string) {
    const attempts = job.attempts + 1;
    await db.backgroundJob.update({ where: { id: job.jobId }, data: { status: attempts >= job.maxAttempts ? "failed" : "queued", attempts, error, startedAt: null, completedAt: attempts >= job.maxAttempts ? new Date() : null } });
  }
}
