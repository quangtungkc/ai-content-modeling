# Database Design — PostgreSQL + Prisma

## 1. Entity relationship

```text
User 1──N Channel 1──N Competitor 1──N SourceVideo 1──N MetricSnapshot
Channel 1──N DailyReport 1──N ReportItem ──1 SourceVideo
SourceVideo 1──N SourceAnalysis 1──N ModelingIdea 1──0..1 ContentProject
ContentProject 1──N StoryboardScene N──N Asset
Asset 1──N AssetValidation
StoryboardScene 1──N VideoGeneration
```

## 2. Bảng chính

### User

`id`, `email`, `name`, `createdAt`, `updatedAt`.

### Channel

`id`, `userId`, `name`, `platform`, `topic`, `subTopic`, `targetMarket`, `language`, `audience`, `contentStyle`, `visualStyle`, `videoDurationSec`, `creativeInstructions`, `mustKeep`, `mustAvoid`, `timezone`, `status`, timestamps.

Index: `(userId, status)`.

### Competitor

`id`, `channelId`, `platform`, `url`, `normalizedUrl`, `displayName`, `status`, `lastSyncedAt`, `syncError`, timestamps.

Unique: `(channelId, normalizedUrl)`. Enforce 10–50 active competitors at product/service layer.

### SourceVideo

`id`, `competitorId`, `externalId`, `url`, `title`, `caption`, `thumbnailUrl`, `publishedAt`, `durationSec`, `firstSeenAt`, `lastSeenAt`, timestamps.

Unique: `(competitorId, externalId)`; fallback dedupe by normalized URL.

### MetricSnapshot

`id`, `sourceVideoId`, `capturedAt`, `views`, `likes`, `comments`, `shares`, `rawMetrics` JSONB.

Unique: `(sourceVideoId, capturedAt)`; index `(sourceVideoId, capturedAt DESC)`.

### CompetitorBaseline

`id`, `competitorId`, `windowDays`, `sampleSize`, `viewsP50`, `viewsP75`, `viewsP90`, `engagementRate`, `calculatedAt`.

### DailyReport / ReportItem

DailyReport: `id`, `channelId`, `localDate`, `periodStart`, `periodEnd`, `timezone`, `status`, `generatedAt`.

ReportItem: `id`, `reportId`, `sourceVideoId`, `viralScore`, `relativePerformance`, `analysisSummary`, `modelingMechanism`, `rank`.

Unique report: `(channelId, localDate)`.

### SourceAnalysis / ModelingIdea

SourceAnalysis lưu `summary`, `hook`, `setup`, `conflict`, `escalation`, `twist`, `payoff`, `visualGag`, `cameraPattern`, `editingRhythm`, `characterInteractions`, `soundPattern`, `retentionMechanism`, `whyItWorks`, `rawOutput`, `provider`, `version`.

ModelingIdea lưu `sourceVideoId`, `analysisId`, `title`, `coreConcept`, `sourceMechanism`, `preserved`, `changed`, `marketAdaptation`, `similarityRisk`, `worthDeveloping`, `status` (`draft/approved/rejected`), timestamps.

### ContentProject / StoryboardScene

ContentProject lưu `channelId`, `ideaId`, `status`, `deconstruction` JSONB, `artDirection` JSONB, `characterDesign` JSONB, `backgroundDesign` JSONB, `safetyReview` JSONB, `createdBy`, timestamps.

StoryboardScene lưu `projectId`, `sceneNumber`, `visualBlock`, `actionBlock`, `audioBlock`, `englishPrompt`, `promptProvider`, `status`.

### Asset / AssetValidation / SceneAsset

Asset: `id`, `projectId`, `type`, `name`, `storageKey`, `mimeType`, `checksum`, `metadata`, `status`.

AssetValidation: `id`, `assetId`, `result`, `issues` JSONB, `provider`, `version`, timestamps.

SceneAsset: composite key `(sceneId, assetId)`.

### VideoGeneration

`id`, `sceneId`, `provider`, `version`, `promptSnapshot`, `assetSnapshot`, `externalJobId`, `status`, `previewUrl`, `error`, `createdBy`, timestamps.

Unique: `(sceneId, version)`.

## 3. Dữ liệu bất biến

Metric snapshots, AI output versions, prompt snapshots và video generations không update destructively. Khi thay đổi, tạo bản ghi/version mới.

## 4. Prisma notes

- Dùng `String @id @default(cuid())` hoặc UUID nhất quán.
- Tiền tệ không cần trong MVP.
- JSONB chỉ dùng cho output provider và metadata biến động; entity cần query phải là cột riêng.
- Soft delete bằng `status` cho Channel, Competitor, Asset; không xóa cascade dữ liệu phân tích.
