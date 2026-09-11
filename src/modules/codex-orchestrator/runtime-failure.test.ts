import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createFailure: vi.fn(),
  updateFailure: vi.fn(),
  enqueue: vi.fn(),
  findCodexJob: vi.fn(),
  reportCodexEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    runtimeFailure: { create: mocks.createFailure, update: mocks.updateFailure, findUnique: vi.fn() },
    codexJob: { findFirst: mocks.findCodexJob, findUnique: vi.fn() },
    channel: { findUnique: vi.fn() },
    syncRun: { findUnique: vi.fn() },
    videoGenerationJob: { findUnique: vi.fn() },
  },
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ CODEX_ORCHESTRATOR_ENABLED: true }) }));
vi.mock("@/lib/jobs/queue", () => ({ LocalJobQueue: class { enqueue = mocks.enqueue; } }));
vi.mock("./storage", () => ({ ensureCodexStorage: vi.fn(async () => undefined) }));
vi.mock("./service", () => ({ appendCodexEvent: vi.fn(), reportCodexEvent: mocks.reportCodexEvent }));
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

  it("gắn lỗi của Codex worker vào stage hiện tại và đánh thức recovery", async () => {
    mocks.createFailure.mockResolvedValue({ id: "runtime-3", status: "PENDING" });
    mocks.updateFailure.mockResolvedValue({ id: "runtime-3", status: "RECOVERY_REQUESTED" });
    mocks.findCodexJob.mockResolvedValue({ id: "codex-3", currentStage: "PROJECT", currentAction: "runProjectDevelopmentStage" });
    mocks.reportCodexEvent.mockResolvedValue({});

    await reportBackgroundJobFailure({ jobId: "queue-3", name: "codex.job.execute", payload: { jobId: "codex-3", userId: "user-3" } }, new Error("worker stopped"));

    expect(mocks.createFailure).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ codexJobId: "codex-3", stage: "PROJECT" }) }));
    expect(mocks.reportCodexEvent).toHaveBeenCalledWith("user-3", "codex-3", expect.objectContaining({ type: "STAGE_FAILED", stage: "PROJECT" }));
  });
});
