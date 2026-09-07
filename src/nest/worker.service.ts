import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import Redis from "ioredis";
import { getRequiredRedisUrl } from "@/lib/env";
import { RedisJobQueue } from "@/lib/jobs/queue";
import { handleJob } from "@/workers/job-handler";

@Injectable()
export class WorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerService.name);
  private readonly redis = new Redis(getRequiredRedisUrl());
  private readonly queue = new RedisJobQueue(this.redis);
  private stopped = false;

  async onModuleInit() {
    void this.run();
  }

  async onModuleDestroy() {
    this.stopped = true;
    await this.redis.quit();
  }

  private async run() {
    this.logger.log("NestJS background worker started");
    while (!this.stopped) {
      const job = await this.queue.claim();
      if (!job) continue;
      try {
        await handleJob(job.name, job.payload, this.redis);
        await this.queue.markSucceeded(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown job failure";
        await this.queue.markFailed(job, message);
        this.logger.error(`Job ${job.jobId} failed: ${message}`);
      }
    }
  }
}
