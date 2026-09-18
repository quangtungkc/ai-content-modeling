import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

async function createSchema(client: PrismaClient) {
  await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyQaRun" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "finalVideoPath" TEXT NOT NULL, "finalVideoHash" TEXT NOT NULL, "finalVideoVersion" TEXT NOT NULL, "validatorVersion" TEXT NOT NULL, "status" TEXT NOT NULL, "qualityStatusBefore" TEXT NOT NULL, "qualityStatusAfter" TEXT, "validatorsRun" JSONB NOT NULL, "findings" JSONB NOT NULL, "incidentsCreated" JSONB NOT NULL, "repairsTriggered" JSONB NOT NULL, "error" TEXT, "startedAt" DATETIME NOT NULL, "finishedAt" DATETIME, "updatedAt" DATETIME NOT NULL)');
  await client.$executeRawUnsafe('CREATE UNIQUE INDEX "qa_identity" ON "PostAssemblyQaRun"("projectId", "finalVideoHash", "validatorVersion")');
}

describe("PostAssemblyQaRun restart recovery SQLite", () => {
  it("marks stale runs interrupted, excludes active run, and is idempotent", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qa-restart-"));
    const database = path.join(root, "qa.db").replace(/\\/g, "/");
    const first = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
    try {
      await createSchema(first);
      const make = (id: string) => first.postAssemblyQaRun.create({ data: { id, projectId: "project", finalVideoPath: "final.mp4", finalVideoHash: id, finalVideoVersion: id, validatorVersion: "1.0.0", status: "RUNNING", qualityStatusBefore: "CHECKING", validatorsRun: [], findings: {}, incidentsCreated: [], repairsTriggered: [], startedAt: new Date(), updatedAt: new Date() } });
      await make("stale"); await make("active");
      await first.$disconnect();
      const second = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
      const recovered = await second.postAssemblyQaRun.updateMany({ where: { projectId: "project", status: "RUNNING", id: { not: "active" } }, data: { status: "INTERRUPTED", qualityStatusAfter: "NEEDS_REVIEW", error: "INTERRUPTED_AFTER_RESTART", finishedAt: new Date() } });
      expect(recovered.count).toBe(1);
      expect((await second.postAssemblyQaRun.findUniqueOrThrow({ where: { id: "stale" } })).status).toBe("INTERRUPTED");
      expect((await second.postAssemblyQaRun.findUniqueOrThrow({ where: { id: "active" } })).status).toBe("RUNNING");
      expect((await second.postAssemblyQaRun.updateMany({ where: { projectId: "project", status: "RUNNING", id: { not: "active" } }, data: { status: "INTERRUPTED" } })).count).toBe(0);
      expect(await second.postAssemblyQaRun.count({ where: { projectId: "project" } })).toBe(2);
      await second.$disconnect();
    } finally { await first.$disconnect().catch(() => undefined); await rm(root, { recursive: true, force: true }); }
  });
});
