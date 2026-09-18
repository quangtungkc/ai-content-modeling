import { PrismaClient } from "@prisma/client";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { PostAssemblyQaOrchestrator } from "./orchestrator";
import { POST_ASSEMBLY_QA_VALIDATOR_VERSION, prismaQaRunPersistence, type QaRunPersistence } from "./repository";
import type { QaContext, QaFinding, QaValidator } from "./types";

const dbMocks = vi.hoisted(() => ({ db: { postAssemblyQaRun: null as unknown } }));

vi.mock("@/lib/db", () => ({ db: dbMocks.db }));

const context: QaContext = { projectId: "project", finalVideoPath: "final.mp4", finalVideoVersion: "version-1", approvedManifest: null, expectedSceneStates: {}, approvedSources: [], checkpoint: { finalMediaValidation: true } };
const passingFinding: QaFinding = { validatorId: "pass-validator", status: "PASS", sceneNumber: null, globalTimestamp: null, sceneLocalTimestamp: null, expected: {}, actual: {}, evidence: [], confidence: 1, severity: "LOW", suggestedFirstDivergence: null, affectedRegion: null, affectedFile: null };
const passingValidator: QaValidator = { id: "pass-validator", validate: async () => [passingFinding] };

function persistenceFake(overrides: Partial<QaRunPersistence> = {}) {
  const calls: string[] = [];
  const failedRuns: Array<{ error: string; run: Awaited<ReturnType<QaRunPersistence["find"]>> }> = [];
  const runs = new Map<string, Awaited<ReturnType<QaRunPersistence["find"]>>>();
  const persistence: QaRunPersistence = {
    find: async (_projectId, hash, version) => runs.get(`${hash}:${version}`) ?? null,
    create: async run => { calls.push("create"); runs.set(`${run.finalVideoHash}:${run.validatorVersion}`, run); return run; },
    complete: async run => { calls.push("complete"); runs.set(`${run.finalVideoHash}:${run.validatorVersion}`, run); return run; },
    fail: async (run, error) => { calls.push(`fail:${error}`); failedRuns.push({ error, run }); const failed = { ...run, status: "FAILED" as const }; runs.set(`${run.finalVideoHash}:${run.validatorVersion}`, failed); return failed; },
    interrupt: async () => { calls.push("interrupt"); },
    recoverStaleRunning: async () => 0,
    ...overrides,
  };
  return { persistence, calls, failedRuns, runs };
}

async function createSqliteSchema(client: PrismaClient) {
  await client.$executeRawUnsafe('CREATE TABLE "PostAssemblyQaRun" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "finalVideoPath" TEXT NOT NULL, "finalVideoHash" TEXT NOT NULL, "finalVideoVersion" TEXT NOT NULL, "validatorVersion" TEXT NOT NULL, "status" TEXT NOT NULL, "qualityStatusBefore" TEXT NOT NULL, "qualityStatusAfter" TEXT, "validatorsRun" JSONB NOT NULL, "findings" JSONB NOT NULL, "incidentsCreated" JSONB NOT NULL, "repairsTriggered" JSONB NOT NULL, "error" TEXT, "startedAt" DATETIME NOT NULL, "finishedAt" DATETIME, "updatedAt" DATETIME NOT NULL)');
  await client.$executeRawUnsafe('CREATE UNIQUE INDEX "qa_identity" ON "PostAssemblyQaRun"("projectId", "finalVideoHash", "validatorVersion")');
}

describe("PostAssemblyQaOrchestrator caught execution failures", () => {
  it("CASE 4 reload preserves FAILED status and normalized error in real SQLite", async () => {
    const sqliteRoot = await mkdtemp(path.join(os.tmpdir(), "qa-failed-execution-"));
    const database = path.join(sqliteRoot, "qa.db").replace(/\\/g, "/");
    const client = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
    dbMocks.db.postAssemblyQaRun = client.postAssemblyQaRun;
    try {
      await createSqliteSchema(client);
      const persistence = prismaQaRunPersistence();
      const throwingValidator: QaValidator = { id: "validator-boom", validate: async () => { throw new TypeError("validator exploded"); } };
      const result = await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "current-hash").run(context);
      expect(result.status).toBe("FAILED");
      expect(result.finishedAt).not.toBeNull();
      expect(result.qualityStatusAfter).toBe("NEEDS_REVIEW");
      expect(result.status).not.toBe("INTERRUPTED");

      const reloadedClient = new PrismaClient({ datasources: { db: { url: `file:${database}` } } });
      try {
        const row = await reloadedClient.postAssemblyQaRun.findUniqueOrThrow({ where: { id: result.qaRunId } });
        expect(row.status).toBe("FAILED");
        expect(row.finishedAt).not.toBeNull();
        const error = JSON.parse(row.error ?? "{}");
        expect(error).toMatchObject({ message: "validator exploded", name: "TypeError", type: "TypeError", stage: "POST_ASSEMBLY_QA", component: "validator-boom" });
        expect(error.timestamp).toEqual(expect.any(String));
      } finally {
        await reloadedClient.$disconnect();
      }
    } finally {
      await client.$disconnect();
      await rm(sqliteRoot, { recursive: true, force: true });
    }
  });

  it("CASE 1 persists a validator throw as FAILED after RUNNING", async () => {
    const { persistence, calls } = persistenceFake();
    const throwingValidator: QaValidator = { id: "validator-boom", validate: async () => { throw new TypeError("validator exploded"); } };
    const result = await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "throw-hash").run(context);
    expect(result.status).toBe("FAILED");
    expect(calls[0]).toBe("create");
    expect(calls[1]).toMatch(/^fail:/);
  });

  it("CASE 2 sets finishedAt on a FAILED result", async () => {
    const { persistence } = persistenceFake();
    const throwingValidator: QaValidator = { id: "validator-finished", validate: async () => { throw new Error("finished-at failure"); } };
    const result = await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "finished-hash").run(context);
    expect(result.status).toBe("FAILED");
    expect(result.finishedAt).toEqual(expect.any(String));
  });

  it("CASE 3 persists the original error message and metadata", async () => {
    const { persistence, failedRuns } = persistenceFake();
    const throwingValidator: QaValidator = { id: "validator-error", validate: async () => { throw new TypeError("message must survive"); } };
    await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "error-hash").run(context);
    expect(failedRuns).toHaveLength(1);
    const error = JSON.parse(failedRuns[0].error);
    expect(error).toMatchObject({ message: "message must survive", name: "TypeError", type: "TypeError", stage: "POST_ASSEMBLY_QA", component: "validator-error" });
    expect(error.timestamp).toEqual(expect.any(String));
  });

  it("CASE 5 keeps the normal PASS path COMPLETED", async () => {
    const { persistence, calls } = persistenceFake();
    const result = await new PostAssemblyQaOrchestrator([passingValidator], persistence, async () => "pass-hash").run(context);
    expect(result.status).toBe("COMPLETED");
    expect(calls).toEqual(["create", "complete"]);
  });

  it("CASE 6 does not convert a caught exception to INTERRUPTED", async () => {
    const { persistence } = persistenceFake();
    const throwingValidator: QaValidator = { id: "validator-status", validate: async () => { throw new Error("caught failure"); } };
    const result = await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "status-hash").run(context);
    expect(result.status).toBe("FAILED");
    expect(result.status).not.toBe("INTERRUPTED");
  });

  it("CASE 7 preserves generationStatus SUCCESS", async () => {
    const { persistence } = persistenceFake();
    const generationStatus = "SUCCESS";
    const throwingValidator: QaValidator = { id: "validator-generation", validate: async () => { throw new Error("generation guard"); } };
    await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "generation-hash").run(context);
    expect(generationStatus).toBe("SUCCESS");
  });

  it("CASE 8 preserves outputReady true", async () => {
    const { persistence } = persistenceFake();
    const outputReady = true;
    const throwingValidator: QaValidator = { id: "validator-output", validate: async () => { throw new Error("output guard"); } };
    await new PostAssemblyQaOrchestrator([throwingValidator], persistence, async () => "output-hash").run(context);
    expect(outputReady).toBe(true);
  });

  it("finding/result persistence throw is also converted to FAILED", async () => {
    const { persistence, calls } = persistenceFake({
      complete: async () => { throw new Error("finding persistence exploded"); },
    });
    const result = await new PostAssemblyQaOrchestrator([passingValidator], persistence, async () => "persist-hash").run(context);
    expect(result.status).toBe("FAILED");
    expect(calls[0]).toBe("create");
    expect(calls[1]).toMatch(/^fail:/);
    expect(calls[1]).toContain("finding persistence exploded");
  });
});
