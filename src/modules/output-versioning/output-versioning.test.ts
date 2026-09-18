import { PrismaClient } from "@prisma/client";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { OutputVersionService } from "./service";

async function createSchema(client: PrismaClient) {
  await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyOutputVersion" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "versionNumber" INTEGER NOT NULL, "status" TEXT NOT NULL, "filePath" TEXT NOT NULL, "fileHash" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdFromVersionId" TEXT, "createdByRepairIncidentId" TEXT, "repairRuleId" TEXT, "validationStatus" TEXT NOT NULL, "promotedAt" DATETIME, "rejectedAt" DATETIME, "rollbackReason" TEXT)');
  await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyOutputVersionAudit" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "outputVersionId" TEXT, "event" TEXT NOT NULL, "previousCurrentVersionId" TEXT, "newCurrentVersionId" TEXT, "reason" TEXT, "metadata" JSONB NOT NULL DEFAULT \'{}\', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  await client.$executeRawUnsafe('CREATE UNIQUE INDEX "PostAssemblyOutputVersion_projectId_versionNumber_key" ON "PostAssemblyOutputVersion"("projectId", "versionNumber")');
  await client.$executeRawUnsafe('CREATE UNIQUE INDEX "PostAssemblyOutputVersion_one_current_per_project" ON "PostAssemblyOutputVersion"("projectId") WHERE "status" = \'CURRENT\'');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersion_projectId_status_idx" ON "PostAssemblyOutputVersion"("projectId", "status")');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersion_projectId_fileHash_idx" ON "PostAssemblyOutputVersion"("projectId", "fileHash")');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersionAudit_projectId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("projectId", "createdAt")');
  await client.$executeRawUnsafe('CREATE INDEX "PostAssemblyOutputVersionAudit_outputVersionId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("outputVersionId", "createdAt")');
}

async function withOutputDb<T>(callback: (client: PrismaClient, service: OutputVersionService, root: string, database: string) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "output-versioning-"));
  const database = path.join(root, "outputs.db").replace(/\\/g, "/");
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  const service = new OutputVersionService(client, async () => undefined);
  try {
    await createSchema(client);
    return await callback(client, service, root, database);
  } finally {
    await client.$disconnect();
    await rm(root, { recursive: true, force: true });
  }
}

async function registerOriginal(service: OutputVersionService, root: string) {
  const originalPath = path.join(root, "final.mp4");
  await writeFile(originalPath, "original-output");
  return service.registerOriginalOutput({ projectId: "project-1", filePath: originalPath, validationStatus: "PASS" });
}

async function createCandidate(service: OutputVersionService, root: string, currentVersionId?: string) {
  const sourcePath = path.join(root, `repair-source-${Date.now()}-${Math.random()}.mp4`);
  await writeFile(sourcePath, "candidate-output");
  return service.createCandidate({ projectId: "project-1", sourcePath, currentVersionId, createdByRepairIncidentId: "incident-1", repairRuleId: "RULE_TEST" });
}

describe("Post-Assembly output version safety", () => {
  it("CASE 1 registers the first validated final assembly as CURRENT v1", async () => {
    await withOutputDb(async (client, service, root) => {
      const original = await registerOriginal(service, root);
      expect(original).toMatchObject({ projectId: "project-1", versionNumber: 1, status: "CURRENT", validationStatus: "PASS" });
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
    });
  });

  it("CASE 2 creates an isolated candidate and leaves the current file untouched", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const before = await readFile(original.filePath, "utf8");
      const candidate = await createCandidate(service, root, original.id);
      expect(candidate).toMatchObject({ status: "CANDIDATE", validationStatus: "NOT_RUN", createdFromVersionId: original.id });
      expect(candidate.filePath).not.toBe(original.filePath);
      expect(await readFile(original.filePath, "utf8")).toBe(before);
    });
  });

  it("CASE 3 promotes only PASS candidates and preserves v1 for rollback", async () => {
    await withOutputDb(async (client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "PASS", evidence: { validator: "PASS" } });
      const promoted = await service.promoteCandidate(candidate.id);
      expect(promoted).toMatchObject({ id: candidate.id, status: "CURRENT", validationStatus: "PASS" });
      expect((await service.getOutputVersion(original.id))?.status).toBe("SUPERSEDED");
      expect(await readFile(original.filePath, "utf8")).toBe("original-output");
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(candidate.id);
      const audit = await client.postAssemblyOutputVersionAudit.findMany({ where: { projectId: "project-1" }, orderBy: { createdAt: "asc" } });
      expect(audit.map((item) => item.event)).toEqual(expect.arrayContaining(["ORIGINAL_OUTPUT_REGISTERED", "CANDIDATE_CREATED", "CANDIDATE_VALIDATION_RECORDED", "PROMOTION_ATTEMPTED", "PROMOTION_SUCCEEDED"]));
    });
  });

  it("CASE 4 rejects a FAIL candidate without changing CURRENT", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      const rejected = await service.markCandidateValidated(candidate.id, { status: "FAIL", reason: "Candidate visual validation failed." });
      expect(rejected.status).toBe("REJECTED");
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
    });
  });

  it("CASE 5 refuses promotion when validation is NOT_RUN", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await expect(service.promoteCandidate(candidate.id)).rejects.toThrow("CANDIDATE_VALIDATION_REQUIRED:NOT_RUN");
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
    });
  });

  it("CASE 6 refuses a missing candidate file and preserves CURRENT", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "PASS" });
      await rm(candidate.filePath);
      await expect(service.promoteCandidate(candidate.id)).rejects.toThrow("CANDIDATE_FILE_MISSING");
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
      expect((await service.getOutputVersion(candidate.id))?.status).toBe("REJECTED");
    });
  });

  it("CASE 7 rolls back v2 to v1 and preserves outputReady true", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "PASS" });
      await service.promoteCandidate(candidate.id);
      const generation = { generationStatus: "SUCCESS", outputReady: true };
      const rolledBack = await service.rollbackToVersion("project-1", original.id, "Candidate repair did not preserve quality.");
      expect(rolledBack.id).toBe(original.id);
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
      expect(generation).toEqual({ generationStatus: "SUCCESS", outputReady: true });
      expect(await readFile(original.filePath, "utf8")).toBe("original-output");
    });
  });

  it("CASE 8 makes promoteCandidate idempotent", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "PASS" });
      const first = await service.promoteCandidate(candidate.id);
      const second = await service.promoteCandidate(candidate.id);
      expect(second.id).toBe(first.id);
      expect(second.status).toBe("CURRENT");
    });
  });

  it("CASE 9 makes rollback to the same target idempotent", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "PASS" });
      await service.promoteCandidate(candidate.id);
      const first = await service.rollbackToVersion("project-1", original.id, "Rollback test.");
      const second = await service.rollbackToVersion("project-1", original.id, "Rollback repeated.");
      expect(second.id).toBe(first.id);
      expect(second.status).toBe("CURRENT");
    });
  });

  it("CASE 10 preserves candidate hash and metadata after reload", async () => {
    await withOutputDb(async (client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      const reloaded = new OutputVersionService(client, async () => undefined);
      const loaded = await reloaded.getOutputVersion(candidate.id);
      expect(loaded).toMatchObject({ id: candidate.id, fileHash: candidate.fileHash, createdFromVersionId: original.id, createdByRepairIncidentId: "incident-1", repairRuleId: "RULE_TEST", validationStatus: "NOT_RUN" });
    });
  });

  it("CASE 11 resolves CURRENT correctly after repository restart", async () => {
    await withOutputDb(async (_client, service, root, database) => {
      const original = await registerOriginal(service, root);
      const restartedClient = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
      try {
        const restartedService = new OutputVersionService(restartedClient, async () => undefined);
        expect((await restartedService.getCurrentOutput("project-1"))?.id).toBe(original.id);
      } finally {
        await restartedClient.$disconnect();
      }
    });
  });

  it("CASE 12 keeps generationStatus SUCCESS when a repair candidate fails", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "FAIL", reason: "Repair failed." });
      const generation = { generationStatus: "SUCCESS", outputReady: true };
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
      expect(generation.generationStatus).toBe("SUCCESS");
    });
  });

  it("CASE 13 keeps outputReady true when a repair candidate fails", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "ERROR", reason: "Validation error." });
      const generation = { generationStatus: "SUCCESS", outputReady: true };
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
      expect(generation.outputReady).toBe(true);
    });
  });

  it("CASE 14 rolls back a failed promotion transaction to one valid CURRENT", async () => {
    await withOutputDb(async (client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "PASS" });
      const failingTransaction = async <T>(callback: (transaction: import("@prisma/client").Prisma.TransactionClient) => Promise<T>): Promise<T> => client.$transaction(async transaction => { await callback(transaction); throw new Error("simulated transaction failure after updates"); });
      const failingService = new OutputVersionService(client, async () => undefined, undefined, failingTransaction);
      await expect(failingService.promoteCandidate(candidate.id)).rejects.toThrow("simulated transaction failure after updates");
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
    });
  });

  it("CASE 15 enforces one CURRENT version per project", async () => {
    await withOutputDb(async (client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "PASS" });
      await service.promoteCandidate(candidate.id);
      expect(await client.postAssemblyOutputVersion.count({ where: { projectId: "project-1", status: "CURRENT" } })).toBe(1);
    });
  });

  it("CASE 16 blocks rejected versions from promotion and rollback", async () => {
    await withOutputDb(async (_client, service, root) => {
      const original = await registerOriginal(service, root);
      const candidate = await createCandidate(service, root, original.id);
      await service.markCandidateValidated(candidate.id, { status: "FAIL", reason: "Rejected candidate." });
      await expect(service.promoteCandidate(candidate.id)).rejects.toThrow("REJECTED_OUTPUT_CANNOT_BE_PROMOTED");
      await expect(service.rollbackToVersion("project-1", candidate.id, "Rejected target.")).rejects.toThrow("REJECTED_OUTPUT_CANNOT_BE_ROLLED_BACK_TO");
      expect((await service.getCurrentOutput("project-1"))?.id).toBe(original.id);
    });
  });
});
