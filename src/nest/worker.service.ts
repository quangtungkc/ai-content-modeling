import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { handleJob } from "@/workers/job-handler";
import { getActiveWorkerJob, pumpPendingRuntimeFailures, reportBackgroundJobFailure, reportStalledBackgroundJob, reportWorkerProcessFailure, requeueStaleRuntimeFailures, setActiveWorkerJob } from "@/modules/codex-orchestrator/runtime-failure";

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly queue = new LocalJobQueue();
  private stopped = false;

  async onModuleInit() {
    void this.run().catch(async (error) => {
      this.logger.error(`Worker loop bị gián đoạn: ${error instanceof Error ? error.message : String(error)}`);
      try { await reportWorkerProcessFailure("NestJS worker loop stopped", error, getActiveWorkerJob()); } catch (reportError) { this.logger.error(`Không gửi được lỗi worker loop về Codex: ${reportError instanceof Error ? reportError.message : String(reportError)}`); }
    });
  }

  async onModuleDestroy() {
    this.stopped = true;
  }

  private async run() {
    this.logger.log("NestJS background worker started");
    const staleJobs = await this.queue.findStale(new Date(Date.now() - 5 * 60_000));
    for (const staleJob of staleJobs) {
      try { await reportBackgroundJobFailure(staleJob, new Error("Job bị gián đoạn quá 5 phút; worker sẽ resume từ checkpoint.")); } catch (error) { this.logger.error(`Không ghi được lỗi job stale về Codex: ${error instanceof Error ? error.message : String(error)}`); }
    }
    await this.queue.requeueStale(new Date(Date.now() - 5 * 60_000));
    await requeueStaleRuntimeFailures(new Date(Date.now() - 5 * 60_000));
    let lastRuntimeSweep = 0;
    while (!this.stopped) {
      if (Date.now() - lastRuntimeSweep >= 60_000) { lastRuntimeSweep = Date.now(); try { await pumpPendingRuntimeFailures(); } catch (error) { this.logger.error(`Không quét được hàng đợi lỗi runtime: ${error instanceof Error ? error.message : String(error)}`); } }
      const job = await this.queue.claim();
      if (!job) { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
      setActiveWorkerJob(job);
      const heartbeat = setInterval(() => void this.queue.touch(job.jobId), 30_000);
      const stallWatchdog = job.name === "codex.runtime.failure" ? undefined : setTimeout(() => {
        void reportStalledBackgroundJob(job).catch((error) => this.logger.error(`Không ghi được cảnh báo job treo về Codex: ${error instanceof Error ? error.message : String(error)}`));
      }, 5 * 60_000);
      try {
        await handleJob(job.name, job.payload);
        await this.queue.markSucceeded(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown job failure";
        try { await this.queue.markFailed(job, message); } catch (markError) { this.logger.error(`Không cập nhật được trạng thái job lỗi: ${markError instanceof Error ? markError.message : String(markError)}`); }
        try { await reportBackgroundJobFailure(job, error); } catch (reportError) { this.logger.error(`Không gửi được lỗi job về Codex: ${reportError instanceof Error ? reportError.message : String(reportError)}`); }
        this.logger.error(`Job ${job.jobId} failed: ${message}`);
      } finally {
        clearInterval(heartbeat);
        if (stallWatchdog) clearTimeout(stallWatchdog);
        setActiveWorkerJob(null);
      }
    }
  }
}
