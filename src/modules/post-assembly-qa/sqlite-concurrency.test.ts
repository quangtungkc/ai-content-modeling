import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

describe("PostAssemblyQaRun SQLite atomic idempotency", () => {
  it("recovers the losing P2002 request and returns one logical run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qa-idempotency-"));
    const database = path.join(root, "qa.db").replace(/\\/g, "/");
    const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
    try {
      await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyQaRun" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "finalVideoPath" TEXT NOT NULL, "finalVideoHash" TEXT NOT NULL, "finalVideoVersion" TEXT NOT NULL, "validatorVersion" TEXT NOT NULL, "status" TEXT NOT NULL, "qualityStatusBefore" TEXT NOT NULL, "qualityStatusAfter" TEXT, "validatorsRun" JSONB NOT NULL, "findings" JSONB NOT NULL, "incidentsCreated" JSONB NOT NULL, "repairsTriggered" JSONB NOT NULL, "error" TEXT, "startedAt" DATETIME NOT NULL, "finishedAt" DATETIME, "updatedAt" DATETIME NOT NULL)');
      await client.$executeRawUnsafe('CREATE UNIQUE INDEX "qa_identity" ON "PostAssemblyQaRun"("projectId", "finalVideoHash", "validatorVersion")');
      const createOrReuse = async (id: string) => {
        try {
          return await client.postAssemblyQaRun.create({ data: { id, projectId: "project", finalVideoPath: "final.mp4", finalVideoHash: "sha256", finalVideoVersion: "sha256", validatorVersion: "1.0.0", status: "RUNNING", qualityStatusBefore: "NOT_RUN", validatorsRun: [], findings: {}, incidentsCreated: [], repairsTriggered: [], startedAt: new Date(), updatedAt: new Date() } });
        } catch (error) {
          if ((error as { code?: string }).code !== "P2002") throw error;
          return client.postAssemblyQaRun.findUniqueOrThrow({ where: { projectId_finalVideoHash_validatorVersion: { projectId: "project", finalVideoHash: "sha256", validatorVersion: "1.0.0" } } });
        }
      };
      const [left, right] = await Promise.all([createOrReuse("run-a"), createOrReuse("run-b")]);
      const rows = await client.postAssemblyQaRun.findMany({ where: { projectId: "project", finalVideoHash: "sha256", validatorVersion: "1.0.0" } });
      expect(left.id).toBe(right.id);
      expect(rows).toHaveLength(1);
    } finally { await client.$disconnect(); await rm(root, { recursive: true, force: true }); }
  });
});
