import { logger } from "@/lib/logger";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { handleJob } from "@/workers/job-handler";

const queue = new LocalJobQueue();

async function run() {
  logger.info("Background worker started");
  await queue.requeueStale(new Date(Date.now() - 5 * 60_000));
  while (true) {
    const job = await queue.claim();
    if (!job) { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
    const heartbeat = setInterval(() => void queue.touch(job.jobId), 30_000);
    try { await handleJob(job.name, job.payload); await queue.markSucceeded(job); logger.info("Job succeeded", { jobId: job.jobId, name: job.name }); }
    catch (error) { const message = error instanceof Error ? error.message : "Unknown job failure"; await queue.markFailed(job, message); logger.error("Job failed", { jobId: job.jobId, name: job.name, message, attempt: job.attempts + 1 }); }
    finally { clearInterval(heartbeat); }
  }
}

run().catch((error: unknown) => { logger.error("Worker stopped", { error: error instanceof Error ? error.message : "unknown" }); process.exitCode = 1; });
