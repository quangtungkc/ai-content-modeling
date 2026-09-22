import { describe, expect, it } from "vitest";
import { redactSensitive } from "./redaction";

describe("secret redaction", () => {
  it("redacts sensitive keys and common token formats recursively", () => {
    const result = redactSensitive({ password: "pw", nested: { authorization: "Bearer abc.def", note: "apiKey=sk-test-123456789012" } });
    expect(result).toEqual({ password: "[REDACTED]", nested: { authorization: "[REDACTED]", note: "apiKey=[REDACTED]" } });
  });

  it("does not leak Error stacks", () => {
    const error = new Error("token=secret-value");
    expect(redactSensitive(error)).toMatchObject({ message: "token=[REDACTED]" });
    expect(JSON.stringify(redactSensitive(error))).not.toContain("secret-value");
  });
});
