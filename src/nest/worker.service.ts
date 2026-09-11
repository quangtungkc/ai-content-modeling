import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { handleJob } from "@/workers/job-handler";

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly queue = new LocalJobQueue();
  private stopped = false;

  async onModuleInit() {
    void this.run();
  }

  async onModuleDestroy() {
    this.stopped = true;
  }

  private async run() {
    this.logger.log("NestJS background worker started");
    await this.queue.requeueStale(new Date(Date.now() - 5 * 60_000));
    while (!this.stopped) {
      const job = await this.queue.claim();
      if (!job) { await new Promise((resolve) => setTimeout(resolve, 500)); continue; }
      const heartbeat = setInterval(() => void this.queue.touch(job.jobId), 30_000);
      try {
        await handleJob(job.name, job.payload);
        await this.queue.markSucceeded(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown job failure";
        await this.queue.markFailed(job, message);
        this.logger.error(`Job ${job.jobId} failed: ${message}`);
      } finally {
        clearInterval(heartbeat);
      }
    }
  }
}
