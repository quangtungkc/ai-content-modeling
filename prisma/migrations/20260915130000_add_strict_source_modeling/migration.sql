ALTER TABLE "ContentProject" ADD COLUMN "sourceVideoId" TEXT;
ALTER TABLE "ContentProject" ADD COLUMN "sourceVideoUrl" TEXT;
ALTER TABLE "ContentProject" ADD COLUMN "sourceVideoMetadata" JSONB;
ALTER TABLE "ContentProject" ADD COLUMN "sourceDuration" INTEGER;
ALTER TABLE "ContentProject" ADD COLUMN "sourcePlatform" TEXT;
ALTER TABLE "ContentProject" ADD COLUMN "modelingPolicy" TEXT NOT NULL DEFAULT 'STRICT_MODELING';
ALTER TABLE "ContentProject" ADD COLUMN "modelingFidelityTarget" REAL NOT NULL DEFAULT 0.9;
ALTER TABLE "ContentProject" ADD COLUMN "sourceModelingSpecVersion" TEXT;
ALTER TABLE "ContentProject" ADD COLUMN "sourceModelingSpec" JSONB;
ALTER TABLE "ContentProject" ADD COLUMN "sourceSpecCreatedAt" DATETIME;

ALTER TABLE "StoryboardScene" ADD COLUMN "sourceSceneId" TEXT;
ALTER TABLE "StoryboardScene" ADD COLUMN "sourceSceneOrder" INTEGER;
ALTER TABLE "StoryboardScene" ADD COLUMN "sourceSceneStartTime" REAL;
ALTER TABLE "StoryboardScene" ADD COLUMN "sourceSceneEndTime" REAL;
ALTER TABLE "StoryboardScene" ADD COLUMN "sourceDuration" REAL;
ALTER TABLE "StoryboardScene" ADD COLUMN "targetDuration" REAL;
ALTER TABLE "StoryboardScene" ADD COLUMN "durationDelta" REAL;
ALTER TABLE "StoryboardScene" ADD COLUMN "durationRatio" REAL;
ALTER TABLE "StoryboardScene" ADD COLUMN "timingStatus" TEXT;
ALTER TABLE "StoryboardScene" ADD COLUMN "cameraSpec" JSONB;
ALTER TABLE "StoryboardScene" ADD COLUMN "actionSequence" JSONB;
ALTER TABLE "StoryboardScene" ADD COLUMN "spatialSpec" JSONB;
ALTER TABLE "StoryboardScene" ADD COLUMN "mustPreserve" JSONB;
ALTER TABLE "StoryboardScene" ADD COLUMN "allowedTransformations" JSONB;

CREATE INDEX "ContentProject_sourceVideoId_idx" ON "ContentProject"("sourceVideoId");
CREATE INDEX "StoryboardScene_sourceSceneId_idx" ON "StoryboardScene"("sourceSceneId");
