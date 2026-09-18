import { randomUUID, createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { Prisma, PrismaClient } from "@prisma/client";
import { ensureOutputVersionStorage } from "./storage";

export const OUTPUT_VERSION_STATUSES = ["ORIGINAL", "CANDIDATE", "CURRENT", "SUPERSEDED", "REJECTED"] as const;
export const OUTPUT_VALIDATION_STATUSES = ["PASS", "FAIL", "ERROR", "NOT_RUN"] as const;
export type OutputVersionStatus = typeof OUTPUT_VERSION_STATUSES[number];
export type OutputValidationStatus = typeof OUTPUT_VALIDATION_STATUSES[number];
export type OutputVersionRecord = {
  id: string;
  projectId: string;
  versionNumber: number;
  status: string;
  filePath: string;
  fileHash: string;
  createdAt: Date;
  createdFromVersionId: string | null;
  createdByRepairIncidentId: string | null;
  repairRuleId: string | null;
  validationStatus: string;
  promotedAt: Date | null;
  rejectedAt: Date | null;
  rollbackReason: string | null;
};

export type RegisterOriginalOutputInput = { projectId: string; filePath: string; validationStatus?: OutputValidationStatus };
export type CreateCandidateInput = { projectId: string; sourcePath: string; currentVersionId?: string; createdByRepairIncidentId?: string; repairRuleId?: string };
export type ValidationResultInput = { status: OutputValidationStatus; evidence?: Record<string, unknown>; reason?: string };
export type OutputVersionFileSystem = { access: typeof access; copyFile: typeof copyFile; mkdir: typeof mkdir; readFile: typeof readFile; rename: typeof rename };
export type OutputVersionAuditInput = { projectId: string; outputVersionId?: string; event: string; previousCurrentVersionId?: string; newCurrentVersionId?: string; reason?: string; metadata?: Record<string, unknown> };
type TransactionRunner = <T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

const fileSystem: OutputVersionFileSystem = { access, copyFile, mkdir, readFile, rename };
const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 100) || "project";

export async function hashOutputFile(filePath: string, fs: OutputVersionFileSystem = fileSystem) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex");
}

function assertStatus(status: string): asserts status is OutputVersionStatus {
  if (!(OUTPUT_VERSION_STATUSES as readonly string[]).includes(status)) throw new Error(`OUTPUT_VERSION_STATUS_INVALID:${status}`);
}

function assertValidationStatus(status: string): asserts status is OutputValidationStatus {
  if (!(OUTPUT_VALIDATION_STATUSES as readonly string[]).includes(status)) throw new Error(`OUTPUT_VALIDATION_STATUS_INVALID:${status}`);
}

export class OutputVersionService {
  constructor(private readonly client: PrismaClient = db, private readonly ensureStorage: () => Promise<void> = ensureOutputVersionStorage, private readonly fs: OutputVersionFileSystem = fileSystem, private readonly transactionRunner?: TransactionRunner) {}

  private async transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) {
    return this.transactionRunner ? this.transactionRunner(callback) : this.client.$transaction(callback);
  }

  private async current(projectId: string) {
    return this.client.postAssemblyOutputVersion.findFirst({ where: { projectId, status: "CURRENT" }, orderBy: { versionNumber: "desc" } });
  }

  private async nextVersionNumber(projectId: string) {
    const latest = await this.client.postAssemblyOutputVersion.findFirst({ where: { projectId }, orderBy: { versionNumber: "desc" }, select: { versionNumber: true } });
    return (latest?.versionNumber ?? 0) + 1;
  }

  private async verifyFile(filePath: string) {
    await this.fs.access(filePath);
    return hashOutputFile(filePath, this.fs);
  }

  private async audit(input: OutputVersionAuditInput) {
    await this.client.postAssemblyOutputVersionAudit.create({ data: { id: randomUUID(), projectId: input.projectId, outputVersionId: input.outputVersionId, event: input.event, previousCurrentVersionId: input.previousCurrentVersionId, newCurrentVersionId: input.newCurrentVersionId, reason: input.reason, metadata: (input.metadata ?? {}) as Prisma.InputJsonValue } });
  }

  async recordAudit(input: OutputVersionAuditInput) {
    await this.ensureStorage();
    return this.audit(input);
  }

  async getCurrentOutput(projectId: string) {
    await this.ensureStorage();
    return this.current(projectId);
  }

  async getOutputVersion(versionId: string) {
    await this.ensureStorage();
    return this.client.postAssemblyOutputVersion.findUnique({ where: { id: versionId } });
  }

  async listOutputVersions(projectId: string) {
    await this.ensureStorage();
    return this.client.postAssemblyOutputVersion.findMany({ where: { projectId }, orderBy: { versionNumber: "asc" } });
  }

  async registerOriginalOutput(input: RegisterOriginalOutputInput) {
    await this.ensureStorage();
    const validationStatus = input.validationStatus ?? "PASS";
    assertValidationStatus(validationStatus);
    if (validationStatus !== "PASS") throw new Error("ORIGINAL_OUTPUT_REQUIRES_VALIDATION_PASS");
    const fileHash = await this.verifyFile(input.filePath);
    const current = await this.current(input.projectId);
    if (current) {
      if (current.filePath === input.filePath && current.fileHash === fileHash) return current;
      throw new Error(`CURRENT_OUTPUT_ALREADY_REGISTERED:${current.id}`);
    }
    const version = await this.client.postAssemblyOutputVersion.create({ data: { id: randomUUID(), projectId: input.projectId, versionNumber: await this.nextVersionNumber(input.projectId), status: "CURRENT", filePath: input.filePath, fileHash, validationStatus: "PASS", promotedAt: new Date() } });
    await this.audit({ projectId: input.projectId, outputVersionId: version.id, event: "ORIGINAL_OUTPUT_REGISTERED", newCurrentVersionId: version.id, metadata: { status: "CURRENT", validationStatus: "PASS" } });
    return version;
  }

  async createCandidate(input: CreateCandidateInput) {
    await this.ensureStorage();
    const current = await this.current(input.projectId);
    if (!current) throw new Error(`CURRENT_OUTPUT_NOT_FOUND:${input.projectId}`);
    if (input.currentVersionId && input.currentVersionId !== current.id) throw new Error("CURRENT_OUTPUT_CHANGED_BEFORE_CANDIDATE_CREATION");
    // The coordinator may seed a candidate by copying the current output. The
    // destination is always a new versioned path; only direct writes to the
    // CURRENT path are forbidden by the candidate workflow.
    const sourceHash = await this.verifyFile(input.sourcePath);
    const versionNumber = await this.nextVersionNumber(input.projectId);
    const outputVersionId = randomUUID();
    const candidateDirectory = path.join(path.dirname(input.sourcePath), "output-versions");
    const extension = path.extname(input.sourcePath) || ".mp4";
    const candidatePath = path.join(candidateDirectory, `${safeSegment(input.projectId)}-v${versionNumber}-candidate-${outputVersionId}${extension}`);
    const temporaryPath = `${candidatePath}.tmp`;
    await this.fs.mkdir(candidateDirectory, { recursive: true });
    await this.fs.copyFile(input.sourcePath, temporaryPath);
    await this.fs.rename(temporaryPath, candidatePath);
    const fileHash = await this.verifyFile(candidatePath);
    const candidate = await this.client.postAssemblyOutputVersion.create({ data: { id: outputVersionId, projectId: input.projectId, versionNumber, status: "CANDIDATE", filePath: candidatePath, fileHash, createdFromVersionId: current.id, createdByRepairIncidentId: input.createdByRepairIncidentId, repairRuleId: input.repairRuleId, validationStatus: "NOT_RUN" } });
    await this.audit({ projectId: input.projectId, outputVersionId: candidate.id, event: "CANDIDATE_CREATED", previousCurrentVersionId: current.id, metadata: { sourceHash, candidateHash: fileHash, createdFromVersionId: current.id } });
    return candidate;
  }

  async markCandidateValidated(versionId: string, result: ValidationResultInput) {
    await this.ensureStorage();
    assertValidationStatus(result.status);
    const candidate = await this.client.postAssemblyOutputVersion.findUnique({ where: { id: versionId } });
    if (!candidate) throw new Error(`OUTPUT_VERSION_NOT_FOUND:${versionId}`);
    assertStatus(candidate.status);
    if (candidate.status === "REJECTED" && result.status !== "PASS") return candidate;
    if (candidate.status !== "CANDIDATE") throw new Error(`OUTPUT_VERSION_NOT_CANDIDATE:${versionId}`);
    const rejected = result.status !== "PASS";
    const fileHash = rejected ? candidate.fileHash : await this.verifyFile(candidate.filePath);
    const updated = await this.client.postAssemblyOutputVersion.update({ where: { id: versionId }, data: { fileHash, validationStatus: result.status, status: rejected ? "REJECTED" : "CANDIDATE", rejectedAt: rejected ? new Date() : null, rollbackReason: rejected ? result.reason ?? `Candidate validation ${result.status}.` : null } });
    await this.audit({ projectId: candidate.projectId, outputVersionId: versionId, event: "CANDIDATE_VALIDATION_RECORDED", reason: result.reason, metadata: { validationStatus: result.status, evidence: result.evidence ?? {} } });
    if (rejected) await this.audit({ projectId: candidate.projectId, outputVersionId: versionId, event: "CANDIDATE_REJECTED", reason: result.reason ?? `Candidate validation ${result.status}.` });
    return updated;
  }

  async rejectCandidate(versionId: string, reason: string) {
    await this.ensureStorage();
    const candidate = await this.client.postAssemblyOutputVersion.findUnique({ where: { id: versionId } });
    if (!candidate) throw new Error(`OUTPUT_VERSION_NOT_FOUND:${versionId}`);
    assertStatus(candidate.status);
    if (candidate.status === "REJECTED") return candidate;
    if (candidate.status === "CURRENT") throw new Error("CURRENT_OUTPUT_CANNOT_BE_REJECTED");
    const rejected = await this.client.postAssemblyOutputVersion.update({ where: { id: versionId }, data: { status: "REJECTED", validationStatus: candidate.validationStatus === "PASS" ? "ERROR" : candidate.validationStatus, rejectedAt: new Date(), rollbackReason: reason } });
    await this.audit({ projectId: candidate.projectId, outputVersionId: versionId, event: "CANDIDATE_REJECTED", reason });
    return rejected;
  }

  async promoteCandidate(versionId: string) {
    await this.ensureStorage();
    const candidate = await this.client.postAssemblyOutputVersion.findUnique({ where: { id: versionId } });
    if (!candidate) throw new Error(`OUTPUT_VERSION_NOT_FOUND:${versionId}`);
    assertStatus(candidate.status);
    assertValidationStatus(candidate.validationStatus);
    if (candidate.status === "CURRENT") return candidate;
    if (candidate.status === "REJECTED") throw new Error("REJECTED_OUTPUT_CANNOT_BE_PROMOTED");
    if (candidate.validationStatus !== "PASS") throw new Error(`CANDIDATE_VALIDATION_REQUIRED:${candidate.validationStatus}`);
    const actualHash = await this.verifyFile(candidate.filePath).catch(() => null);
    if (!actualHash) {
      await this.rejectCandidate(versionId, "Candidate file is missing or inaccessible.");
      throw new Error("CANDIDATE_FILE_MISSING");
    }
    if (actualHash !== candidate.fileHash) {
      await this.rejectCandidate(versionId, "Candidate file hash changed after validation.");
      throw new Error("CANDIDATE_FILE_HASH_MISMATCH");
    }
    const current = await this.current(candidate.projectId);
    if (!current) throw new Error(`CURRENT_OUTPUT_NOT_FOUND:${candidate.projectId}`);
    if (candidate.createdFromVersionId && candidate.createdFromVersionId !== current.id) throw new Error("CANDIDATE_BASE_VERSION_IS_STALE");
    if (candidate.fileHash === current.fileHash) throw new Error("CANDIDATE_HASH_IDENTICAL_TO_CURRENT");
    await this.audit({ projectId: candidate.projectId, outputVersionId: versionId, event: "PROMOTION_ATTEMPTED", previousCurrentVersionId: current.id, newCurrentVersionId: versionId });
    try {
      const promoted = await this.transaction(async (transaction) => {
        const currentAtTransaction = await transaction.postAssemblyOutputVersion.findFirst({ where: { projectId: candidate.projectId, status: "CURRENT" }, orderBy: { versionNumber: "desc" } });
        if (!currentAtTransaction || currentAtTransaction.id !== current.id) throw new Error("CURRENT_OUTPUT_CHANGED_DURING_PROMOTION");
        await transaction.postAssemblyOutputVersion.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
        return transaction.postAssemblyOutputVersion.update({ where: { id: versionId }, data: { status: "CURRENT", promotedAt: new Date(), rejectedAt: null, rollbackReason: null } });
      });
      await this.audit({ projectId: candidate.projectId, outputVersionId: versionId, event: "PROMOTION_SUCCEEDED", previousCurrentVersionId: current.id, newCurrentVersionId: versionId });
      return promoted;
    } catch (error) {
      await this.audit({ projectId: candidate.projectId, outputVersionId: versionId, event: "PROMOTION_FAILED", previousCurrentVersionId: current.id, newCurrentVersionId: versionId, reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async rollbackToVersion(projectId: string, versionId: string, reason: string) {
    await this.ensureStorage();
    const target = await this.client.postAssemblyOutputVersion.findUnique({ where: { id: versionId } });
    if (!target || target.projectId !== projectId) throw new Error(`OUTPUT_VERSION_NOT_FOUND:${versionId}`);
    assertStatus(target.status);
    assertValidationStatus(target.validationStatus);
    if (target.status === "REJECTED") throw new Error("REJECTED_OUTPUT_CANNOT_BE_ROLLED_BACK_TO");
    if (target.validationStatus !== "PASS") throw new Error(`ROLLBACK_VALIDATION_REQUIRED:${target.validationStatus}`);
    const targetHash = await this.verifyFile(target.filePath).catch(() => null);
    if (!targetHash || targetHash !== target.fileHash) throw new Error("ROLLBACK_TARGET_FILE_INVALID");
    const current = await this.current(projectId);
    if (!current) throw new Error(`CURRENT_OUTPUT_NOT_FOUND:${projectId}`);
    if (current.id === target.id) return current;
    await this.audit({ projectId, outputVersionId: target.id, event: "ROLLBACK_ATTEMPTED", previousCurrentVersionId: current.id, newCurrentVersionId: target.id, reason });
    try {
      const rolledBack = await this.transaction(async (transaction) => {
        const currentAtTransaction = await transaction.postAssemblyOutputVersion.findFirst({ where: { projectId, status: "CURRENT" }, orderBy: { versionNumber: "desc" } });
        if (!currentAtTransaction || currentAtTransaction.id !== current.id) throw new Error("CURRENT_OUTPUT_CHANGED_DURING_ROLLBACK");
        await transaction.postAssemblyOutputVersion.update({ where: { id: current.id }, data: { status: "SUPERSEDED" } });
        return transaction.postAssemblyOutputVersion.update({ where: { id: target.id }, data: { status: "CURRENT", promotedAt: new Date(), rollbackReason: reason } });
      });
      await this.audit({ projectId, outputVersionId: target.id, event: "ROLLBACK_SUCCEEDED", previousCurrentVersionId: current.id, newCurrentVersionId: target.id, reason });
      return rolledBack;
    } catch (error) {
      await this.audit({ projectId, outputVersionId: target.id, event: "ROLLBACK_FAILED", previousCurrentVersionId: current.id, newCurrentVersionId: target.id, reason: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }
}

const defaultService = new OutputVersionService();
export const getCurrentOutput = (projectId: string) => defaultService.getCurrentOutput(projectId);
export const getOutputVersion = (versionId: string) => defaultService.getOutputVersion(versionId);
export const listOutputVersions = (projectId: string) => defaultService.listOutputVersions(projectId);
export const registerOriginalOutput = (input: RegisterOriginalOutputInput) => defaultService.registerOriginalOutput(input);
export const createCandidate = (input: CreateCandidateInput) => defaultService.createCandidate(input);
export const markCandidateValidated = (versionId: string, result: ValidationResultInput) => defaultService.markCandidateValidated(versionId, result);
export const promoteCandidate = (versionId: string) => defaultService.promoteCandidate(versionId);
export const rejectCandidate = (versionId: string, reason: string) => defaultService.rejectCandidate(versionId, reason);
export const rollbackToVersion = (projectId: string, versionId: string, reason: string) => defaultService.rollbackToVersion(projectId, versionId, reason);
