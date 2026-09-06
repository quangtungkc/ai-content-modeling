# Kiến trúc MVP

## 1. Nguyên tắc

MVP dùng một Next.js application, một PostgreSQL database và một Redis-backed worker. Tách module bằng boundary rõ ràng trước khi nghĩ đến microservices.

## 2. Thành phần

```text
Browser
  │
  ▼
Next.js App Router ── Prisma ── PostgreSQL
  │                         
  ├── AI Provider Registry ── Primary AI / Gemini
  ├── Video Provider Registry ── Veo
  └── Queue Producer ── Redis ── Worker
                              ├── competitor sync
                              ├── metric snapshots
                              ├── report generation
                              └── AI/video jobs
```

## 3. Module boundaries

- `auth`: session, user isolation.
- `channels`: channel configuration and timezone.
- `competitors`: URL validation, platform adapters, sync state.
- `monitoring`: source videos and immutable metric snapshots.
- `viral`: baseline calculation and score explanation.
- `reports`: daily report period, items and generation status.
- `content`: analysis, modeling ideas, approval and projects.
- `assets`: uploads, validation and scene mapping.
- `generation`: prompt compilation, provider calls and versioning.
- `providers`: interfaces plus provider implementations.
- `jobs`: idempotent queue handlers.

## 4. Runtime flow

1. API ghi thay đổi và enqueue job có idempotency key.
2. Worker gọi platform adapter, chuẩn hóa dữ liệu và ghi snapshot.
3. Viral service tính baseline và score.
4. Report job chốt cửa sổ 24 giờ theo timezone của Channel.
5. User mở source video, yêu cầu analysis, rồi nhận modeling ideas.
6. Develop chỉ chạy khi idea được approved.
7. Asset validation và video generation là các job riêng, có retry và version.

## 5. Provider interfaces

```ts
interface AIProvider {
  analyzeSource(input: SourceAnalysisInput): Promise<StructuredAnalysis>;
  developProject(input: DevelopmentInput): Promise<ContentPackage>;
  review(input: ReviewInput): Promise<ReviewResult>;
  validateAsset(input: AssetValidationInput): Promise<AssetValidationResult>;
}

interface VideoGenerationProvider {
  generateScene(input: SceneGenerationInput): Promise<GenerationResult>;
}
```

Provider không nhận secret từ client. Adapter platform và provider phải trả normalized result cùng metadata, latency, usage và lỗi chuẩn hóa.

## 6. MVP reliability

- Job có trạng thái `queued/running/succeeded/failed`.
- Retry exponential backoff; lỗi không retry được phải đưa vào dead-letter state.
- Unique constraint và idempotency key chống tạo trùng snapshot, report hoặc generation.
- Mọi external call có timeout và audit log.
