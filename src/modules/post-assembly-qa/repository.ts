import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { QaRun } from "./types";
export const POST_ASSEMBLY_QA_VALIDATOR_VERSION = "1.0.0";
export async function hashFinalVideo(path: string) {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}
export type QaRunPersistence = {
  find(projectId: string, hash: string, version: string): Promise<QaRun | null>;
  create(run: QaRun): Promise<QaRun>;
  complete(run: QaRun): Promise<QaRun>;
  fail(run: QaRun, error: string): Promise<QaRun>;
  interrupt(run: QaRun): Promise<void>;
  recoverStaleRunning(
    projectId?: string,
    activeRunId?: string,
  ): Promise<number>;
};
export function prismaQaRunPersistence(): QaRunPersistence {
  const read = (row: { findings: unknown } | null) =>
    row ? (row.findings as QaRun) : null;
  const find = async (projectId: string, hash: string, version: string) =>
    read(
      await db.postAssemblyQaRun.findUnique({
        where: {
          projectId_finalVideoHash_validatorVersion: {
            projectId,
            finalVideoHash: hash,
            validatorVersion: version,
          },
        },
      }),
    );
  return {
    find,
    create: async (run) => {
      try {
        await db.postAssemblyQaRun.create({
          data: {
            id: run.qaRunId,
            projectId: run.projectId,
            finalVideoPath: run.finalVideoPath,
            finalVideoHash: run.finalVideoHash,
            finalVideoVersion: run.finalVideoVersion,
            validatorVersion: run.validatorVersion,
            status: "RUNNING",
            qualityStatusBefore: run.qualityStatusBefore,
            validatorsRun: run.findings.map(
              (f) => f.validatorId,
            ) as Prisma.InputJsonValue,
            findings: run as unknown as Prisma.InputJsonValue,
            incidentsCreated: run.incidentsCreated as Prisma.InputJsonValue,
            repairsTriggered: run.repairsTriggered as Prisma.InputJsonValue,
          },
        });
        return run;
      } catch (error) {
        if ((error as { code?: string }).code === "P2002") {
          const existing = await find(
            run.projectId,
            run.finalVideoHash,
            run.validatorVersion,
          );
          if (existing) return existing;
        }
        throw error;
      }
    },
    complete: async (run) => {
      await db.postAssemblyQaRun.update({
        where: { id: run.qaRunId },
        data: {
          status: "COMPLETED",
          qualityStatusAfter: run.qualityStatusAfter,
          validatorsRun: run.findings.map(
            (f) => f.validatorId,
          ) as Prisma.InputJsonValue,
          findings: run as unknown as Prisma.InputJsonValue,
          incidentsCreated: run.incidentsCreated as Prisma.InputJsonValue,
          repairsTriggered: run.repairsTriggered as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      return run;
    },
    fail: async (run, error) => {
      const failed = {
        ...run,
        status: "FAILED" as const,
        finishedAt: new Date().toISOString(),
      };
      await db.postAssemblyQaRun.update({
        where: { id: run.qaRunId },
        data: {
          status: "FAILED",
          error,
          findings: failed as unknown as Prisma.InputJsonValue,
          finishedAt: new Date(),
        },
      });
      return failed;
    },
    interrupt: async (run) => {
      await db.postAssemblyQaRun.update({
        where: { id: run.qaRunId },
        data: {
          status: "INTERRUPTED",
          qualityStatusAfter: "NEEDS_REVIEW",
          finishedAt: new Date(),
        },
      });
    },
    recoverStaleRunning: async (projectId, activeRunId) => {
      const result = await db.postAssemblyQaRun.updateMany({
        where: {
          status: "RUNNING",
          ...(projectId ? { projectId } : {}),
          ...(activeRunId ? { id: { not: activeRunId } } : {}),
        },
        data: {
          status: "INTERRUPTED",
          qualityStatusAfter: "NEEDS_REVIEW",
          error: "INTERRUPTED_AFTER_RESTART",
          finishedAt: new Date(),
        },
      });
      return result.count;
    },
  };
}

export async function recoverStaleRunning(
  projectId?: string,
  activeRunId?: string,
) {
  return prismaQaRunPersistence().recoverStaleRunning(projectId, activeRunId);
}
