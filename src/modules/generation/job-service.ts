import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { LocalJobQueue } from "@/lib/jobs/queue";
import { compileVeoPrompt } from "@/services/video-generation/prompt-compiler";
import { veoRequestSchema } from "@/services/video-generation/request-schema";
import type { VeoRequest } from "@/services/video-generation/types";
import { UsageMetric } from "@prisma/client";
import { recordUsage } from "@/modules/usage/service";

async function getOwnedScene(sceneId: string, userId: string) {
  const scene = await db.storyboardScene.findFirst({ where: { id: sceneId, project: { channel: { userId } } }, select: { id: true } });
  if (!scene) throw new AppError("SCENE_NOT_FOUND", "Không tìm thấy scene.", 404);
}

export async function createGenerationJob(sceneId: string, userId: string, request: VeoRequest) {
  await getOwnedScene(sceneId, userId);
  const parsed = veoRequestSchema.parse({ ...request, sceneId });
  const latest = await db.sceneGenerationVersion.findFirst({ where: { sceneId }, orderBy: { version: "desc" }, select: { version: true } });
  const job = await db.videoGenerationJob.create({ data: { sceneId, provider: "veo", prompt: parsed.prompt } });
  await db.sceneGenerationVersion.create({ data: { sceneId, version: (latest?.version ?? 0) + 1, generationJobId: job.id, prompt: parsed.prompt, provider: "veo" } });
  const queue = new LocalJobQueue();
  await queue.enqueue("video.generate", { jobId: job.id, request: parsed }, `video-generate:${job.id}`);
  return job;
}

export async function getGenerationJob(id: string, userId: string) {
  const job = await db.videoGenerationJob.findFirst({ where: { id, scene: { project: { channel: { userId } } } } });
  if (!job) throw new AppError("GENERATION_JOB_NOT_FOUND", "Không tìm thấy generation job.", 404);
  return job;
}

export async function runGenerationJob(jobId: string, request: VeoRequest) {
  const { VeoProvider } = await import("@/services/video-generation/veo");
  const provider = new VeoProvider();
  const ownership = await db.videoGenerationJob.findUniqueOrThrow({ where: { id: jobId }, select: { scene: { select: { project: { select: { id: true, channelId: true, channel: { select: { userId: true } } } } } } } });
  await db.videoGenerationJob.update({ where: { id: jobId }, data: { status: "RUNNING", startedAt: new Date(), error: null } });
  try {
    const operation = await provider.generateScene(request);
    void recordUsage({ userId: ownership.scene.project.channel.userId, channelId: ownership.scene.project.channelId, projectId: ownership.scene.project.id, metric: UsageMetric.VEO_GENERATION, idempotencyKey: `veo:generation:${jobId}` });
    await db.videoGenerationJob.update({ where: { id: jobId }, data: { externalOperationId: operation.operationId } });
    const current = await pollGenerationOperation(provider, operation.operationId);
    if (current.status === "failed") throw new Error(current.error ?? "Veo generation failed");
    await db.sceneGenerationVersion.update({ where: { generationJobId: jobId }, data: { status: "READY", previewUrl: current.previewUrl } });
    return db.videoGenerationJob.update({ where: { id: jobId }, data: { status: "COMPLETED", resultUrl: current.previewUrl, completedAt: new Date() } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown generation failure";
    await db.sceneGenerationVersion.update({ where: { generationJobId: jobId }, data: { status: "FAILED", reviewNotes: { error: message } } });
    await db.videoGenerationJob.update({ where: { id: jobId }, data: { status: "FAILED", error: message, completedAt: new Date() } });
    throw new Error(message);
  }
}

export async function pollGenerationOperation(provider: { getOperation(operationId: string): Promise<{ status: "queued" | "running" | "succeeded" | "failed"; error?: string; previewUrl?: string }> }, operationId: string, waitMs = 5_000, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))) {
  let current = await provider.getOperation(operationId);
  while (current.status === "queued" || current.status === "running") { await sleep(waitMs); current = await provider.getOperation(operationId); }
  return current;
}

export { compileVeoPrompt };
