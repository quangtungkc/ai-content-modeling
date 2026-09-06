import Redis from "ioredis";
import type { JobPayload, JobQueue, QueuedJob } from "./types";

export class RedisJobQueue implements JobQueue {
  constructor(private readonly redis: Redis) {}

  async enqueue(name: string, payload: JobPayload, idempotencyKey: string) {
    const jobId = crypto.randomUUID();
    const existingJobId = await this.redis.get(`job:dedupe:${idempotencyKey}`);
    if (existingJobId) return { jobId: existingJobId };
    const claimed = await this.redis.set(`job:dedupe:${idempotencyKey}`, jobId, "EX", 86400, "NX");
    if (!claimed) return { jobId: (await this.redis.get(`job:dedupe:${idempotencyKey}`)) ?? jobId };
    await this.redis.hset(`job:${jobId}`, { name, payload: JSON.stringify(payload), idempotencyKey, status: "queued", attempts: 0, maxAttempts: 3 });
    await this.redis.lpush("jobs:pending", jobId);
    return { jobId };
  }

  async claim(timeoutSeconds = 30): Promise<QueuedJob | null> {
    const result = await this.redis.brpoplpush("jobs:pending", "jobs:processing", timeoutSeconds);
    if (!result) return null;
    const data = await this.redis.hgetall(`job:${result}`);
    return { jobId: result, name: data.name, payload: JSON.parse(data.payload) as JobPayload, idempotencyKey: data.idempotencyKey, attempts: Number(data.attempts), maxAttempts: Number(data.maxAttempts) };
  }

  async markSucceeded(job: QueuedJob) {
    await this.redis.hset(`job:${job.jobId}`, { status: "succeeded", completedAt: new Date().toISOString() });
    await this.redis.lrem("jobs:processing", 1, job.jobId);
  }

  async markFailed(job: QueuedJob, error: string) {
    const attempts = job.attempts + 1;
    const status = attempts >= job.maxAttempts ? "failed" : "queued";
    await this.redis.hset(`job:${job.jobId}`, { status, attempts, error, failedAt: new Date().toISOString() });
    await this.redis.lrem("jobs:processing", 1, job.jobId);
    if (status === "queued") await this.redis.lpush("jobs:pending", job.jobId);
  }
}
