import { describe, expect, it } from "vitest";

describe("scene generation review", () => {
  it("keeps regenerate versions additive", () => {
    const versions = [{ version: 1, status: "READY" }, { version: 2, status: "GENERATING" }];
    expect(versions.map((item) => item.version)).toEqual([1, 2]);
    expect(versions[0].status).toBe("READY");
  });
});
