import { db } from "@/lib/db";

let ready: Promise<void> | null = null;

export function ensureOutputVersionStorage() {
  if (!ready) ready = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "PostAssemblyOutputVersion" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "versionNumber" INTEGER NOT NULL, "status" TEXT NOT NULL, "filePath" TEXT NOT NULL, "fileHash" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdFromVersionId" TEXT, "createdByRepairIncidentId" TEXT, "repairRuleId" TEXT, "validationStatus" TEXT NOT NULL, "promotedAt" DATETIME, "rejectedAt" DATETIME, "rollbackReason" TEXT)`,
      `CREATE TABLE IF NOT EXISTS "PostAssemblyOutputVersionAudit" ("id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "outputVersionId" TEXT, "event" TEXT NOT NULL, "previousCurrentVersionId" TEXT, "newCurrentVersionId" TEXT, "reason" TEXT, "metadata" JSONB NOT NULL DEFAULT '{}', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_projectId_versionNumber_key" ON "PostAssemblyOutputVersion"("projectId", "versionNumber")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_one_current_per_project" ON "PostAssemblyOutputVersion"("projectId") WHERE "status" = 'CURRENT'`,
      `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_projectId_status_idx" ON "PostAssemblyOutputVersion"("projectId", "status")`,
      `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersion_projectId_fileHash_idx" ON "PostAssemblyOutputVersion"("projectId", "fileHash")`,
      `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersionAudit_projectId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("projectId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "PostAssemblyOutputVersionAudit_outputVersionId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("outputVersionId", "createdAt")`,
    ];
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  })();
  return ready;
}
