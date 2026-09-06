export type JobStatus = "queued" | "running" | "succeeded" | "failed";
export type JobPayload = Record<string, unknown>;
export type QueuedJob = { jobId: string; name: string; payload: JobPayload; idempotencyKey: string; attempts: number; maxAttempts: number };

export interface JobQueue {
  enqueue(name: string, payload: JobPayload, idempotencyKey: string): Promise<{ jobId: string }>;
}
