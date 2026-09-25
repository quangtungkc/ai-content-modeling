const MODELING_SAFETY_POLICY = `
BỘ QUY TẮC AN TOÀN BẮT BUỘC — PHẢI KIỂM TRA TRƯỚC KHI VIẾT MODELING VÀ PROMPT:
- Không viết, tái tạo hoặc chuyển thành prompt tạo ảnh/video cảnh trẻ em, thiếu niên, thanh thiếu niên hoặc người chưa thành niên trong tình huống nguy hiểm, bị thương, bạo lực, bị lạm dụng, tự hại, tình dục hoặc có nguy cơ gây hại.
- Không dùng các từ mô tả mơ hồ để lách quy tắc trên; phải đánh giá cả ngữ cảnh, hành động, đạo cụ và kết quả của cảnh.
- Không mô tả tình dục với người chưa thành niên, không tình dục hóa nhân vật có vẻ trẻ tuổi, không mô tả tự hại, bạo lực đồ họa hoặc thương tích nghiêm trọng.
- Nếu source có yếu tố không an toàn, không viết prompt sản xuất cho yếu tố đó. Dừng phần triển khai an toàn, ghi rõ trong safetyReview rằng nội dung bị BLOCKED vì an toàn, trả storyboard là [] và yêu cầu người dùng cung cấp phương án đã được làm an toàn trước khi sang storyboard/video.
- Không tự ý đổi trẻ vị thành niên thành người trưởng thành để che giấu thay đổi nội dung; việc chuyển thể an toàn phải được người dùng xác nhận và phải tách khỏi STRICT_MODELING.
- safetyReview phải nêu rõ: safetyStatus (PASS hoặc BLOCKED), blockedReasons và safeAlternative. Chỉ dùng safetyStatus PASS khi toàn bộ idea, storyboard, startFramePrompt và englishPrompt đều không vi phạm.
`;

module.exports = { MODELING_SAFETY_POLICY };
