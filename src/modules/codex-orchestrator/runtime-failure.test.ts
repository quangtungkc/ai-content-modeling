import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFailure: vi.fn(),
  updateFailure: vi.fn(),
  enqueue: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    runtimeFailure: { create: mocks.createFailure, update: mocks.updateFailure, findUnique: vi.fn() },
    codexJob: { findFirst: vi.fn(), findUnique: vi.fn() },
    channel: { findUnique: vi.fn() },
    syncRun: { findUnique: vi.fn() },
    videoGenerationJob: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CODEX_ORCHESTRATOR_ENABLED: true }) }));
vi.mock("@/lib/jobs/queue", () => ({ LocalJobQueue: class { enqueue = mocks.enqueue; } }));
vi.mock("./storage", () => ({ ensureCodexStorage: vi.fn(async () => undefined) }));
vi.mock("./service", () => ({ appendCodexEvent: vi.fn(), reportCodexEvent: vi.fn() }));
vi.mock("./reasoner", () => ({ CodexReasoner: class {} }));

import { reportBackgroundJobFailure, reportRuntimeFailure } from "./runtime-failure";

describe("runtime failure reporting", () => {
  it("stores a redacted failure and queues it for Codex", async () => {
    mocks.createFailure.mockResolvedValue({ id: "runtime-1", status: "PENDING" });
    mocks.updateFailure.mockResolvedValue({ id: "runtime-1", status: "QUEUED" });
    mocks.enqueue.mockResolvedValue({ jobId: "queue-1" });

    const result = await reportRuntimeFailure({
      userId: "user-1",
      source: "renderer:api-5xx",
      error: new Error("Provider failed: api_key=real-secret"),
      context: { token: "should-not-be-stored" },
    });

    expect(result.id).toBe("runtime-1");
    expect(mocks.createFailure).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: "user-1",
        message: "Provider failed: [REDACTED]",
        context: expect.objectContaining({ token: "[REDACTED]" }),
      }),
    }));
    expect(mocks.enqueue).toHaveBeenCalledWith("codex.runtime.failure", { runtimeFailureId: "runtime-1", userId: "user-1" }, "codex-runtime-report:runtime-1");
    expect(mocks.updateFailure).toHaveBeenCalledWith({ where: { id: "runtime-1" }, data: { status: "QUEUED" } });
  });

  it("does not recursively report the Codex telemetry job itself", async () => {
    const result = await reportBackgroundJobFailure({ jobId: "queue-2", name: "codex.runtime.failure", payload: {} }, new Error("Codex unavailable"));
    expect(result).toBeNull();
    expect(mocks.createFailure).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ backgroundJobId: "queue-2" }) }));
  });
});
