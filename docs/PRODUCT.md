# AI Content Modeling SaaS — Product Specification

## 1. Tầm nhìn

AI Content Modeling giúp creator phát hiện video đối thủ đang vượt hiệu suất bình thường, hiểu cơ chế thành công và phát triển một ý tưởng mới có cùng cơ chế nhưng khác execution.

Chuỗi sản phẩm bắt buộc:

`SOURCE VIDEO → VIRAL SIGNAL → ANALYSIS → MODELING IDEA → USER APPROVAL → CONTENT PROJECT`

Ứng dụng hỗ trợ con người ra quyết định, không tự động sao chép hoặc tự ý phát triển mọi ý tưởng.

## 2. Người dùng và Channel

Một user có nhiều Channel độc lập. Mỗi Channel lưu:

- Tên, platform, topic, sub-topic.
- Target country/market, language, audience.
- Content style, visual style, video duration.
- Creative instructions, must-keep elements, excluded elements, timezone.

Không hard-code quốc gia, ngôn ngữ, phong cách hay platform.

Mỗi Channel có 10–50 competitor URLs do user cung cấp. Hệ thống không tự thêm competitor trong luồng chính.

## 3. MVP scope

### Có trong MVP

1. Đăng nhập và quản lý Channel.
2. Thêm, sửa, tạm dừng competitor URL.
3. Lưu source video và metric snapshots theo thời gian.
4. Tính viral score dựa trên baseline của từng competitor.
5. Daily Viral Report 24 giờ gần nhất, phát hành lúc 06:00 theo timezone của Channel.
6. Phân tích source video có structured output.
7. Tạo 3–5 modeling ideas có source traceability.
8. Approval gate trước khi Develop.
9. Tạo content project gồm deconstruction, art direction, character, background, storyboard, safety review và prompt tiếng Anh.
10. Gemini review/enhancement dạng tùy chọn.
11. Asset workspace, validation, approval và scene-asset mapping.
12. Provider abstraction cho AI và video; Veo là implementation đầu tiên.
13. Tạo video từng scene, preview, approve, regenerate và version history.

### Chưa làm trong MVP

- Tự động phát hiện competitor.
- Tự động đăng video lên platform.
- Render toàn bộ video một lần mặc định.
- Marketplace, team billing, social scheduling.
- Fine-tuning model riêng.
- Crawl mọi platform bằng một adapter duy nhất.

## 4. Nguyên tắc sản phẩm

- Mọi idea quan trọng phải liên kết tới source video cụ thể.
- Viral là relative performance, không chỉ là số view tuyệt đối.
- User approval là gate bắt buộc ở idea, asset và scene.
- AI output phải có schema để kiểm tra và tái sử dụng.
- Không làm video dài hoặc storyboard chi tiết trước khi user chọn idea.
- Không ghi đè generation cũ.

## 5. Tiêu chí thành công MVP

- User tạo được Channel trong dưới 5 phút.
- User thêm được 10–50 competitor URLs và nhìn thấy trạng thái theo dõi.
- Daily report giải thích được video nào outperform và vì sao.
- Một source video tạo ra 3–5 idea có thể truy ngược về source.
- Không thể bỏ qua các approval gate bằng thao tác UI thông thường.
- Một scene có thể generate, preview, approve hoặc regenerate mà vẫn giữ version cũ.
