import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getActiveWorkerJob, reportWorkerProcessFailure } from "@/modules/codex-orchestrator/runtime-failure";

let fatalReported = false;
async function reportFatal(error: unknown, source: string) {
  if (fatalReported) return;
  fatalReported = true;
  try { await reportWorkerProcessFailure(source, error, getActiveWorkerJob()); } catch { /* Preserve the original process failure if storage is unavailable. */ }
}

process.on("uncaughtException", (error) => { void reportFatal(error, "NestJS server uncaught exception").finally(() => process.exit(1)); });
process.on("unhandledRejection", (reason) => { void reportFatal(reason, "NestJS server unhandled rejection").finally(() => process.exit(1)); });

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: ["log", "error", "warn"] });
  await app.listen(Number(process.env.NEST_PORT ?? 4001), "127.0.0.1");
}

void bootstrap();
