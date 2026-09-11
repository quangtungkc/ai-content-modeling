import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyFailure } from "./policy";
import { createStallGuard } from "./executor";
import { isAllowedRepairPath } from "./self-repair";
import { CODEX_EVENT_TYPES } from "./types";

describe("Codex background executor", () => {
  afterEach(() => vi.useRealTimers());

  it("đánh thức recovery khi stage không có tiến triển quá 5 phút", async () => {
    vi.useFakeTimers();
    const onStalled = vi.fn();
    const guard = createStallGuard(300_000, onStalled);
    await vi.advanceTimersByTimeAsync(300_001);
    expect(onStalled).toHaveBeenCalledTimes(1);
    guard.stop();
  });

  it("heartbeat đặt lại đồng hồ đứng", async () => {
    vi.useFakeTimers();
    const onStalled = vi.fn();
    const guard = createStallGuard(300_000, onStalled);
    await vi.advanceTimersByTimeAsync(240_000);
    guard.touch();
    await vi.advanceTimersByTimeAsync(240_000);
    expect(onStalled).not.toHaveBeenCalled();
    guard.stop();
  });

  it("phân loại lỗi parser/schema là NEEDS_ENGINEERING", () => {
    expect(classifyFailure("OpenAI trả về structured output không hợp lệ")).toBe("ENGINEERING_FAILURE");
    expect(classifyFailure("TypeError: Cannot read properties of undefined")).toBe("ENGINEERING_FAILURE");
  });

  it("chặn patch vào cấu hình nhạy cảm và chỉ cho phép module liên quan", () => {
    const roots = ["src/services/ai"];
    expect(isAllowedRepairPath("src/services/ai/openai.ts", roots)).toBe(true);
    expect(isAllowedRepairPath("src/services/ai/openai.test.ts", roots)).toBe(true);
    expect(isAllowedRepairPath(".env", roots)).toBe(false);
    expect(isAllowedRepairPath("prisma/schema.prisma", roots)).toBe(false);
    expect(isAllowedRepairPath("src/modules/auth/service.ts", roots)).toBe(false);
  });

  it("có event tiến độ, engineering và kết quả tự sửa", () => {
    expect(CODEX_EVENT_TYPES).toEqual(expect.arrayContaining(["STAGE_PROGRESS", "JOB_NEEDS_ENGINEERING", "ENGINEERING_REPAIR_STARTED", "ENGINEERING_REPAIR_SUCCEEDED", "ENGINEERING_REPAIR_FAILED"]));
  });
});
