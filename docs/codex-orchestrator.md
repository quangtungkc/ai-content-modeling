# Codex Orchestrator cho Viral Content Modeling

## Phạm vi

Module này bọc quanh pipeline hiện tại. Nó không thay thế analysis, modeling, Content Project, Google Flow, scene generation hoặc FFmpeg. Khi `CODEX_ORCHESTRATOR_ENABLED=false`, app tiếp tục dùng Chạy thủ công/Chạy tự động như trước.

## Kiến trúc

- **Execution Engine:** service/API hiện có và desktop adapters thực thi stage lớn.
- **Codex Orchestrator:** lập kế hoạch, chẩn đoán lỗi, chọn recovery, xử lý `UNCERTAIN`, Final Audit và Post-Run Review.
- **Validator Engine:** rule xác định so sánh Expected/Actual trước; Gemini Quality Validator xem media thật khi cần.
- **Recovery Engine:** dùng error signature, lịch sử strategy và Experience Store; mặc định tối đa ba strategy khác nhau.
- **Experience Store:** lưu lỗi, expected/actual, cách thử và cách đã thành công.
- **Improvement Engine:** chỉ tạo proposal cho lỗi lặp hoặc root cause rõ; không merge/deploy/sửa production.
- **Runtime Failure Channel:** lỗi từ UI, API 5xx, mất mạng, IPC/Electron, background job, worker/server crash và job stale được che secret, lưu vào `RuntimeFailure`, rồi xếp hàng gửi Codex.

## Event-driven flow

Desktop executor gửi `STAGE_STARTED`, `STAGE_COMPLETED` hoặc `STAGE_FAILED` về API. Codex không polling tiến độ. Codex chỉ được gọi khi lập plan, có lỗi, validation không chắc chắn/không đạt, Final Audit hoặc Post-Run Review.

Runtime failure reporting chạy độc lập với request gốc. Lỗi gắn với Codex Job phát `RUNTIME_FAILURE_REPORTED`, truy ngược `currentStage/currentAction` nếu payload thiếu stage, rồi đánh thức recovery từ đúng checkpoint; lỗi không gắn job chạy qua `codex.runtime.failure` để Codex chẩn đoán. Nếu mất mạng hoặc Codex API không sẵn sàng, bản ghi vẫn ở trạng thái chờ và được retry bởi worker.

Worker có watchdog 5 phút cho job đang chạy. Watchdog chỉ tạo cảnh báo `JOB_STALLED_OVER_5_MINUTES` và chuyển dữ liệu cho Codex kiểm tra; không tự hủy hoặc khởi chạy trùng job đang hoạt động. Nếu worker/server chết, Electron và tiến trình worker ghi nhận lỗi, lưu spool cục bộ khi chưa thể gửi, rồi gửi lại khi app khởi động.

Mỗi job có `sessionId` riêng và giữ `previousResponseId` để nối tiếp Responses API. Checkpoint, stage state, retry và event đều nằm trong SQLite nên server/app restart không làm mất trạng thái. `GET /api/v1/codex/jobs/:id` trả current state và high-level `nextAction` để executor resume.

Mỗi yêu cầu gửi tới Codex có timeout cứng 5 phút. Khi hết thời gian, app chuyển về policy recovery xác định sẵn thay vì giữ request vô hạn.

## High-level tools

Allow-list nằm tại `src/modules/codex-orchestrator/tools.ts`. Không có arbitrary shell, filesystem, credential, deploy hoặc merge. Tool chính gồm đọc source/job/project/log/failure/experience; chạy các stage hiện có; validate; regenerate riêng asset/scene; assembly; Final Audit và Post-Run Review.

Google Flow dùng một browser session nên generation giữ tuần tự để tránh lẫn asset/scene. Các adapter/provider độc lập có thể dùng batch theo concurrency limit; Quality Validator hiện kiểm tối đa hai scene song song.

## Feature flags

```env
CODEX_ORCHESTRATOR_ENABLED="true"
CODEX_AUTO_RECOVERY_ENABLED="true"
CODEX_POST_RUN_REVIEW_ENABLED="true"
CODEX_EXTERNAL_RESEARCH_ENABLED="false"
CODEX_MODEL="gpt-5"
CODEX_MAX_RECOVERY_ATTEMPTS="3"
```

Không ghi key vào các biến trên. Codex dùng kết nối OpenAI đã mã hóa server-side trong Cài đặt AI. Quality Validator dùng kết nối Gemini đã mã hóa. Prompt/event được redaction trước khi lưu hoặc gửi.
Lỗi từ giao diện được giữ tạm ở local storage khi offline và gửi lại khi có mạng.

## Cách chạy

1. Kết nối OpenAI và Gemini trong Cài đặt AI.
2. Bật `CODEX_ORCHESTRATOR_ENABLED` ở môi trường server/desktop rồi khởi động lại app.
3. Phân tích một Source Video, chọn cài đặt và bấm **Run with Codex**.
4. Xem checkpoint, recovery, validation và video cuối trong **Lịch sử hoạt động**.
5. `FINAL_AUDIT_PASSED` chỉ mở khóa `POST_RUN_REVIEW`; chỉ sau `POST_RUN_REVIEW_COMPLETED` mới phát `JOB_COMPLETED`.

## Pilot và mock boundary

Kiểm thử policy/state machine không mock pipeline. Khi Flow/Gemini/OpenAI bên ngoài không khả dụng, chỉ mock đúng adapter provider đó; database, state transition, Expected/Actual validation, retry, event log, final completion gate và resume vẫn chạy thật. Báo cáo pilot phải nêu rõ boundary nào mock.

## External research và improvement

External research mặc định tắt. Khi bật, chỉ Post-Run Review được phép nghiên cứu tài liệu/SDK/module; proposal phải ghi nguồn, license, bảo trì, bảo mật, độ phức tạp, chi phí migration và regression tests. Phase hiện tại không auto-promote patch.

Tham khảo giao thức: [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses), [Gemini Files API](https://ai.google.dev/gemini-api/docs/files).
