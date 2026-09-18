import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { AUTOMATION_RUN_COLUMNS, ensureSqliteReleaseSchema } from "./sqlite-release-schema.cjs";

function clientFor(filePath: string) {
  return new PrismaClient({ datasources: { db: { url: `file:${filePath.replace(/\\/g, "/")}` } } });
}

async function createOldDb(client: PrismaClient) {
  await client.$executeRawUnsafe(`CREATE TABLE "Channel" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await client.$executeRawUnsafe(`CREATE TABLE "ModelingIdea" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await client.$executeRawUnsafe(`CREATE TABLE "Competitor" ("id" TEXT NOT NULL PRIMARY KEY)`);
  await client.$executeRawUnsafe(`CREATE TABLE "CompetitorVideo" ("id" TEXT NOT NULL PRIMARY KEY, "competitorId" TEXT NOT NULL, "externalId" TEXT NOT NULL, "url" TEXT NOT NULL, "title" TEXT, "caption" TEXT, "thumbnailUrl" TEXT, "publishedAt" DATETIME, "duration" INTEGER, "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
  await client.$executeRawUnsafe(`CREATE TABLE "ContentProject" ("id" TEXT NOT NULL PRIMARY KEY, "channelId" TEXT NOT NULL, "ideaId" TEXT NOT NULL, "status" TEXT NOT NULL, "deconstruction" JSONB, "artDirection" JSONB, "characterDesign" JSONB, "backgroundDesign" JSONB, "storyboard" JSONB, "safetyReview" JSONB, "productionPrompts" JSONB, "createdBy" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "sourceDuration" INTEGER)`);
  await client.$executeRawUnsafe(`CREATE TABLE "StoryboardScene" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "sceneNumber" INTEGER NOT NULL, "visualBlock" TEXT NOT NULL, "actionBlock" TEXT NOT NULL, "audioBlock" TEXT NOT NULL, "englishPrompt" TEXT, "promptProvider" TEXT, "status" TEXT NOT NULL)`);
  await client.$executeRawUnsafe(`CREATE TABLE "AutomationRun" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "sourceVideoId" TEXT NOT NULL, "ideaId" TEXT, "projectId" TEXT, "status" TEXT NOT NULL DEFAULT 'RUNNING', "settings" JSONB NOT NULL, "steps" JSONB NOT NULL, "error" TEXT, "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "completedAt" DATETIME)`);
  await client.$executeRawUnsafe(`INSERT INTO "Competitor" ("id") VALUES ('competitor-1')`);
  await client.$executeRawUnsafe(`INSERT INTO "Channel" ("id") VALUES ('channel-1')`);
  await client.$executeRawUnsafe(`INSERT INTO "ModelingIdea" ("id") VALUES ('idea-1')`);
  await client.$executeRawUnsafe(`INSERT INTO "CompetitorVideo" ("id","competitorId","externalId","url","duration") VALUES ('video-1','competitor-1','external-1','https://example.test/video',13.5)`);
  await client.$executeRawUnsafe(`INSERT INTO "ContentProject" ("id","channelId","ideaId","status","createdBy","updatedAt","sourceDuration") VALUES ('project-1','channel-1','idea-1','DRAFT','user-1',CURRENT_TIMESTAMP,17.25)`);
}

async function columns(client: PrismaClient, table: string) {
  return client.$queryRawUnsafe<Array<{ name: string; type: string }>>(`PRAGMA table_info("${table}")`);
}

describe("SQLite release schema reconciliation", () => {
  it("upgrades old state, preserves fractional durations and completes AutomationRun", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sqlite-release-schema-"));
    const client = clientFor(path.join(root, "old.db"));
    try {
      await createOldDb(client);
      await ensureSqliteReleaseSchema(client);
      const automation = await columns(client, "AutomationRun");
      expect(AUTOMATION_RUN_COLUMNS.every(([name]) => automation.some((column) => column.name === name))).toBe(true);
      expect((await columns(client, "CompetitorVideo")).find(column => column.name === "duration")?.type).toBe("REAL");
      expect((await columns(client, "ContentProject")).find(column => column.name === "sourceDuration")?.type).toBe("REAL");
      expect((await client.$queryRawUnsafe<Array<{ duration: number }>>(`SELECT "duration" FROM "CompetitorVideo" WHERE "id" = 'video-1'`))[0].duration).toBe(13.5);
      expect((await client.$queryRawUnsafe<Array<{ sourceDuration: number }>>(`SELECT "sourceDuration" FROM "ContentProject" WHERE "id" = 'project-1'`))[0].sourceDuration).toBe(17.25);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("is idempotent on an already reconciled database", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sqlite-release-schema-"));
    const client = clientFor(path.join(root, "current.db"));
    try {
      await createOldDb(client);
      await ensureSqliteReleaseSchema(client);
      await ensureSqliteReleaseSchema(client);
      expect((await columns(client, "AutomationRun")).filter(column => column.name === "checkpoint")).toHaveLength(1);
      expect((await client.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "PostAssemblyQaRun"`))[0].count).toBe(0n);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reconciles the bundled template without importing user data", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sqlite-release-template-"));
    const file = path.join(root, "template.db");
    copyFileSync(path.join(process.cwd(), "electron", "assets", "modeling-ai-template.db"), file);
    const client = clientFor(file);
    try {
      await ensureSqliteReleaseSchema(client);
      expect((await columns(client, "CompetitorVideo")).find(column => column.name === "duration")?.type).toBe("REAL");
      expect((await columns(client, "ContentProject")).find(column => column.name === "sourceDuration")?.type).toBe("REAL");
      expect((await client.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "User"`))[0].count).toBe(0n);
      expect((await client.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "Session"`))[0].count).toBe(0n);
      expect((await client.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "AIConnection"`))[0].count).toBe(0n);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
