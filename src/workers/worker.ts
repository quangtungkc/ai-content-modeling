import { logger } from "@/lib/logger";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { handleJob } from "@/workers/job-handler";
import { pumpPendingRuntimeFailures, reportBackgroundJobFailure, reportStalledBackgroundJob, reportWorkerProcessFailure, requeueStaleRuntimeFailures } from "@/modules/codex-orchestrator/runtime-failure";
import type { QueuedJob } from "@/lib/jobs/types";

const queue = new LocalJobQueue();
let activeJob: QueuedJob | null = null;
let fatalHandling = false;

async function reportFatal(error: unknown, source: string) {
  if (fatalHandling) return;
  fatalHandling = true;
  logger.error(source, { error: error instanceof Error ? error.message : String(error), jobId: activeJob?.jobId });
  try { await reportWorkerProcessFailure(source, error, activeJob); } catch (reportError) { logger.error("Không gửi được lỗi worker về Codex", { error: reportError instanceof Error ? reportError.message : String(reportError) }); }
  process.exitCode = 1;
}

process.on("uncaughtException", (error) => { void reportFatal(error, "Worker uncaught exception").finally(() => process.exit(1)); });
process.on("unhandledRejection", (reason) => { void reportFatal(reason, "Worker unhandled rejection").finally(() => process.exit(1)); });

async function run() {
  logger.info("Background worker started");
  const staleJobs = await queue.findStale(new Date(Date.now() - 5 * 60_000));
  for (const staleJob of staleJobs) {
    try { await reportBackgroundJobFailure(staleJob, new Error("Job bị gián đoạn quá 5 phút; worker sẽ resume từ checkpoint.")); } catch (error) { logger.error("Không ghi được lỗi job stale về Codex", { jobId: staleJob.jobId, error: error instanceof Error ? error.message : String(error) }); }
  }
  await queue.requeueStale(new Date(Date.now() - 5 * 60_000));
  await requeueStaleRuntimeFailures(new Date(Date.now() - 5 * 60_000));
  let lastRuntimeSweep = 0;
  while (true) {
    if (Date.now() - lastRuntimeSweep >= 60_000) { lastRuntimeSweep = Date.now(); try { await pumpPendingRuntimeFailures(); } catch (error) { logger.error("Không quét được hàng đợi lỗi runtime", { error: error instanceof Error ? error.message : String(error) }); } }
    const job = await queue.claim();
    if (!job) { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
    activeJob = job;
    const heartbeat = setInterval(() => void queue.touch(job.jobId), 30_000);
    const stallWatchdog = job.name === "codex.runtime.failure" ? undefined : setTimeout(() => {
      void reportStalledBackgroundJob(job).catch((error) => logger.error("Không ghi được cảnh báo job treo về Codex", { jobId: job.jobId, error: error instanceof Error ? error.message : String(error) }));
    }, 5 * 60_000);
    try { await handleJob(job.name, job.payload); await queue.markSucceeded(job); logger.info("Job succeeded", { jobId: job.jobId, name: job.name }); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Unknown job failure";
      try { await queue.markFailed(job, message); } catch (markError) { logger.error("Không cập nhật được trạng thái job lỗi", { jobId: job.jobId, error: markError instanceof Error ? markError.message : String(markError) }); }
      try { await reportBackgroundJobFailure(job, error); } catch (reportError) { logger.error("Không gửi được lỗi job về Codex", { jobId: job.jobId, error: reportError instanceof Error ? reportError.message : String(reportError) }); }
      logger.error("Job failed", { jobId: job.jobId, name: job.name, message, attempt: job.attempts + 1 });
    }
    finally { clearInterval(heartbeat); if (stallWatchdog) clearTimeout(stallWatchdog); activeJob = null; }
  }
}

run().catch((error: unknown) => { void reportFatal(error, "Worker stopped").finally(() => process.exit(1)); });
