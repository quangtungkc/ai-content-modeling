# UI Specification — MVP

## 1. Điều hướng

Sidebar: Channel switcher, Daily Reports, Videos, Content Projects, Asset Workspace, Settings.

Channel switcher luôn hiển thị Channel hiện tại để tránh nhầm dữ liệu giữa các niche.

## 2. Màn hình chính

### Channel setup

Wizard ngắn gồm thông tin cơ bản, audience/market, style và creative constraints. Hiển thị timezone và giờ report 06:00.

### Competitors

Bảng URL, platform, trạng thái, lần sync cuối, lỗi. Có bulk paste 10–50 URL, validate trước khi lưu.

### Daily Viral Report

Cards/table gồm thumbnail, competitor, published time, views, velocity, engagement, viral score, relative performance và lý do outperform. Mỗi item có CTA `Analyze source`.

### Video detail

Hiển thị URL nguồn, metric timeline, baseline competitor, score breakdown, analysis và modeling ideas. Source URL luôn nhìn thấy.

### Idea approval

Mỗi idea hiển thị preserved/changed, market adaptation, similarity risk. CTA rõ ràng: `Develop`, `Reject`, `Save`.

### Content project

Tabs: Deconstruction, Art Direction, Characters, Background, Storyboard, Safety, Prompts, Gemini Review. Trạng thái project và provider hiển thị trên đầu.

### Asset Workspace

Lọc theo project, loại asset, entity và scene. Asset card hiển thị preview, validation status, version và actions `Approve`, `Replace`, `Approve anyway`.

### Scene generation

Danh sách scene theo thứ tự. Mỗi scene có asset mapping, prompt, generation versions, preview và actions `Generate`, `Approve`, `Regenerate`, `Keep previous`.

## 3. UX guardrails

- Không hiển thị nút Develop nếu chưa approval.
- Không cho Generate nếu asset bắt buộc chưa được approve hoặc approve anyway.
- Cảnh báo rõ khi provider lỗi, dữ liệu metric cũ hoặc score chưa đủ mẫu.
- Không dùng wording “copy”; dùng “model mechanism” và “similarity risk”.
- Mọi thao tác async có trạng thái pending và retry.

## 4. Responsive

Desktop-first cho report và storyboard; mobile chỉ cần xem report, video detail và trạng thái job trong MVP.
