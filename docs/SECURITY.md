# Security và Privacy

## 1. Bảo vệ truy cập

- Session-based authentication; mọi resource query bắt buộc scope theo `userId`.
- Authorization ở server cho từng Channel, project, asset, report và generation.
- Không tin `channelId`, `userId` hoặc role từ client.
- Rate limit các endpoint upload, AI, sync và generation.

## 2. Secrets

API key của AI, Gemini, Veo, storage, database và Redis chỉ ở server-side environment. Không commit `.env`, không log secret, không expose key trong browser hoặc prompt response.

## 3. Upload và media

- Signed upload URL có thời hạn ngắn.
- Allowlist MIME type, giới hạn dung lượng và checksum.
- Quét file trước khi xử lý; lưu object storage key thay vì tin filename.
- Không render HTML/JS từ metadata hoặc caption chưa sanitize.

## 4. External data

URL competitor được validate theo allowlist platform, chặn SSRF và redirect nguy hiểm. External fetch có timeout, giới hạn kích thước response và audit log.

## 5. AI safety

- Safety review trước prompt final.
- Không dùng system prompt hoặc secret làm dữ liệu cho model.
- Tách source content khỏi instruction để giảm prompt injection.
- Lưu provider/model/version và cảnh báo; không tuyên bố chắc chắn khi AI chỉ suy luận.

## 6. Audit và retention

Audit các sự kiện: đăng nhập, thêm competitor, approval, apply Gemini, upload, generation và regenerate. Metric/raw output có retention policy cấu hình được; user có thể yêu cầu export/delete theo chính sách sản phẩm.

## 7. Vận hành

Database backup, Redis không chứa dữ liệu duy nhất, queue job idempotent, error message không lộ nội bộ. Production logging dùng request ID và redact URL token/query nhạy cảm.
