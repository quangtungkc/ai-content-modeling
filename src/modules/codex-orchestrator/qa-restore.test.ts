import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCodexJob, restoreQualityStatusForJob } from "./service";

const mocks = vi.hoisted(() => ({
  codexJobFindFirst: vi.fn(),
  codexJobUpdate: vi.fn(),
  stageFindMany: vi.fn(),
  eventFindMany: vi.fn(),
  runtimeFailureFindMany: vi.fn(),
  qaFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    codexJob: { findFirst: mocks.codexJobFindFirst, update: mocks.codexJobUpdate },
    codexStageState: { findMany: mocks.stageFindMany },
    codexEvent: { findMany: mocks.eventFindMany },
    runtimeFailure: { findMany: mocks.runtimeFailureFindMany },
    postAssemblyQaRun: { findUnique: mocks.qaFindUnique },
  },
}));

vi.mock("./storage", () => ({ ensureCodexStorage: vi.fn(async () => undefined) }));

const job = { id: "job", projectId: "project", finalVideoPath: "final.mp4", qualityStatus: "NOT_RUN", generationStatus: "SUCCESS", outputReady: true };
const restore = (run: { qualityStatusAfter: string } | null, hash = "current", version = "1.0.0") => restoreQualityStatusForJob(job, { fileExists: async () => undefined, hash: async () => hash, findQaRun: async (_project, actualHash, actualVersion) => actualHash === hash && actualVersion === version ? run : null });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.codexJobFindFirst.mockResolvedValue({
    id: "job",
    userId: "user",
    contentProjectId: "project-current",
    finalVideoPath: null,
    qualityStatus: "NOT_RUN",
    generationStatus: "SUCCESS",
    outputReady: true,
    status: "COMPLETED",
    currentStage: "FINAL_ASSEMBLY",
    currentAction: "jobComplete",
  });
  mocks.codexJobUpdate.mockResolvedValue({});
  mocks.stageFindMany.mockResolvedValue([]);
  mocks.eventFindMany.mockResolvedValue([]);
  mocks.runtimeFailureFindMany.mockResolvedValue([]);
  mocks.qaFindUnique.mockResolvedValue(null);
});

describe("Codex job QA status restore", () => {
  it("CASE 1 restores APPROVED through the real project reopen load path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "qa-restore-load-"));
    const finalVideoPath = path.join(root, "final.mp4");
    const bytes = Buffer.from("current-final-video");
    const currentHash = createHash("sha256").update(bytes).digest("hex");
    await writeFile(finalVideoPath, bytes);
    mocks.codexJobFindFirst.mockResolvedValue({
      id: "job",
      userId: "user",
      contentProjectId: "project-current",
      finalVideoPath,
      qualityStatus: "NOT_RUN",
      generationStatus: "SUCCESS",
      outputReady: true,
      status: "COMPLETED",
      currentStage: "FINAL_ASSEMBLY",
      currentAction: "jobComplete",
    });
    mocks.qaFindUnique.mockImplementation(async (args: { where: { projectId_finalVideoHash_validatorVersion: { projectId: string; finalVideoHash: string; validatorVersion: string } } }) => {
      expect(args.where.projectId_finalVideoHash_validatorVersion).toEqual({ projectId: "project-current", finalVideoHash: currentHash, validatorVersion: "1.0.0" });
      return { findings: { qualityStatusAfter: "APPROVED" } };
    });

    try {
      const reopened = await getCodexJob("user", "job");
      expect(reopened.qualityStatus).toBe("APPROVED");
      expect(reopened.generationStatus).toBe("SUCCESS");
      expect(reopened.outputReady).toBe(true);
      expect(mocks.codexJobUpdate).toHaveBeenCalledWith({ where: { id: "job" }, data: { qualityStatus: "APPROVED" } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("CASE 2 restores NEEDS_REVIEW for the current hash and version", async () => { expect((await restore({ qualityStatusAfter: "NEEDS_REVIEW" })).qualityStatus).toBe("NEEDS_REVIEW"); });
  it("CASE 3 rejects an APPROVED result from an old hash", async () => { expect((await restore(null, "new-hash")).qualityStatus).toBe("NOT_RUN"); });
  it("CASE 4 returns NOT_RUN when no QA run matches", async () => { expect((await restore(null)).qualityStatus).toBe("NOT_RUN"); });
  it("CASE 5 rejects a QA result from another validator version", async () => { expect((await restore(null, "current", "2.0.0")).qualityStatus).toBe("NOT_RUN"); });
  it("CASE 6 preserves generationStatus SUCCESS when restoring APPROVED", async () => { const result = await restore({ qualityStatusAfter: "APPROVED" }); expect(result.generationStatus).toBe("SUCCESS"); });
  it("CASE 7 preserves generationStatus SUCCESS when restoring NEEDS_REVIEW", async () => { const result = await restore({ qualityStatusAfter: "NEEDS_REVIEW" }); expect(result.generationStatus).toBe("SUCCESS"); });
  it("CASE 8 preserves outputReady for every supported QA restore status", async () => {
    for (const qualityStatusAfter of ["APPROVED", "NEEDS_REVIEW", "REPAIR_FAILED"]) {
      const result = await restore({ qualityStatusAfter });
      expect(result.outputReady).toBe(true);
    }
  });
});
