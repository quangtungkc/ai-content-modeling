import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";
import { hasProjectFinalVideo } from "@/modules/assets/image-generation-service";
import { buildAuthoritativePersistencePatch, reconcileStaleRunningRun, type AutomationPersistenceFields, type ResumableRunInput } from "@/modules/automations/resume";
import { deleteAutomationRunWithProject } from "@/modules/projects/deletion-service";
import { ensureCodexStorage } from "@/modules/codex-orchestrator/storage";

const stepSchema = z.object({
  key: z.string().min(1).max(80),
  label: z.string().min(1).max(200),
  status: z.enum(["pending", "running", "completed", "failed"]),
  detail: z.string().max(500).optional(),
  error: z.string().max(1000).optional(),
  startedAt: z.string().datetime().optional(),
  completedAt: z.string().datetime().optional(),
});
const settingsSchema = z.object({
  artStyle: z.string().trim().min(1).max(100),
  aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]),
  videoProvider: z.enum(["flow", "gemini"]).optional(),
  postText: z.string().trim().max(500).optional(),
  hashtags: z.string().trim().max(500).optional(),
  language: z.string().trim().max(80).optional(),
  targetCountry: z.string().trim().max(120).optional(),
});
const createSchema = z.object({
  sourceVideoId: z.string().min(1),
  settings: settingsSchema,
  steps: z.array(stepSchema).min(1).max(20),
});
const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "PAUSED"]).optional(),
  steps: z.array(stepSchema).max(20).optional(),
  ideaId: z.string().nullable().optional(),
  modelingIdeaId: z.string().nullable().optional(),
  channelId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  error: z.string().max(1000).nullable().optional(),
  settings: settingsSchema.optional(),
  lastCompletedStage: z.number().int().min(0).max(5).optional(),
  failedStage: z.number().int().min(1).max(5).nullable().optional(),
  resumeTarget: z.enum(["MODELING_IDEA_CREATION", "CONTENT_PROJECT_CREATION", "IMAGES", "VIDEOS", "FINAL_VIDEO"]).nullable().optional(),
  failureFingerprint: z.string().max(160).nullable().optional(),
  attemptCount: z.number().int().min(0).max(100).optional(),
  incidentHistory: z.array(z.unknown()).optional(),
  checkpoint: z.record(z.string(), z.unknown()).optional(),
  sourceModelingSpecVersion: z.string().max(120).nullable().optional(),
});

let ensureTablePromise: Promise<unknown> | null = null;
function ensureAutomationRunTable() {
  if (!ensureTablePromise) {
    ensureTablePromise = (async () => {
      const columns = await db.$queryRawUnsafe<Array<{ name: string; type: string }>>('PRAGMA table_info("AutomationRun")');
      const hasTable = columns.length > 0;
      const hasCompatibleDateTypes = ["startedAt", "updatedAt", "completedAt"].every((name) => {
        const column = columns.find((item) => item.name === name);
        return !column || column.type.toUpperCase() === "DATETIME";
      });

      if (hasTable && !hasCompatibleDateTypes) {
        await db.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('ALTER TABLE "AutomationRun" RENAME TO "AutomationRun_legacy"');
          await tx.$executeRawUnsafe(`
            CREATE TABLE "AutomationRun" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "userId" TEXT NOT NULL,
              "sourceVideoId" TEXT NOT NULL,
              "ideaId" TEXT,
              "projectId" TEXT,
              "status" TEXT NOT NULL DEFAULT 'RUNNING',
              "settings" JSONB NOT NULL,
              "steps" JSONB NOT NULL,
              "error" TEXT,
              "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" DATETIME NOT NULL,
              "completedAt" DATETIME
            )
          `);
          await tx.$executeRawUnsafe(`
            INSERT INTO "AutomationRun" ("id", "userId", "sourceVideoId", "ideaId", "projectId", "status", "settings", "steps", "error", "startedAt", "updatedAt", "completedAt")
            SELECT "id", "userId", "sourceVideoId", "ideaId", "projectId", "status", "settings", "steps", "error", "startedAt", "updatedAt", "completedAt"
            FROM "AutomationRun_legacy"
          `);
          await tx.$executeRawUnsafe('DROP TABLE "AutomationRun_legacy"');
        });
      } else if (!hasTable) {
        await db.$executeRawUnsafe(`
          CREATE TABLE "AutomationRun" (
            "id" TEXT NOT NULL PRIMARY KEY,
            "userId" TEXT NOT NULL,
            "sourceVideoId" TEXT NOT NULL,
            "ideaId" TEXT,
            "projectId" TEXT,
            "status" TEXT NOT NULL DEFAULT 'RUNNING',
            "settings" JSONB NOT NULL,
            "steps" JSONB NOT NULL,
            "error" TEXT,
            "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            "updatedAt" DATETIME NOT NULL,
            "completedAt" DATETIME
          )
        `);
      }

      const ensureColumn = async (name: string, definition: string) => {
        const current = await db.$queryRawUnsafe<Array<{ name: string }>>('PRAGMA table_info("AutomationRun")');
        if (!current.some((column) => column.name === name)) await db.$executeRawUnsafe(`ALTER TABLE "AutomationRun" ADD COLUMN "${name}" ${definition}`);
      };
      await ensureColumn("channelId", "TEXT");
      await ensureColumn("modelingIdeaId", "TEXT");
      await ensureColumn("lastCompletedStage", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("failedStage", "INTEGER");
      await ensureColumn("resumeTarget", "TEXT");
      await ensureColumn("failureFingerprint", "TEXT");
      await ensureColumn("attemptCount", "INTEGER NOT NULL DEFAULT 0");
      await ensureColumn("incidentHistory", "JSONB NOT NULL DEFAULT '[]'");
      await ensureColumn("checkpoint", "JSONB NOT NULL DEFAULT '{}'");
      await ensureColumn("sourceModelingSpecVersion", "TEXT");

      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AutomationRun_userId_startedAt_idx" ON "AutomationRun"("userId", "startedAt" DESC)');
    })();
  }
  return ensureTablePromise;
}

const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
  ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
  : error;

export async function GET(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    await ensureAutomationRunTable();
    await ensureCodexStorage();
    const params = new URL(request.url).searchParams;
    const sourceVideoId = params.get("sourceVideoId") ?? undefined;
    const channelId = params.get("channelId") ?? undefined;
    const targetRunId = params.get("runId")?.trim() || undefined;
    const targetModelingIdeaId = params.get("modelingIdeaId")?.trim() || undefined;
    const loadedRuns = await db.automationRun.findMany({ where: { AND: [{ userId: session.userId }, ...(sourceVideoId ? [{ sourceVideoId }] : []), ...(targetRunId ? [{ id: targetRunId }] : []), ...(channelId ? [{ OR: [{ channelId }, { channelId: null }] }] : []), ...(targetModelingIdeaId ? [{ OR: [{ modelingIdeaId: targetModelingIdeaId }, { ideaId: targetModelingIdeaId }] }] : [])] }, orderBy: { startedAt: "desc" }, take: 50 });
    const runs = await Promise.all(loadedRuns.map(async (run) => {
      const reconciliation = reconcileStaleRunningRun(run as unknown as ResumableRunInput);
      if (reconciliation.status !== "RECOVERED") return run;
      return db.automationRun.update({ where: { id: run.id }, data: reconciliation.patch as Prisma.AutomationRunUpdateInput });
    }));
    const sourceVideos = await db.competitorVideo.findMany({ where: { id: { in: runs.map((run) => run.sourceVideoId) }, competitor: { channel: { userId: session.userId } } }, select: { id: true, url: true, competitor: { select: { channelId: true } } } });
    const sourceVideoUrls = new Map(sourceVideos.map((video) => [video.id, video.url]));
    const sourceVideoChannels = new Map(sourceVideos.map((video) => [video.id, video.competitor.channelId]));
    const ideaIds = runs.map((run) => run.modelingIdeaId ?? run.ideaId).filter((id): id is string => Boolean(id));
    const ideas = ideaIds.length ? await db.modelingIdea.findMany({ where: { id: { in: ideaIds }, analysis: { sourceVideo: { competitor: { channel: { userId: session.userId } } } } }, select: { id: true, title: true, content: true } }) : [];
    const ideasById = new Map(ideas.map((idea) => [idea.id, idea]));
    const codexJobs = await db.codexJob.findMany({
      where: { userId: session.userId, automationRunId: { in: runs.map((run) => run.id) } },
      select: { id: true, status: true, sessionId: true, currentStage: true, currentAction: true, retryCount: true, automationRunId: true, generationStatus: true, qualityStatus: true, outputReady: true },
    });
    const stages = codexJobs.length
      ? await db.codexStageState.findMany({ where: { jobId: { in: codexJobs.map((job) => job.id) } } })
      : [];
    const eventsByJob = new Map<string, Awaited<ReturnType<typeof db.codexEvent.findMany>>>();
    await Promise.all(codexJobs.map(async (job) => {
      const events = await db.codexEvent.findMany({
        where: { jobId: job.id },
        orderBy: { sequence: "desc" },
        take: 50,
        select: { id: true, jobId: true, sequence: true, type: true, stage: true, level: true, payload: true, reasoningSummary: true, createdAt: true },
      });
      eventsByJob.set(job.id, [...events].reverse());
    }));
    const stagesByJob = new Map<string, typeof stages>();
    for (const stage of stages) stagesByJob.set(stage.jobId, [...(stagesByJob.get(stage.jobId) ?? []), stage]);
    const codexByRun = new Map(codexJobs.map((job) => [job.automationRunId, {
      ...job,
      stages: stagesByJob.get(job.id) ?? [],
      events: eventsByJob.get(job.id) ?? [],
    }]));
    const data = await Promise.all(runs.map(async (run) => {
      const codexAgent = codexByRun.get(run.id) ?? null;
      const idea = ideasById.get(run.modelingIdeaId ?? run.ideaId ?? "");
      const ideaContent = idea?.content && typeof idea.content === "object" && !Array.isArray(idea.content) ? idea.content as Record<string, unknown> : {};
      return {
      ...run,
      codexAgent,
      channelId: run.channelId ?? sourceVideoChannels.get(run.sourceVideoId) ?? null,
      modelingIdeaId: run.modelingIdeaId ?? run.ideaId ?? null,
      modelingIdea: idea ? { id: idea.id, title: idea.title, ...ideaContent } : null,
      sourceVideoUrl: sourceVideoUrls.get(run.sourceVideoId) ?? null,
      finalVideoUrl: (run.status === "SUCCEEDED" || codexAgent?.outputReady === true) && run.projectId && await hasProjectFinalVideo(run.projectId)
        ? `/api/v1/projects/${run.projectId}/videos?final=1`
        : null,
    }; }));
    return Response.json({ data, requestId });
  } catch (error) {
    return toErrorResponse(normalize(error), requestId);
  }
}

export async function DELETE(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    await ensureAutomationRunTable();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new AppError("VALIDATION_ERROR", "Thiếu mã dự án cần xóa.", 400);
    return Response.json({ data: await deleteAutomationRunWithProject(id, session.userId), requestId });
  } catch (error) {
    return toErrorResponse(normalize(error), requestId);
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const input = createSchema.parse(await request.json());
    await ensureAutomationRunTable();
    const sourceVideo = await db.competitorVideo.findFirst({ where: { id: input.sourceVideoId, competitor: { channel: { userId: session.userId } } }, select: { id: true, competitor: { select: { channelId: true } } } });
    if (!sourceVideo) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy video nguồn thuộc tài khoản.", 404);
    const initialCheckpoint = { version: 1, runId: "pending", lastCompletedStage: 0, failedStage: null, resumeTarget: null, modelingIdeaId: null, sourceVideoId: input.sourceVideoId, channelId: sourceVideo.competitor.channelId, attemptCount: 0, incidentHistory: [], geminiConversationId: null, geminiConversationUrl: null, geminiConversationOwnerRunId: null, geminiConversationState: "UNBOUND", geminiConversationCreatedAt: null, geminiConversationDeletedAt: null, lastGeminiStage: null, lastGeminiCommandId: null };
    const run = await db.automationRun.create({ data: { userId: session.userId, sourceVideoId: input.sourceVideoId, channelId: sourceVideo.competitor.channelId, modelingIdeaId: null, status: "RUNNING", settings: input.settings as Prisma.InputJsonValue, steps: input.steps as Prisma.InputJsonValue, lastCompletedStage: 0, failedStage: null, resumeTarget: null, failureFingerprint: null, attemptCount: 0, incidentHistory: [], checkpoint: initialCheckpoint as Prisma.InputJsonValue } });
    const normalized = await db.automationRun.update({ where: { id: run.id }, data: { checkpoint: { ...initialCheckpoint, runId: run.id, geminiConversationOwnerRunId: run.id } as Prisma.InputJsonValue } });
    return Response.json({ data: normalized, requestId }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Cài đặt chạy tự động không hợp lệ.", 400, error.flatten()) : normalize(error), requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const input = updateSchema.parse(await request.json());
    await ensureAutomationRunTable();
    const existing = await db.automationRun.findFirst({ where: { id: input.id, userId: session.userId } });
    if (!existing) throw new AppError("AUTOMATION_NOT_FOUND", "Không tìm thấy phiên chạy tự động.", 404);
    const persistence = buildAuthoritativePersistencePatch({
      existing: existing as unknown as ResumableRunInput,
      steps: input.steps,
      fields: input as AutomationPersistenceFields,
    });
    if (persistence.status === "NEEDS_REVIEW") throw new AppError(persistence.reason, "Resume state không nhất quán; cần kiểm tra thủ công.", 409, { runId: existing.id, reason: persistence.reason });
    const completedAt = input.status === "SUCCEEDED" || input.status === "FAILED" ? new Date() : input.status === "RUNNING" ? null : undefined;
    const run = await db.automationRun.update({
      where: { id: input.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.steps ? { steps: input.steps as Prisma.InputJsonValue } : {}),
        ...(persistence.patch.ideaId !== undefined ? { ideaId: persistence.patch.ideaId as string | null } : {}),
        ...(persistence.patch.modelingIdeaId !== undefined ? { modelingIdeaId: persistence.patch.modelingIdeaId as string | null } : {}),
        ...(persistence.patch.channelId !== undefined ? { channelId: persistence.patch.channelId as string | null } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
        ...(input.settings ? { settings: input.settings as Prisma.InputJsonValue } : {}),
        ...(persistence.patch.lastCompletedStage !== undefined ? { lastCompletedStage: persistence.patch.lastCompletedStage as number } : {}),
        ...(persistence.patch.failedStage !== undefined ? { failedStage: persistence.patch.failedStage as number | null } : {}),
        ...(persistence.patch.resumeTarget !== undefined ? { resumeTarget: persistence.patch.resumeTarget as string | null } : {}),
        ...(persistence.patch.failureFingerprint !== undefined ? { failureFingerprint: persistence.patch.failureFingerprint as string | null } : {}),
        ...(persistence.patch.attemptCount !== undefined ? { attemptCount: persistence.patch.attemptCount as number } : {}),
        ...(persistence.patch.incidentHistory !== undefined ? { incidentHistory: persistence.patch.incidentHistory as Prisma.InputJsonValue } : {}),
        ...(persistence.patch.checkpoint !== undefined ? { checkpoint: persistence.patch.checkpoint as Prisma.InputJsonValue } : {}),
        ...(input.sourceModelingSpecVersion !== undefined ? { sourceModelingSpecVersion: input.sourceModelingSpecVersion } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
      },
    });
    return Response.json({ data: run, requestId });
  } catch (error) {
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Cập nhật lịch sử chạy không hợp lệ.", 400, error.flatten()) : normalize(error), requestId);
  }
}
