import { db } from "@/lib/db";

let ready: Promise<void> | null = null;

// Packaged desktop installations keep an existing SQLite file between updates.
// These idempotent statements make the feature migration-safe without touching
// any existing business table or requiring a destructive database reset.
export function ensureCodexStorage() {
  if (!ready) ready = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS "CodexJob" ("id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "channelId" TEXT NOT NULL, "sourceVideoId" TEXT NOT NULL, "contentProjectId" TEXT, "automationRunId" TEXT, "idempotencyKey" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "previousResponseId" TEXT, "status" TEXT NOT NULL DEFAULT 'PLANNING', "currentStage" TEXT NOT NULL DEFAULT 'PLAN', "currentAction" TEXT, "retryCount" INTEGER NOT NULL DEFAULT 0, "checkpoint" JSONB NOT NULL DEFAULT '{}', "finalVideoId" TEXT, "finalVideoPath" TEXT, "finalVideoUrl" TEXT, "failureReason" TEXT, "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "completedAt" DATETIME)`,
      `CREATE TABLE IF NOT EXISTS "CodexStageState" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "stage" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "expectedState" JSONB, "actualState" JSONB, "validationResult" TEXT, "validationIssues" JSONB, "retryCount" INTEGER NOT NULL DEFAULT 0, "maxRetries" INTEGER NOT NULL DEFAULT 3, "lastErrorSignature" TEXT, "lastStrategy" TEXT, "startedAt" DATETIME, "completedAt" DATETIME, "updatedAt" DATETIME NOT NULL, CONSTRAINT "CodexStageState_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "CodexEvent" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT NOT NULL, "sequence" INTEGER NOT NULL, "type" TEXT NOT NULL, "stage" TEXT, "level" TEXT NOT NULL DEFAULT 'INFO', "payload" JSONB NOT NULL DEFAULT '{}', "reasoningSummary" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "CodexEvent_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "AgentExperience" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT, "stage" TEXT NOT NULL, "provider" TEXT, "errorSignature" TEXT NOT NULL, "errorMessage" TEXT, "expectedState" JSONB, "actualState" JSONB, "rootCause" TEXT, "attemptedFix" TEXT, "successfulFix" TEXT, "result" TEXT NOT NULL, "occurrenceCount" INTEGER NOT NULL DEFAULT 1, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AgentExperience_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
      `CREATE TABLE IF NOT EXISTS "AppImprovementCandidate" ("id" TEXT NOT NULL PRIMARY KEY, "jobId" TEXT, "title" TEXT NOT NULL, "category" TEXT NOT NULL, "affectedModule" TEXT NOT NULL, "evidence" JSONB NOT NULL, "relatedJobs" JSONB NOT NULL DEFAULT '[]', "occurrenceCount" INTEGER NOT NULL DEFAULT 1, "rootCause" TEXT NOT NULL, "currentBehavior" TEXT NOT NULL, "desiredBehavior" TEXT NOT NULL, "proposedFix" TEXT NOT NULL, "externalReferences" JSONB NOT NULL DEFAULT '[]', "alternativeSolutions" JSONB NOT NULL DEFAULT '[]', "riskLevel" TEXT NOT NULL, "expectedBenefit" TEXT NOT NULL, "requiredTests" JSONB NOT NULL DEFAULT '[]', "migrationImpact" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PROPOSED', "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, CONSTRAINT "AppImprovementCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "CodexJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "CodexJob_idempotencyKey_key" ON "CodexJob"("idempotencyKey")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "CodexJob_sessionId_key" ON "CodexJob"("sessionId")`,
      `CREATE INDEX IF NOT EXISTS "CodexJob_userId_startedAt_idx" ON "CodexJob"("userId", "startedAt" DESC)`,
      `CREATE INDEX IF NOT EXISTS "CodexJob_status_updatedAt_idx" ON "CodexJob"("status", "updatedAt")`,
      `CREATE INDEX IF NOT EXISTS "CodexJob_sourceVideoId_status_idx" ON "CodexJob"("sourceVideoId", "status")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "CodexStageState_jobId_stage_key" ON "CodexStageState"("jobId", "stage")`,
      `CREATE INDEX IF NOT EXISTS "CodexStageState_jobId_status_idx" ON "CodexStageState"("jobId", "status")`,
      `CREATE UNIQUE INDEX IF NOT EXISTS "CodexEvent_jobId_sequence_key" ON "CodexEvent"("jobId", "sequence")`,
      `CREATE INDEX IF NOT EXISTS "CodexEvent_jobId_createdAt_idx" ON "CodexEvent"("jobId", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "CodexEvent_type_createdAt_idx" ON "CodexEvent"("type", "createdAt")`,
      `CREATE INDEX IF NOT EXISTS "AgentExperience_stage_provider_errorSignature_idx" ON "AgentExperience"("stage", "provider", "errorSignature")`,
      `CREATE INDEX IF NOT EXISTS "AgentExperience_result_lastSeenAt_idx" ON "AgentExperience"("result", "lastSeenAt")`,
      `CREATE INDEX IF NOT EXISTS "AppImprovementCandidate_status_createdAt_idx" ON "AppImprovementCandidate"("status", "createdAt" DESC)`,
      `CREATE INDEX IF NOT EXISTS "AppImprovementCandidate_affectedModule_category_idx" ON "AppImprovementCandidate"("affectedModule", "category")`,
    ];
    for (const statement of statements) await db.$executeRawUnsafe(statement);
  })();
  return ready;
}
