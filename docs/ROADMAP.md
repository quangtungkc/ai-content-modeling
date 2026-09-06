# Roadmap MVP

## Phase 0 — Foundation

- Chốt platform đầu tiên và nguồn dữ liệu hợp lệ.
- Khởi tạo Next.js, TypeScript, Prisma, PostgreSQL, Redis queue.
- Auth, user isolation, Channel CRUD và timezone.

## Phase 1 — Monitoring value

- Competitor URL onboarding.
- Platform adapter đầu tiên.
- Source video ingestion, metric snapshots và baseline.
- Viral score có breakdown và low-confidence state.

## Phase 2 — Daily insight

- 06:00 scheduler theo timezone.
- Daily report 24 giờ, dedupe/idempotency.
- Video detail, timeline và source traceability.

## Phase 3 — Modeling workflow

- Source analysis schema.
- 3–5 modeling ideas.
- Idea approval gate.
- Content project: deconstruction, art direction, character, background, storyboard, safety và English prompts.

## Phase 4 — Human assets và review

- Asset workspace, upload, mapping.
- Asset validation và approve/replace/approve anyway.
- Gemini review/enhancement tùy chọn, versioned apply.

## Phase 5 — Scene generation

- Prompt compiler.
- Veo provider.
- Scene generation, preview, approve, regenerate và version history.

## Sau MVP

- Thêm platform adapters.
- Cải thiện baseline theo niche và tuổi video.
- Team collaboration, billing, export và analytics.
- Provider khác cho AI/video.

## Definition of Done MVP

- Có một vertical slice hoàn chỉnh từ competitor URL đến approved scene preview.
- Dữ liệu của Channel không lẫn nhau.
- Mọi output AI và generation có version/schema.
- Các approval gate được kiểm tra server-side.
- Worker retry an toàn và không tạo duplicate report/snapshot/generation.
- Có kiểm thử authorization, idempotency, score và timezone report.
