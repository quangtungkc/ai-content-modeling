import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { db } from "@/lib/db";

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
});
const createSchema = z.object({
  sourceVideoId: z.string().min(1),
  settings: settingsSchema,
  steps: z.array(stepSchema).min(1).max(20),
});
const updateSchema = z.object({
  id: z.string().min(1),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED"]).optional(),
  steps: z.array(stepSchema).max(20).optional(),
  ideaId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  error: z.string().max(1000).nullable().optional(),
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

      await db.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AutomationRun_userId_startedAt_idx" ON "AutomationRun"("userId", "startedAt" DESC)');
    })();
  }
  return ensureTablePromise;
}

const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
  ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
  : error;

export async function GET() {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    await ensureAutomationRunTable();
    return Response.json({ data: await db.automationRun.findMany({ where: { userId: session.userId }, orderBy: { startedAt: "desc" }, take: 50 }), requestId });
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
    const sourceVideo = await db.competitorVideo.findFirst({ where: { id: input.sourceVideoId, competitor: { channel: { userId: session.userId } } }, select: { id: true } });
    if (!sourceVideo) throw new AppError("VIDEO_NOT_FOUND", "Không tìm thấy video nguồn thuộc tài khoản.", 404);
    const run = await db.automationRun.create({ data: { userId: session.userId, sourceVideoId: input.sourceVideoId, status: "RUNNING", settings: input.settings as Prisma.InputJsonValue, steps: input.steps as Prisma.InputJsonValue } });
    return Response.json({ data: run, requestId }, { status: 201 });
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
    const existing = await db.automationRun.findFirst({ where: { id: input.id, userId: session.userId }, select: { id: true } });
    if (!existing) throw new AppError("AUTOMATION_NOT_FOUND", "Không tìm thấy phiên chạy tự động.", 404);
    const completedAt = input.status === "SUCCEEDED" || input.status === "FAILED" ? new Date() : undefined;
    const run = await db.automationRun.update({
      where: { id: input.id },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.steps ? { steps: input.steps as Prisma.InputJsonValue } : {}),
        ...(input.ideaId !== undefined ? { ideaId: input.ideaId } : {}),
        ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
        ...(input.error !== undefined ? { error: input.error } : {}),
        ...(completedAt ? { completedAt } : {}),
      },
    });
    return Response.json({ data: run, requestId });
  } catch (error) {
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Cập nhật lịch sử chạy không hợp lệ.", 400, error.flatten()) : normalize(error), requestId);
  }
}
