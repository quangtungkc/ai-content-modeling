import { describe, expect, it, vi } from "vitest";
import { shouldUseDatabaseAuth, UnconfiguredAuthProvider } from "./provider";

vi.mock("@/lib/env", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/env")>(),
  getEnv: () => ({ NODE_ENV: "production" }),
}));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("DATABASE_URL", "https://example.com/db");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");
vi.stubEnv("AUTH_SECRET", "a".repeat(32));
vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "a".repeat(64));

describe("authentication authorization boundary", () => {
  it("does not create a demo session in production", async () => {
    expect(await new UnconfiguredAuthProvider().getSession()).toBeNull();
  });

  it("uses the persisted database session for desktop development", () => {
    expect(shouldUseDatabaseAuth("development", "1")).toBe(true);
    expect(shouldUseDatabaseAuth("development", undefined)).toBe(false);
    expect(shouldUseDatabaseAuth("production", undefined)).toBe(true);
  });
});
