-- CreateEnum
CREATE TYPE "RecordStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "IdeaStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('UPLOADED', 'APPROVED', 'NEEDS_REVISION', 'APPROVED_ANYWAY');

-- CreateEnum
CREATE TYPE "ValidationResult" AS ENUM ('APPROVED', 'NEEDS_REVISION');

-- CreateEnum
CREATE TYPE "GenerationStatus" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'APPROVED');

-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DailyReportStatus" AS ENUM ('PREPARING', 'READY', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "UsageMetric" AS ENUM ('AI_CALL', 'AI_INPUT_TOKENS', 'AI_OUTPUT_TOKENS', 'GEMINI_VIDEO_ANALYSIS', 'VEO_GENERATION', 'STORAGE_BYTES', 'COMPETITOR_REQUEST');

-- CreateEnum
CREATE TYPE "SceneVersionStatus" AS ENUM ('GENERATING', 'READY', 'APPROVED', 'FAILED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('PENDING', 'APPLIED', 'IGNORED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AIConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "label" TEXT,
    "encryptedKey" TEXT NOT NULL,
    "keyLast4" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "AIConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "subTopic" TEXT,
    "targetCountry" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "contentStyle" TEXT NOT NULL,
    "visualStyle" TEXT NOT NULL,
    "videoDurationSec" INTEGER,
    "hasDialogue" BOOLEAN NOT NULL DEFAULT false,
    "creativeInstructions" TEXT,
    "mustKeep" TEXT[],
    "mustAvoid" TEXT[],
    "timezone" TEXT NOT NULL,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Competitor" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "normalizedUrl" TEXT NOT NULL,
    "displayName" TEXT,
    "avatar" TEXT,
    "status" "RecordStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Competitor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorVideo" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "thumbnailUrl" TEXT,
    "publishedAt" TIMESTAMP(3),
    "duration" INTEGER,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorVideo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoMetricSnapshot" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "rawMetrics" JSONB,

    CONSTRAINT "VideoMetricSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompetitorBaseline" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "sampleSize" INTEGER NOT NULL,
    "viewsP50" DOUBLE PRECISION NOT NULL,
    "viewsP75" DOUBLE PRECISION NOT NULL,
    "viewsP90" DOUBLE PRECISION NOT NULL,
    "engagementRate" DOUBLE PRECISION NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompetitorBaseline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "localDate" TIMESTAMP(3) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "timezone" TEXT NOT NULL,
    "status" "DailyReportStatus" NOT NULL DEFAULT 'PREPARING',
    "generatedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InAppNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "viralScore" DOUBLE PRECISION NOT NULL,
    "relativePerformance" DOUBLE PRECISION NOT NULL,
    "analysisSummary" TEXT,
    "modelingMechanism" TEXT,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "ReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceAnalysis" (
    "id" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "schemaVersion" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "rawOutput" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ModelingIdea" (
    "id" TEXT NOT NULL,
    "sourceVideoId" TEXT NOT NULL,
    "analysisId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "status" "IdeaStatus" NOT NULL DEFAULT 'DRAFT',
    "saved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ModelingIdea_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentProject" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "ideaId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "deconstruction" JSONB,
    "artDirection" JSONB,
    "characterDesign" JSONB,
    "backgroundDesign" JSONB,
    "storyboard" JSONB,
    "safetyReview" JSONB,
    "productionPrompts" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageEvent" (
    "idempotencyKey" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "projectId" TEXT,
    "metric" "UsageMetric" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "bytes" BIGINT,
    "usageDate" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsageEvent_pkey" PRIMARY KEY ("idempotencyKey")
);

-- CreateTable
CREATE TABLE "ProjectReview" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'PENDING',
    "issues" JSONB NOT NULL,
    "originalSnapshot" JSONB NOT NULL,
    "decisionNote" TEXT,
    "selectedIssueIds" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryboardScene" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "visualBlock" TEXT NOT NULL,
    "actionBlock" TEXT NOT NULL,
    "audioBlock" TEXT NOT NULL,
    "englishPrompt" TEXT,
    "promptProvider" TEXT,
    "status" TEXT NOT NULL,

    CONSTRAINT "StoryboardScene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "characterId" TEXT,
    "backgroundId" TEXT,
    "sceneIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "metadata" JSONB,
    "status" "AssetStatus" NOT NULL DEFAULT 'UPLOADED',

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssetValidation" (
    "id" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "result" "ValidationResult" NOT NULL,
    "issues" JSONB,
    "provider" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssetValidation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneAsset" (
    "sceneId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,

    CONSTRAINT "SceneAsset_pkey" PRIMARY KEY ("sceneId","assetId")
);

-- CreateTable
CREATE TABLE "VideoGeneration" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "promptSnapshot" TEXT NOT NULL,
    "assetSnapshot" JSONB NOT NULL,
    "externalJobId" TEXT,
    "status" "GenerationStatus" NOT NULL DEFAULT 'QUEUED',
    "previewUrl" TEXT,
    "error" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoGeneration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VideoGenerationJob" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'QUEUED',
    "externalOperationId" TEXT,
    "prompt" TEXT NOT NULL,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VideoGenerationJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneGenerationVersion" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "generationJobId" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "SceneVersionStatus" NOT NULL DEFAULT 'GENERATING',
    "previewUrl" TEXT,
    "matchScore" INTEGER,
    "storyboardMatch" INTEGER,
    "characterMatch" INTEGER,
    "backgroundMatch" INTEGER,
    "actionMatch" INTEGER,
    "cameraMatch" INTEGER,
    "reviewNotes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "SceneGenerationVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_expiresAt_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "AIConnection_userId_revokedAt_idx" ON "AIConnection"("userId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AIConnection_userId_provider_kind_key" ON "AIConnection"("userId", "provider", "kind");

-- CreateIndex
CREATE INDEX "Channel_userId_status_idx" ON "Channel"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Competitor_channelId_normalizedUrl_key" ON "Competitor"("channelId", "normalizedUrl");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorVideo_competitorId_externalId_key" ON "CompetitorVideo"("competitorId", "externalId");

-- CreateIndex
CREATE INDEX "VideoMetricSnapshot_videoId_capturedAt_idx" ON "VideoMetricSnapshot"("videoId", "capturedAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "VideoMetricSnapshot_videoId_capturedAt_key" ON "VideoMetricSnapshot"("videoId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CompetitorBaseline_competitorId_windowDays_calculatedAt_key" ON "CompetitorBaseline"("competitorId", "windowDays", "calculatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_channelId_localDate_key" ON "DailyReport"("channelId", "localDate");

-- CreateIndex
CREATE INDEX "InAppNotification_userId_readAt_createdAt_idx" ON "InAppNotification"("userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ReportItem_reportId_sourceVideoId_key" ON "ReportItem"("reportId", "sourceVideoId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceAnalysis_sourceVideoId_version_key" ON "SourceAnalysis"("sourceVideoId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ContentProject_ideaId_key" ON "ContentProject"("ideaId");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_usageDate_idx" ON "UsageEvent"("userId", "usageDate");

-- CreateIndex
CREATE INDEX "UsageEvent_userId_metric_usageDate_idx" ON "UsageEvent"("userId", "metric", "usageDate");

-- CreateIndex
CREATE INDEX "UsageEvent_channelId_usageDate_idx" ON "UsageEvent"("channelId", "usageDate");

-- CreateIndex
CREATE INDEX "UsageEvent_projectId_usageDate_idx" ON "UsageEvent"("projectId", "usageDate");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectReview_projectId_version_key" ON "ProjectReview"("projectId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "StoryboardScene_projectId_sceneNumber_key" ON "StoryboardScene"("projectId", "sceneNumber");

-- CreateIndex
CREATE INDEX "Asset_projectId_type_status_idx" ON "Asset"("projectId", "type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_projectId_name_version_key" ON "Asset"("projectId", "name", "version");

-- CreateIndex
CREATE UNIQUE INDEX "AssetValidation_assetId_version_key" ON "AssetValidation"("assetId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "VideoGeneration_sceneId_version_key" ON "VideoGeneration"("sceneId", "version");

-- CreateIndex
CREATE INDEX "VideoGenerationJob_sceneId_createdAt_idx" ON "VideoGenerationJob"("sceneId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "VideoGenerationJob_status_createdAt_idx" ON "VideoGenerationJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SceneGenerationVersion_generationJobId_key" ON "SceneGenerationVersion"("generationJobId");

-- CreateIndex
CREATE INDEX "SceneGenerationVersion_sceneId_createdAt_idx" ON "SceneGenerationVersion"("sceneId", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "SceneGenerationVersion_sceneId_version_key" ON "SceneGenerationVersion"("sceneId", "version");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AIConnection" ADD CONSTRAINT "AIConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Competitor" ADD CONSTRAINT "Competitor_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorVideo" ADD CONSTRAINT "CompetitorVideo_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoMetricSnapshot" ADD CONSTRAINT "VideoMetricSnapshot_videoId_fkey" FOREIGN KEY ("videoId") REFERENCES "CompetitorVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompetitorBaseline" ADD CONSTRAINT "CompetitorBaseline_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "Competitor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItem" ADD CONSTRAINT "ReportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItem" ADD CONSTRAINT "ReportItem_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "CompetitorVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceAnalysis" ADD CONSTRAINT "SourceAnalysis_sourceVideoId_fkey" FOREIGN KEY ("sourceVideoId") REFERENCES "CompetitorVideo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModelingIdea" ADD CONSTRAINT "ModelingIdea_analysisId_fkey" FOREIGN KEY ("analysisId") REFERENCES "SourceAnalysis"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProject" ADD CONSTRAINT "ContentProject_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentProject" ADD CONSTRAINT "ContentProject_ideaId_fkey" FOREIGN KEY ("ideaId") REFERENCES "ModelingIdea"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageEvent" ADD CONSTRAINT "UsageEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ContentProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectReview" ADD CONSTRAINT "ProjectReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ContentProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryboardScene" ADD CONSTRAINT "StoryboardScene_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ContentProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "ContentProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AssetValidation" ADD CONSTRAINT "AssetValidation_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneAsset" ADD CONSTRAINT "SceneAsset_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryboardScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneAsset" ADD CONSTRAINT "SceneAsset_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoGeneration" ADD CONSTRAINT "VideoGeneration_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryboardScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VideoGenerationJob" ADD CONSTRAINT "VideoGenerationJob_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryboardScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneGenerationVersion" ADD CONSTRAINT "SceneGenerationVersion_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "StoryboardScene"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneGenerationVersion" ADD CONSTRAINT "SceneGenerationVersion_generationJobId_fkey" FOREIGN KEY ("generationJobId") REFERENCES "VideoGenerationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
