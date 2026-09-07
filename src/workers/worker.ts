import { logger } from "@/lib/logger";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { handleJob } from "@/workers/job-handler";

const queue = new LocalJobQueue();

async function run() {
  logger.info("Background worker started");
  while (true) {
    const job = await queue.claim();
    if (!job) { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
    try { await handleJob(job.name, job.payload); await queue.markSucceeded(job); logger.info("Job succeeded", { jobId: job.jobId, name: job.name }); }
    catch (error) { const message = error instanceof Error ? error.message : "Unknown job failure"; await queue.markFailed(job, message); logger.error("Job failed", { jobId: job.jobId, name: job.name, message, attempt: job.attempts + 1 }); }
  }
}

run().catch((error: unknown) => { logger.error("Worker stopped", { error: error instanceof Error ? error.message : "unknown" }); process.exitCode = 1; });
