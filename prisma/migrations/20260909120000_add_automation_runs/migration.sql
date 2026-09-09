-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "ideaId" TEXT,
    "projectId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "settings" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "error" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "completedAt" DATETIME,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AutomationRun_userId_startedAt_idx" ON "AutomationRun"("userId", "startedAt" DESC);
