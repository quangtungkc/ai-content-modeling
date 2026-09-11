# API-first cho Gemini, Google Image và Veo

## Phạm vi

Luồng business hiện tại vẫn giữ nguyên: phân tích → Modeling Idea → Content Project → ảnh → video phân cảnh → ghép video. Lớp provider mới chỉ thay đổi cách thực thi AI: ưu tiên API server-side, sau đó mới dùng Flow/browser fallback khi được bật và API chưa sẵn sàng.

## Routing

- `GOOGLE_API_FIRST_ENABLED=true`: bật routing API-first.
- `GEMINI_API_ENABLED=true`: cho phép Google Image/Gemini API.
- `GOOGLE_IMAGE_API_ENABLED=true`: cho phép tạo ảnh qua Gemini Image API.
- `VEO_API_ENABLED=true`: cho phép tạo video qua Veo API.
- `GOOGLE_BROWSER_FALLBACK_ENABLED=true`: cho phép UI chuyển về executor Flow hiện có khi lỗi cấu hình/provider thuộc nhóm có thể fallback.

API routes:

- `POST /api/v1/projects/:id/images`: tạo bối cảnh trước, sau đó tạo từng ảnh Start frame theo thứ tự; ảnh cảnh nhận ảnh nhân vật chính và bối cảnh đã lưu làm reference.
- `POST /api/v1/projects/:id/videos`: xếp batch vào `LocalJobQueue` và trả `202 + queueJobId`; worker tạo từng cảnh tuần tự. Ảnh cảnh đã lưu là Start frame duy nhất, thời lượng 4 giây, khung 9:16 mặc định và âm thanh bật. UI đọc `GET .../videos?status=1&queueJobId=...` để cập nhật tiến độ.
- `GET /api/v1/projects/:id/images` và `GET /api/v1/projects/:id/videos`: đọc output từ storage hiện tại của app.

## Credential và bảo mật

API key được đọc từ `AIConnection` đã mã hóa trong database qua `src/modules/ai-connections/credentials.ts`. Không đưa key vào client, prompt, event log hoặc response. Không dùng API key trong `.env.example`; file này chỉ chứa placeholder và các feature flag.

## Veo operation

`src/services/video-generation/veo.ts` tạo operation, lưu `externalOperationId`, poll theo chu kỳ có timeout 15 phút, tải MP4 sau khi operation thành công và ghi vào `generated-videos/<projectId>/scene-<n>.mp4`. `src/modules/generation/job-service.ts` cập nhật trạng thái job/version và dùng idempotency cho usage metric.

Request Start frame dùng payload ảnh base64 theo schema provider hiện tại (`bytesBase64Encoded`, `mimeType`). `durationSeconds` truyền dạng số `4` vì endpoint thực tế của tài khoản trả lỗi khi nhận chuỗi. Không gửi End frame trong luồng mặc định.

## Fallback

Flow/browser automation hiện tại không bị xóa. UI chỉ chuyển fallback khi API trả lỗi cấu hình/provider và `browserFallback` không bị tắt. Những lỗi request/semantic không được tự động nuốt để tránh tạo output sai mà không báo lỗi.

## Pilot thật

- Gemini Image API: tạo thành công ảnh Start frame cảnh 1 và lưu vào storage app.
- Veo API: tạo thành công operation, poll đến hoàn tất, tải MP4 và lưu thành công.
- Job database: `COMPLETED`; generation version: `READY`; có `externalOperationId` và `resultUrl` nội bộ.
- Kiểm thử schema đã tái hiện lỗi `inlineData` và lỗi kiểu `durationSeconds`, sau đó đã sửa và xác nhận request HTTP 200.

## Chưa thay đổi

Không thay đổi workflow UI hiện tại, không xóa Flow fallback, không đổi storage cũ, không đưa credential ra client và không tự động deploy/release.
