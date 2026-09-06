import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/provider", () => ({ getRequiredSession: vi.fn().mockRejectedValue(new Error("AUTHENTICATION_REQUIRED")) }));
vi.mock("@/modules/ai-connections/service", () => ({ listAIConnections: vi.fn(), upsertAIConnection: vi.fn() }));

describe("AI connections API authorization", () => {
  it("returns 401 without a session", async () => {
    const { GET } = await import("./route");
    const response = await GET();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "AUTHENTICATION_REQUIRED" } });
  });
});
