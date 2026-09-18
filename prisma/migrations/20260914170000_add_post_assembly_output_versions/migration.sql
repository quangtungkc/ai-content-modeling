CREATE TABLE "PostAssemblyOutputVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdFromVersionId" TEXT,
    "createdByRepairIncidentId" TEXT,
    "repairRuleId" TEXT,
    "validationStatus" TEXT NOT NULL,
    "promotedAt" DATETIME,
    "rejectedAt" DATETIME,
    "rollbackReason" TEXT
);

CREATE TABLE "PostAssemblyOutputVersionAudit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "outputVersionId" TEXT,
    "event" TEXT NOT NULL,
    "previousCurrentVersionId" TEXT,
    "newCurrentVersionId" TEXT,
    "reason" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "PostAssemblyOutputVersion_projectId_versionNumber_key" ON "PostAssemblyOutputVersion"("projectId", "versionNumber");
CREATE UNIQUE INDEX "PostAssemblyOutputVersion_one_current_per_project" ON "PostAssemblyOutputVersion"("projectId") WHERE "status" = 'CURRENT';
CREATE INDEX "PostAssemblyOutputVersion_projectId_status_idx" ON "PostAssemblyOutputVersion"("projectId", "status");
CREATE INDEX "PostAssemblyOutputVersion_projectId_fileHash_idx" ON "PostAssemblyOutputVersion"("projectId", "fileHash");
CREATE INDEX "PostAssemblyOutputVersionAudit_projectId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("projectId", "createdAt");
CREATE INDEX "PostAssemblyOutputVersionAudit_outputVersionId_createdAt_idx" ON "PostAssemblyOutputVersionAudit"("outputVersionId", "createdAt");
