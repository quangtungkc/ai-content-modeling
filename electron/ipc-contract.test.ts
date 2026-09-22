import { describe, expect, it } from "vitest";

const { INVOKE_CHANNELS, assertKnownInvokeChannel, isAllowedExternalUrl } = require("./ipc-contract.cjs") as { INVOKE_CHANNELS: string[]; assertKnownInvokeChannel: (channel: unknown) => string; isAllowedExternalUrl: (value: unknown) => boolean };

describe("Electron IPC contract", () => {
  it("keeps renderer invoke channels explicit and namespaced", () => {
    expect(INVOKE_CHANNELS.length).toBeGreaterThan(10);
    expect(INVOKE_CHANNELS.every((channel) => /^[a-z0-9-]+:[a-z0-9-]+$/.test(channel))).toBe(true);
    expect(() => assertKnownInvokeChannel("shell:exec")).toThrow("IPC_CHANNEL_NOT_ALLOWED");
  });

  it("allows only http(s) external navigation", () => {
    expect(isAllowedExternalUrl("https://example.com")).toBe(true);
    expect(isAllowedExternalUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isAllowedExternalUrl("file:///C:/secret.txt")).toBe(false);
    expect(isAllowedExternalUrl("javascript:alert(1)")).toBe(false);
  });
});
