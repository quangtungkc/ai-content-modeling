-- Persist every interruption so Codex can diagnose it even when the original request is gone.
CREATE TABLE "RuntimeFailure" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "codexJobId" TEXT,
    "backgroundJobId" TEXT,
    "source" TEXT NOT NULL,
    "stage" TEXT,
    "failureKind" TEXT NOT NULL DEFAULT 'TECHNICAL_FAILURE',
    "code" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "codexResponseId" TEXT,
    "lastAttemptAt" DATETIME,
    "resolvedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RuntimeFailure_codexJobId_fkey" FOREIGN KEY ("codexJobId") REFERENCES "CodexJob" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "RuntimeFailure_status_createdAt_idx" ON "RuntimeFailure"("status", "createdAt");
CREATE INDEX "RuntimeFailure_userId_createdAt_idx" ON "RuntimeFailure"("userId", "createdAt");
CREATE INDEX "RuntimeFailure_codexJobId_createdAt_idx" ON "RuntimeFailure"("codexJobId", "createdAt");
CREATE INDEX "RuntimeFailure_backgroundJobId_createdAt_idx" ON "RuntimeFailure"("backgroundJobId", "createdAt");
