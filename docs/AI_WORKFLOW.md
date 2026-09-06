# AI Workflow

## 1. Provider pipeline

```text
Source video
  → structured analysis
  → 3–5 modeling ideas
  → user approval
  → content package
  → optional Gemini review
  → user-created assets
  → asset validation
  → scene prompt compiler
  → Veo generation
  → scene review
```

## 2. Structured outputs

AI phải trả JSON theo schema versioned, gồm `schemaVersion`, `provider`, `model`, `inputRefs`, `warnings`, `content` và `createdAt`. Parse bằng schema validator; output không hợp lệ không được publish sang bước sau.

## 3. Source analysis

Bắt buộc có summary, hook, setup, conflict, escalation, twist, payoff, the gag, camera pattern, editing rhythm, character interactions, sound pattern, retention mechanism và why it works.

Phân tích phải phân biệt quan sát từ source với suy luận. Không tự thêm drama, cinematic hoặc chi tiết không có bằng chứng.

## 4. Modeling ideas

Mỗi idea bắt buộc có title, core concept, source mechanism, preserved, changed, market adaptation, similarity risk và why worth developing. Idea phải chứa `sourceVideoId` và `analysisId`.

Không gọi full development cho đến khi user approve.

## 5. Content package

Output gồm deconstruction, art direction theo Channel, character design, background design, storyboard scene-by-scene, safety review và English prompts. Storyboard mỗi scene có visual/spatial/pose, ordered action và audio.

## 6. Gemini review

Gemini là provider tùy chọn. Input là content package version cụ thể; output gồm issue severity, location, explanation, suggested correction và confidence. User chọn `Apply` hoặc `Ignore` từng correction. Apply tạo version mới, không sửa mất bản cũ.

## 7. Asset validation

Validator nhận asset, asset type, expected design và project context. Trả `APPROVED` hoặc `NEEDS_REVISION`, kèm issues theo appearance, style, layout, lighting, visibility và consistency. User vẫn có quyền approve anyway.

## 8. Prompt compilation và Veo

Prompt compiler kết hợp Channel rules, character/background consistency, scene action, camera, timing, lighting, physics, audio và constraints. Prompt final lưu snapshot cùng generation. Veo chỉ nhận asset reference và prompt từ server.

## 9. Viral score

MVP dùng score giải thích được, có thể điều chỉnh sau khi có dữ liệu:

`score = 0.35 relativePerformance + 0.25 velocity + 0.20 engagement + 0.10 freshness + 0.10 historicalConfidence`

Chuẩn hóa từng thành phần về 0–100. Relative performance so với baseline của chính competitor; khi sample quá nhỏ phải gắn cờ `low confidence`.
