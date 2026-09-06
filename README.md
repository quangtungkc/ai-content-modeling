# AI Content Modeling

Codebase foundation cho MVP SaaS AI Content Modeling, bám theo đặc tả trong [`docs/`](./docs/).

## Trạng thái hiện tại

Đã có:

- Next.js App Router, TypeScript strict và Tailwind CSS.
- Prisma schema cho User, Channel, Competitor, CompetitorVideo, VideoMetricSnapshot, reports, AI content, assets và video generations.
- PostgreSQL client singleton.
- Environment validation bằng Zod.
- JSON logging và error response chuẩn hóa có `requestId`.
- Authentication abstraction, service/repository boundary, Redis job abstraction và AI provider abstraction.
- Platform adapter abstraction với TikTok provider đầu tiên và registry định tuyến theo hostname.
- `GET /api/health` kiểm tra kết nối database.
- API CRUD thật cho Channel tại `/api/v1/channels` với user isolation và soft delete.
- API Competitor theo Channel tại `/api/v1/channels/:channelId/competitors`, có normalize, duplicate constraint, status và soft delete.
- Video metric timeline API tại `/api/v1/videos/:id/metrics`; snapshot theo `capturedAt` và upsert idempotent.
- Background scheduler/worker với chu kỳ 2 giờ, retry tối đa 3 lần, Redis deduplication, rate limit, failure logging và sync video/metric snapshot.
- `ViralScoreEngine` thuần toán học với median baseline, relative performance, velocity, engagement rate và breakdown score 0–100.
- Viral Videos Dashboard tại Home với thống kê 24 giờ và danh sách video viral có source URL.
- AI service tại `src/services/ai` với OpenAI/Gemini adapters, structured schemas và không gọi API từ React.
- Gemini Video Understanding với video file URI, timestamped timeline và visual breakdown structured JSON.
- Modeling Ideas API `POST /api/v1/videos/:id/ideas` tạo 3–5 ideas có source traceability, mechanism preservation và changed execution.
- Approval gate APIs: `/api/v1/ideas/:id/save`, `/approve`, `/reject`, `/develop`; Develop chỉ chạy với idea `APPROVED`.
- ContentProject lưu riêng `deconstruction`, `artDirection`, `characterDesign`, `backgroundDesign`, `storyboard`, `safetyReview` và `productionPrompts` dưới dạng structured JSON.
- Gemini Final Review lưu draft snapshot và issues riêng; Apply/Ignore là decision của user qua `/api/v1/projects/:id/review/gemini` và `/api/v1/reviews/:id/{apply|ignore}`.
- Asset Workspace metadata API tại `/api/v1/projects/:id/assets`, có type character/background/prop, entity mapping, scene mapping, version và status approval.
- Asset validation API tại `/api/v1/assets/:id/validate`; AI trả scores/issues, còn user quyết định approve, approve anyway hoặc replace.
- Video generation abstraction tại `src/services/video-generation` với `VideoGenerationProvider` và `VeoProvider`, hỗ trợ scene prompt, 9:16, reference images và first/last frame.
- `compileVeoPrompt` tạo `VeoRequest` deterministic từ scene, character, asset, background, camera, action, audio, duration và constraints trước khi gọi Veo.
- Video generation job API `POST /api/v1/scenes/:id/generation-jobs` trả `202`, queue worker gửi/poll Veo, lưu `externalOperationId`, và UI theo dõi qua `GET /api/v1/generation-jobs/:id`.
- Scene review lưu `SceneGenerationVersion` bất biến với match scores, preview và approve; regenerate tạo version mới, không xóa version cũ.
- Daily Report scheduler kiểm tra timezone mỗi phút, prepare lúc 05:xx, publish lúc 06:xx và tạo in-app notification qua `/api/v1/notifications`.
- Scene-Asset mapping API tại `/api/v1/scenes/:id/assets`; mapping chỉ nhận asset cùng project và được replace nguyên tử qua `PUT`.
- Base layout, sidebar placeholder và dashboard placeholder.

Business workflow, external platform API sync, AI provider thật, Gemini và Veo chưa được triển khai ở bước foundation này.

TikTok URL resolving đã có; việc đọc video/metrics thật cần `TIKTOK_ACCESS_TOKEN` và implementation API adapter phù hợp. YouTube/Facebook chưa đăng ký trong MVP nên sẽ bị từ chối rõ ràng ở registry.

## Yêu cầu

- Node.js 20+
- PostgreSQL
- Redis

## Chạy local

```bash
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev --name init
npm run db:seed
npm run dev
```

Chạy background processes ở hai terminal riêng:

```bash
npm run scheduler
npm run worker
npm run report-scheduler
```

`report-scheduler` kiểm tra timezone của từng Channel mỗi phút, xếp job chuẩn bị báo cáo trong khung 05:00–05:09 và publish báo cáo cùng notification trong khung 06:00–06:09. Cần chạy cùng Redis worker để xử lý các job này.

Trên Windows PowerShell, có thể copy env bằng:

```powershell
Copy-Item .env.example .env
```

Trước khi dùng AI Connections, tạo `CREDENTIAL_ENCRYPTION_KEY` bằng chuỗi hex 64 ký tự và giữ bí mật khóa này. Sau khi cấu hình `DATABASE_URL`, chạy migration Prisma:

```bash
npx prisma migrate dev --name ai-connections
```

API key chỉ được giải mã ở server; database lưu ciphertext và 4 ký tự cuối để masking.

## Authentication

MVP dùng email/mật khẩu với session database và cookie `HttpOnly`. Sau khi cấu hình PostgreSQL, chạy migration để thêm bảng session và password hash:

```bash
npx prisma migrate dev --name authentication
```

## Windows Desktop App

Desktop client dùng Tauri và luôn kết nối tới backend web. Khi phát triển cục bộ, chạy `npm run desktop:dev`. Khi build installer, mở **Developer PowerShell for Visual Studio**, đặt URL production trước khi build:

```powershell
$env:DESKTOP_APP_URL="https://app.ten-mien-cua-phong.com"
npm run desktop:build
```

Installer NSIS/MSI được tạo trong `src-tauri/target/release/bundle/`. PostgreSQL, Redis và worker chạy ở server, không đóng gói vào máy người dùng.

Kiểm tra health: `http://localhost:3000/api/health`.

## Kiểm tra chất lượng

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Cấu trúc chính

```text
src/app                 App Router, layout, dashboard, route handlers
src/components          UI nền tảng
src/lib                 env, db, auth, jobs, AI, logging, errors
src/modules              Service/repository boundaries theo domain
prisma/schema.prisma     Database schema
docs/                    Product và technical specifications đã duyệt
```

## Nguyên tắc triển khai tiếp theo

Giữ Channel isolation, source traceability, approval gates, structured AI output, idempotent jobs và version history. Chỉ thêm business module sau khi chốt platform adapter đầu tiên và provider credentials tương ứng.
