import { describe, expect, it } from "vitest";
import { AppError, toErrorResponse } from "./errors";

describe("error handling", () => {
  it("serializes application errors", async () => {
    const response = toErrorResponse(new AppError("BAD_INPUT", "Dữ liệu không hợp lệ.", 400), "req-1");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "BAD_INPUT" }, requestId: "req-1" });
  });
});
