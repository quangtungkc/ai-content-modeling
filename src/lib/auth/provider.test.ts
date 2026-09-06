import { describe, expect, it, vi } from "vitest";
import { UnconfiguredAuthProvider } from "./provider";

vi.mock("@/lib/env", () => ({ getEnv: () => ({ NODE_ENV: "production" }) }));
vi.stubEnv("NODE_ENV", "production");
vi.stubEnv("DATABASE_URL", "https://example.com/db");
vi.stubEnv("REDIS_URL", "redis://localhost:6379");
vi.stubEnv("AUTH_SECRET", "a".repeat(32));
vi.stubEnv("CREDENTIAL_ENCRYPTION_KEY", "a".repeat(64));

describe("authentication authorization boundary", () => {
  it("does not create a demo session in production", async () => {
    expect(await new UnconfiguredAuthProvider().getSession()).toBeNull();
  });
});
