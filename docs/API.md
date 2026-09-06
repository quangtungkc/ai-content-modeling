# API Design

API route dùng Next.js Route Handlers, JSON response chuẩn hóa và session authentication.

## 1. Quy ước

- Prefix: `/api/v1`.
- Mọi request xác thực đều lấy `userId` từ session, không nhận quyền từ body.
- Response lỗi: `{ error: { code, message, details? }, requestId }`.
- Job dài trả `202 Accepted` cùng `jobId`.
- Cursor pagination cho danh sách lớn.

## 2. Channel và competitor

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/channels` | Danh sách Channel của user |
| POST | `/channels` | Tạo Channel |
| GET/PATCH | `/channels/:id` | Xem/cập nhật cấu hình |
| GET | `/channels/:id/competitors` | Danh sách competitor |
| POST | `/channels/:id/competitors` | Thêm URL |
| PATCH | `/competitors/:id` | Tạm dừng/cập nhật |
| POST | `/competitors/:id/sync` | Yêu cầu sync |

POST competitor validate URL, platform và giới hạn active 10–50.

## 3. Monitoring và reports

| Method | Endpoint | Mục đích |
|---|---|---|
| GET | `/channels/:id/videos` | Lọc source videos, score, thời gian |
| GET | `/videos/:id` | Chi tiết video và metric timeline |
| GET | `/channels/:id/reports` | Danh sách daily reports |
| GET | `/reports/:id` | Report và report items |
| POST | `/reports/:id/refresh` | Tạo lại khi được phép |

## 4. Analysis và development

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | `/videos/:id/analyze` | Phân tích source video |
| GET | `/videos/:id/analysis` | Lấy analysis version mới nhất |
| POST | `/ideas/:id/approve` | Approval gate cho idea |
| POST | `/ideas/:id/develop` | Tạo content project sau approval |
| GET | `/projects/:id` | Content package và trạng thái |
| POST | `/projects/:id/review/gemini` | Chạy review tùy chọn |
| POST | `/projects/:id/review/apply` | Apply correction đã chọn |

`develop` từ chối nếu idea chưa `approved` hoặc source traceability không hợp lệ.

## 5. Assets và video

| Method | Endpoint | Mục đích |
|---|---|---|
| POST | `/projects/:id/assets/upload-url` | Lấy signed upload URL |
| POST | `/assets/:id/validate` | Enqueue asset validation |
| POST | `/assets/:id/approve` | User approve/approve anyway |
| PUT | `/scenes/:id/assets` | Gắn asset vào scene |
| POST | `/scenes/:id/generations` | Generate version mới |
| GET | `/scenes/:id/generations` | Lịch sử generation |
| POST | `/generations/:id/approve` | Approve preview |

Generation yêu cầu scene, prompt snapshot và asset mapping đã tồn tại. Regenerate luôn tạo version mới.

## 6. Jobs

`GET /api/v1/jobs/:id` trả trạng thái worker, tiến độ, lỗi user-readable và timestamps; không trả secret/provider token.
