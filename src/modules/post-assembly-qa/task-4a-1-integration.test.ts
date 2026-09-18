import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCodexJob } from "../codex-orchestrator/service";
import { PostAssemblyQaOrchestrator } from "./orchestrator";
import { hashFinalVideo, POST_ASSEMBLY_QA_VALIDATOR_VERSION, prismaQaRunPersistence } from "./repository";
import type { QaContext, QaFinding, QaValidator } from "./types";

const dbMocks = vi.hoisted(() => ({
  db: {
    postAssemblyQaRun: null as unknown,
    codexJob: { findFirst: vi.fn(), update: vi.fn() },
    codexStageState: { findMany: vi.fn() },
    codexEvent: { findMany: vi.fn() },
    runtimeFailure: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ db: dbMocks.db }));
vi.mock("../codex-orchestrator/storage", () => ({ ensureCodexStorage: vi.fn(async () => undefined) }));

const context = (finalVideoPath = "final.mp4"): QaContext => ({ projectId: "project", finalVideoPath, finalVideoVersion: "version-1", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { finalMediaValidation: true } });
const passingFinding: QaFinding = { validatorId: "pass-validator", status: "PASS", sceneNumber: null, globalTimestamp: null, sceneLocalTimestamp: null, expected: {}, actual: {}, evidence: [], confidence: 1, severity: "LOW", suggestedFirstDivergence: null, affectedRegion: null, affectedFile: null };
const reviewFinding: QaFinding = { validatorId: "review-validator", status: "FAIL", sceneNumber: 1, globalTimestamp: 0, sceneLocalTimestamp: 0, expected: "approved", actual: "different", evidence: ["fixture"], confidence: 1, severity: "HIGH", suggestedFirstDivergence: "TEST_FINDING", affectedRegion: "frame", affectedFile: "final.mp4", symptom: "TEST_FINDING" };
const passingValidator: QaValidator = { id: "pass-validator", validate: async () => [passingFinding] };
const reviewValidator: QaValidator = { id: "review-validator", validate: async () => [reviewFinding] };

async function createSqliteSchema(client: PrismaClient) {
  await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyQaRun" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "finalVideoPath" TEXT NOT NULL, "finalVideoHash" TEXT NOT NULL, "finalVideoVersion" TEXT NOT NULL, "validatorVersion" TEXT NOT NULL, "status" TEXT NOT NULL, "qualityStatusBefore" TEXT NOT NULL, "qualityStatusAfter" TEXT, "validatorsRun" JSONB NOT NULL, "findings" JSONB NOT NULL, "incidentsCreated" JSONB NOT NULL, "repairsTriggered" JSONB NOT NULL, "error" TEXT, "startedAt" DATETIME NOT NULL, "finishedAt" DATETIME, "updatedAt" DATETIME NOT NULL)');
  await client.$executeRawUnsafe('CREATE UNIQUE INDEX "qa_identity" ON "PostAssemblyQaRun"("projectId", "finalVideoHash", "validatorVersion")');
}

async function withSqlite<T>(callback: (client: PrismaClient, root: string, database: string) => Promise<T>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "task-4a-1-integration-"));
  const database = path.join(root, "qa.db").replace(/\\/g, "/");
  const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
  dbMocks.db.postAssemblyQaRun = client.postAssemblyQaRun;
  try {
    await createSqliteSchema(client);
    return await callback(client, root, database);
  } finally {
    await client.$disconnect();
    dbMocks.db.postAssemblyQaRun = null;
    await rm(root, { recursive: true, force: true });
  }
}

async function insertQaRow(client: PrismaClient, data: { id: string; hash: string; version: string; status: string; qualityStatusAfter?: string | null; error?: string | null }) {
  await client.postAssemblyQaRun.create({
    data: {
      id: data.id,
      projectId: "project",
      finalVideoPath: "final.mp4",
      finalVideoHash: data.hash,
      finalVideoVersion: data.hash,
      validatorVersion: data.version,
      status: data.status,
      qualityStatusBefore: "NOT_RUN",
      qualityStatusAfter: data.qualityStatusAfter ?? null,
      validatorsRun: [],
      findings: { qaRunId: data.id, projectId: "project", finalVideoPath: "final.mp4", finalVideoHash: data.hash, finalVideoVersion: data.hash, validatorVersion: data.version, status: data.status, findings: [], incidentsCreated: [], repairsTriggered: [], qualityStatusBefore: "NOT_RUN", qualityStatusAfter: data.qualityStatusAfter ?? "CHECKING", startedAt: new Date().toISOString(), finishedAt: data.status === "RUNNING" ? null : new Date().toISOString() },
      incidentsCreated: [],
      repairsTriggered: [],
      error: data.error ?? null,
      startedAt: new Date(),
      finishedAt: data.status === "RUNNING" ? null : new Date(),
      updatedAt: new Date(),
    },
  });
}

async function withReopenedJob<T>(qaStatus: "APPROVED" | "NEEDS_REVIEW", callback: (job: { qualityStatus: string; generationStatus: string; outputReady: boolean }) => Promise<T>) {
  return withSqlite(async (_client, root) => {
    const finalVideoPath = path.join(root, "final.mp4");
    await writeFile(finalVideoPath, "current-final-video");
    const persistence = prismaQaRunPersistence();
    const validator = qaStatus === "APPROVED" ? passingValidator : reviewValidator;
    await new PostAssemblyQaOrchestrator([validator], persistence, hashFinalVideo).run(context(finalVideoPath));
    dbMocks.db.codexJob.findFirst.mockResolvedValue({ id: "job", userId: "user", contentProjectId: "project", finalVideoPath, qualityStatus: "NOT_RUN", generationStatus: "SUCCESS", outputReady: true, status: "COMPLETED", currentStage: "FINAL_ASSEMBLY", currentAction: "jobComplete" });
    dbMocks.db.codexJob.update.mockResolvedValue({});
    dbMocks.db.codexStageState.findMany.mockResolvedValue([]);
    dbMocks.db.codexEvent.findMany.mockResolvedValue([]);
    dbMocks.db.runtimeFailure.findMany.mockResolvedValue([]);
    return callback(await getCodexJob("user", "job"));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.db.postAssemblyQaRun = null;
  dbMocks.db.codexJob.findFirst.mockResolvedValue(null);
  dbMocks.db.codexStageState.findMany.mockResolvedValue([]);
  dbMocks.db.codexEvent.findMany.mockResolvedValue([]);
  dbMocks.db.runtimeFailure.findMany.mockResolvedValue([]);
});

describe("TASK 4A.1 final 12-case integration proof", () => {
  it("MANDATORY_CASE_1: same identity reuses one logical QA run", async () => {
    await withSqlite(async client => {
      const persistence = prismaQaRunPersistence();
      const qa = new PostAssemblyQaOrchestrator([passingValidator], persistence, async () => "same-hash");
      const first = await qa.run(context());
      const second = await qa.run(context());
      expect(second.qaRunId).toBe(first.qaRunId);
      expect(await client.postAssemblyQaRun.count({ where: { projectId: "project", finalVideoHash: "same-hash", validatorVersion: POST_ASSEMBLY_QA_VALIDATOR_VERSION } })).toBe(1);
    });
  });

  it("MANDATORY_CASE_2: COMPLETED APPROVED is reused without rerunning validators", async () => {
    await withSqlite(async () => {
      const persistence = prismaQaRunPersistence();
      let validatorCalls = 0;
      const validator: QaValidator = { id: "counted-pass", validate: async () => { validatorCalls += 1; return [passingFinding]; } };
      const qa = new PostAssemblyQaOrchestrator([validator], persistence, async () => "approved-hash");
      const first = await qa.run(context());
      const second = await qa.run(context());
      expect(first.qualityStatusAfter).toBe("APPROVED");
      expect(second.qaRunId).toBe(first.qaRunId);
      expect(validatorCalls).toBe(1);
    });
  });

  it("MANDATORY_CASE_3: changing finalVideoHash creates a new QA run", async () => {
    await withSqlite(async client => {
      const persistence = prismaQaRunPersistence();
      let currentHash = "old-hash";
      const qa = new PostAssemblyQaOrchestrator([passingValidator], persistence, async () => currentHash);
      const oldRun = await qa.run(context());
      currentHash = "new-hash";
      const newRun = await qa.run(context());
      expect(newRun.qaRunId).not.toBe(oldRun.qaRunId);
      expect(await client.postAssemblyQaRun.count({ where: { projectId: "project" } })).toBe(2);
    });
  });

  it("MANDATORY_CASE_4: changing validatorVersion creates a new QA run", async () => {
    await withSqlite(async client => {
      await insertQaRow(client, { id: "old-version-run", hash: "same-hash", version: "0.9.0", status: "COMPLETED", qualityStatusAfter: "APPROVED" });
      const persistence = prismaQaRunPersistence();
      const run = await new PostAssemblyQaOrchestrator([passingValidator], persistence, async () => "same-hash").run(context());
      expect(run.qaRunId).not.toBe("old-version-run");
      expect(run.validatorVersion).toBe(POST_ASSEMBLY_QA_VALIDATOR_VERSION);
      expect(await client.postAssemblyQaRun.count({ where: { projectId: "project", finalVideoHash: "same-hash" } })).toBe(2);
    });
  });

  it("MANDATORY_CASE_5: stale RUNNING becomes INTERRUPTED and recovery is idempotent", async () => {
    await withSqlite(async client => {
      await insertQaRow(client, { id: "stale-run", hash: "stale-hash", version: POST_ASSEMBLY_QA_VALIDATOR_VERSION, status: "RUNNING" });
      const persistence = prismaQaRunPersistence();
      expect(await persistence.recoverStaleRunning("project")).toBe(1);
      expect((await client.postAssemblyQaRun.findUniqueOrThrow({ where: { id: "stale-run" } })).status).toBe("INTERRUPTED");
      expect(await persistence.recoverStaleRunning("project")).toBe(0);
      expect(await client.postAssemblyQaRun.count({ where: { projectId: "project" } })).toBe(1);
    });
  });

  it("MANDATORY_CASE_6: structured QA fields survive a fresh database reload", async () => {
    await withSqlite(async (client, _root, database) => {
      const persistence = prismaQaRunPersistence();
      const run = await new PostAssemblyQaOrchestrator([reviewValidator], persistence, async () => "structured-hash").run(context());
      const reloaded = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
      try {
        const row = await reloaded.postAssemblyQaRun.findUniqueOrThrow({ where: { id: run.qaRunId } });
        expect(row.validatorsRun).toEqual(["review-validator"]);
        expect(row.findings).toMatchObject({ qualityStatusAfter: "NEEDS_REVIEW" });
        expect(row.incidentsCreated).toEqual(expect.arrayContaining([expect.any(String)]));
        expect(row.repairsTriggered).toEqual([]);
        expect(row.qualityStatusBefore).toBe("NOT_RUN");
        expect(row.qualityStatusAfter).toBe("NEEDS_REVIEW");
        expect(row.error).toBeNull();
      } finally {
        await reloaded.$disconnect();
      }
    });
  });

  it("MANDATORY_CASE_7: project/job reopen restores qualityStatus from the matching QA run", async () => {
    await withReopenedJob("APPROVED", async job => {
      expect(job.qualityStatus).toBe("APPROVED");
    });
  });

  it("MANDATORY_CASE_8: QA restore does not change generationStatus SUCCESS", async () => {
    await withReopenedJob("NEEDS_REVIEW", async job => {
      expect(job.generationStatus).toBe("SUCCESS");
    });
  });

  it("MANDATORY_CASE_9: QA restore does not change outputReady true", async () => {
    await withReopenedJob("APPROVED", async job => {
      expect(job.outputReady).toBe(true);
    });
  });

  it("MANDATORY_CASE_10: concurrent requests use real SQLite uniqueness and reuse one run", async () => {
    await withSqlite(async client => {
      const persistence = prismaQaRunPersistence();
      const first = new PostAssemblyQaOrchestrator([passingValidator], persistence, async () => "concurrent-hash");
      const second = new PostAssemblyQaOrchestrator([passingValidator], persistence, async () => "concurrent-hash");
      const results = await Promise.all([first.run(context()), second.run(context())]);
      expect(results[0].qaRunId).toBe(results[1].qaRunId);
      expect(await client.postAssemblyQaRun.count({ where: { projectId: "project", finalVideoHash: "concurrent-hash", validatorVersion: POST_ASSEMBLY_QA_VALIDATOR_VERSION } })).toBe(1);
    });
  });

  it("MANDATORY_CASE_11: validator throw after RUNNING persists FAILED, finishedAt and error", async () => {
    await withSqlite(async (client, _root, database) => {
      const persistence = prismaQaRunPersistence();
      const throwingValidator: QaValidator = { id: "throwing-validator", validate: async () => { throw new TypeError("validator exploded"); } };
      const result = await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "failed-hash").run(context());
      const reloaded = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
      try {
        const row = await reloaded.postAssemblyQaRun.findUniqueOrThrow({ where: { id: result.qaRunId } });
        expect(row.status).toBe("FAILED");
        expect(row.finishedAt).not.toBeNull();
        const error = JSON.parse(row.error ?? "{}");
        expect(error).toMatchObject({ message: "validator exploded", name: "TypeError", stage: "POST_ASSEMBLY_QA", component: "throwing-validator" });
        expect(result.status).not.toBe("INTERRUPTED");
      } finally {
        await reloaded.$disconnect();
      }
    });
  });

  it("MANDATORY_CASE_12: COMPLETED NEEDS_REVIEW is reused without rerunning validators", async () => {
    await withSqlite(async () => {
      const persistence = prismaQaRunPersistence();
      let validatorCalls = 0;
      const validator: QaValidator = { id: "counted-review", validate: async () => { validatorCalls += 1; return [{ ...reviewFinding, validatorId: "counted-review" }]; } };
      const qa = new PostAssemblyQaOrchestrator([validator], persistence, async () => "review-hash");
      const first = await qa.run(context());
      const second = await qa.run(context());
      expect(first.qualityStatusAfter).toBe("NEEDS_REVIEW");
      expect(second.qaRunId).toBe(first.qaRunId);
      expect(validatorCalls).toBe(1);
    });
  });
});
