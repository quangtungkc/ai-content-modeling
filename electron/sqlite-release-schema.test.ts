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

  it("repairs a stale snapshot foreign key left by the duration rebuild without losing rows", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sqlite-release-schema-"));
    const client = clientFor(path.join(root, "stale-fk.db"));
    try {
      await createOldDb(client);
      await ensureSqliteReleaseSchema(client);
      await client.$executeRawUnsafe(`CREATE TABLE "CompetitorVideo__release_old" ("id" TEXT NOT NULL PRIMARY KEY)`);
      await client.$executeRawUnsafe(`INSERT INTO "CompetitorVideo__release_old" ("id") VALUES ('video-1')`);
      await client.$executeRawUnsafe(`CREATE TABLE "VideoMetricSnapshot" ("id" TEXT NOT NULL PRIMARY KEY, "videoId" TEXT NOT NULL, "capturedAt" DATETIME NOT NULL, "views" INTEGER NOT NULL DEFAULT 0, "likes" INTEGER NOT NULL DEFAULT 0, "comments" INTEGER NOT NULL DEFAULT 0, "shares" INTEGER NOT NULL DEFAULT 0, "rawMetrics" JSONB, CONSTRAINT "VideoMetricSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "CompetitorVideo__release_old" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)`);
      await client.$executeRawUnsafe(`INSERT INTO "VideoMetricSnapshot" ("id", "videoId", "capturedAt", "views") VALUES ('snapshot-1', 'video-1', CURRENT_TIMESTAMP, 27000)`);

      const result = await ensureSqliteReleaseSchema(client);
      expect(result.repairedForeignKeys).toContain("VideoMetricSnapshot");
      const foreignKeys = await client.$queryRawUnsafe<Array<{ table: string }>>(`PRAGMA foreign_key_list("VideoMetricSnapshot")`);
      expect(foreignKeys.map((foreignKey) => foreignKey.table)).toContain("CompetitorVideo");
      expect((await client.$queryRawUnsafe<Array<{ views: number }>>(`SELECT "views" FROM "VideoMetricSnapshot" WHERE "id" = 'snapshot-1'`))[0].views).toBe(27000);
      await client.$executeRawUnsafe(`INSERT INTO "VideoMetricSnapshot" ("id", "videoId", "capturedAt", "views") VALUES ('snapshot-2', 'video-1', datetime('now', '+1 second'), 28000)`);
      expect((await client.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*) AS count FROM "VideoMetricSnapshot"`))[0].count).toBe(2n);
    } finally {
      await client.$disconnect();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("repairs ContentProject dependants left on the duration rebuild temporary name", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "sqlite-release-schema-"));
    const client = clientFor(path.join(root, "stale-content-project-fk.db"));
    try {
      await createOldDb(client);
      await ensureSqliteReleaseSchema(client);
      await client.$executeRawUnsafe(`CREATE TABLE "ContentProject__release_old" ("id" TEXT NOT NULL PRIMARY KEY)`);
      await client.$executeRawUnsafe(`INSERT INTO "ContentProject__release_old" ("id") VALUES ('project-1')`);
      await client.$executeRawUnsafe(`CREATE TABLE "Asset" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ContentProject__release_old" ("id") ON DELETE RESTRICT ON UPDATE CASCADE)`);
      await client.$executeRawUnsafe(`INSERT INTO "Asset" ("id", "projectId") VALUES ('asset-1', 'project-1')`);

      const result = await ensureSqliteReleaseSchema(client);
      expect(result.repairedForeignKeys).toContain("Asset");
      const foreignKeys = await client.$queryRawUnsafe<Array<{ table: string }>>(`PRAGMA foreign_key_list("Asset")`);
      expect(foreignKeys.map((foreignKey) => foreignKey.table)).toContain("ContentProject");
      expect((await client.$queryRawUnsafe<Array<{ projectId: string }>>(`SELECT "projectId" FROM "Asset" WHERE "id" = 'asset-1'`))[0].projectId).toBe("project-1");
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
