import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password helpers", () => {
  it("hashes a password and verifies only the matching password", async () => {
    const hash = await hashPassword("a-strong-password");

    expect(hash).not.toBe("a-strong-password");
    await expect(verifyPassword("a-strong-password", hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});
