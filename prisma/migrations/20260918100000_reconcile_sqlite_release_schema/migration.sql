-- SQLite-only forward reconciliation for the desktop release schema.
-- The historical prisma/migrations tree was created for PostgreSQL and is not
-- executed by the packaged desktop runtime. ensureLocalDatabaseSchema uses the
-- same idempotent end-state before starting the server and worker.

ALTER TABLE "AutomationRun" ADD COLUMN "channelId" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN "modelingIdeaId" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN "lastCompletedStage" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutomationRun" ADD COLUMN "failedStage" INTEGER;
ALTER TABLE "AutomationRun" ADD COLUMN "resumeTarget" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN "failureFingerprint" TEXT;
ALTER TABLE "AutomationRun" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AutomationRun" ADD COLUMN "incidentHistory" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "AutomationRun" ADD COLUMN "checkpoint" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "AutomationRun" ADD COLUMN "sourceModelingSpecVersion" TEXT;

PRAGMA foreign_keys=OFF;

CREATE TABLE "new_CompetitorVideo" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "competitorId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "title" TEXT,
  "caption" TEXT,
  "thumbnailUrl" TEXT,
  "publishedAt" DATETIME,
  "duration" REAL,
  "firstSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CompetitorVideo_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_CompetitorVideo" ("id","competitorId","externalId","url","title","caption","thumbnailUrl","publishedAt","duration","firstSeenAt","lastSeenAt")
SELECT "id","competitorId","externalId","url","title","caption","thumbnailUrl","publishedAt","duration","firstSeenAt","lastSeenAt" FROM "CompetitorVideo";
DROP TABLE "CompetitorVideo";
ALTER TABLE "new_CompetitorVideo" RENAME TO "CompetitorVideo";
CREATE UNIQUE INDEX "CompetitorVideo_competitorId_externalId_key" ON "CompetitorVideo"("competitorId","externalId");

CREATE TABLE "new_ContentProject" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "channelId" TEXT NOT NULL,
  "ideaId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "sourceVideoId" TEXT,
  "sourceVideoUrl" TEXT,
  "sourceVideoMetadata" JSONB,
  "sourceDuration" REAL,
  "sourcePlatform" TEXT,
  "modelingPolicy" TEXT NOT NULL DEFAULT 'STRICT_MODELING',
  "modelingFidelityTarget" REAL NOT NULL DEFAULT 0.9,
  "sourceModelingSpecVersion" TEXT,
  "sourceModelingSpec" JSONB,
  "sourceSpecCreatedAt" DATETIME,
  "deconstruction" JSONB,
  "artDirection" JSONB,
  "characterDesign" JSONB,
  "backgroundDesign" JSONB,
  "storyboard" JSONB,
  "safetyReview" JSONB,
  "productionPrompts" JSONB,
  "createdBy" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "ContentProject_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ContentProject_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ModelingIdea" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_ContentProject" ("id","channelId","ideaId","status","sourceVideoId","sourceVideoUrl","sourceVideoMetadata","sourceDuration","sourcePlatform","modelingPolicy","modelingFidelityTarget","sourceModelingSpecVersion","sourceModelingSpec","sourceSpecCreatedAt","deconstruction","artDirection","characterDesign","backgroundDesign","storyboard","safetyReview","productionPrompts","createdBy","createdAt","updatedAt")
SELECT "id","channelId","ideaId","status","sourceVideoId","sourceVideoUrl","sourceVideoMetadata","sourceDuration","sourcePlatform","modelingPolicy","modelingFidelityTarget","sourceModelingSpecVersion","sourceModelingSpec","sourceSpecCreatedAt","deconstruction","artDirection","characterDesign","backgroundDesign","storyboard","safetyReview","productionPrompts","createdBy","createdAt","updatedAt" FROM "ContentProject";
DROP TABLE "ContentProject";
ALTER TABLE "new_ContentProject" RENAME TO "ContentProject";
CREATE UNIQUE INDEX "ContentProject_ideaId_key" ON "ContentProject"("ideaId");

PRAGMA foreign_keys=ON;
