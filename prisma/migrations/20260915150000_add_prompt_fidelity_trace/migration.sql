CREATE TABLE "PromptFidelityTrace" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "projectId" TEXT NOT NULL,
  "sceneId" TEXT,
  "sourceSceneId" TEXT,
  "promptType" TEXT NOT NULL,
  "sourceSpecVersion" TEXT NOT NULL,
  "expectedStateVersion" TEXT NOT NULL,
  "characterIdentityPackVersion" TEXT NOT NULL,
  "geminiDraftPrompt" TEXT NOT NULL,
  "validatedPrompt" TEXT NOT NULL,
  "validationResults" JSONB NOT NULL,
  "validationEvidence" JSONB NOT NULL,
  "promptHash" TEXT NOT NULL,
  "actualSentPromptHash" TEXT,
  "validatedAt" DATETIME NOT NULL,
  "sentAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

CREATE INDEX "PromptFidelityTrace_projectId_sceneId_promptType_createdAt_idx" ON "PromptFidelityTrace"("projectId", "sceneId", "promptType", "createdAt");
CREATE INDEX "PromptFidelityTrace_projectId_promptHash_idx" ON "PromptFidelityTrace"("projectId", "promptHash");
