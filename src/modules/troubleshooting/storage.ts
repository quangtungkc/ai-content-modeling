import { db } from "@/lib/db";

let ready: Promise<void> | null = null;

// Desktop users keep their SQLite database through app upgrades. Keep this
// idempotent bridge local to the Knowledge Base; it is not invoked by runtime
// recovery or the generation pipeline in this task.
export function ensureTroubleshootingStorage() {
  if (!ready) ready = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "TroubleshootingKnowledgeBase" ("key" TEXT NOT NULL PRIMARY KEY, "version" TEXT NOT NULL, "description" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS "TroubleshootingRule" ("issueId" TEXT NOT NULL PRIMARY KEY, "knowledgeBaseKey" TEXT NOT NULL, "title" TEXT NOT NULL, "stage" TEXT NOT NULL, "firstDivergence" TEXT, "repairScope" TEXT NOT NULL, "autoRepairAllowed" BOOLEAN NOT NULL DEFAULT false, "severity" TEXT NOT NULL, "version" TEXT NOT NULL, "verificationStatus" TEXT NOT NULL, "automationClass" TEXT NOT NULL DEFAULT 'NO_HANDLER_YET', "tags" JSONB NOT NULL DEFAULT '[]', "document" JSONB NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "TroubleshootingRule_knowledgeBaseKey_fkey" FOREIGN KEY ("knowledgeBaseKey") REFERENCES "TroubleshootingKnowledgeBase" ("key") ON DELETE CASCADE ON UPDATE CASCADE)`,
      `ALTER TABLE "TroubleshootingRule" ADD COLUMN "automationClass" TEXT NOT NULL DEFAULT 'NO_HANDLER_YET'`,
      `CREATE INDEX IF NOT EXISTS "TroubleshootingRule_knowledgeBaseKey_verificationStatus_idx" ON "TroubleshootingRule"("knowledgeBaseKey", "verificationStatus")`,
      `CREATE INDEX IF NOT EXISTS "TroubleshootingRule_stage_repairScope_idx" ON "TroubleshootingRule"("stage", "repairScope")`,
      `CREATE TABLE IF NOT EXISTS "TroubleshootingIncident" ("id" TEXT NOT NULL PRIMARY KEY, "fingerprint" TEXT NOT NULL, "projectId" TEXT, "sceneNumber" INTEGER, "stage" TEXT NOT NULL, "component" TEXT NOT NULL, "status" TEXT NOT NULL, "document" JSONB NOT NULL, "checkpoint" JSONB NOT NULL DEFAULT '{}', "attemptCount" INTEGER NOT NULL DEFAULT 0, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS "TroubleshootingIncidentAudit" ("id" TEXT NOT NULL PRIMARY KEY, "incidentId" TEXT NOT NULL, "type" TEXT NOT NULL, "payload" JSONB NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "TroubleshootingIncidentAudit_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "TroubleshootingIncident" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
      `CREATE INDEX IF NOT EXISTS "TroubleshootingIncident_fingerprint_updatedAt_idx" ON "TroubleshootingIncident"("fingerprint", "updatedAt")`,
      `CREATE INDEX IF NOT EXISTS "TroubleshootingIncident_projectId_stage_updatedAt_idx" ON "TroubleshootingIncident"("projectId", "stage", "updatedAt")`,
      `CREATE INDEX IF NOT EXISTS "TroubleshootingIncidentAudit_incidentId_createdAt_idx" ON "TroubleshootingIncidentAudit"("incidentId", "createdAt")`,
    ];
    for (const statement of statements) {
      try { await db.$executeRawUnsafe(statement); } catch (error) {
        if (!/duplicate column name: automationClass/i.test(error instanceof Error ? error.message : "")) throw error;
      }
    }
  })();
  return ready;
}
