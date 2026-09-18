import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirst, updateMany } = vi.hoisted(() => ({
  findFirst: vi.fn(),
  updateMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    backgroundJob: {
      findFirst,
      updateMany,
    },
  },
}));

import { LocalJobQueue } from "./queue";

describe("LocalJobQueue priority", () => {
  beforeEach(() => {
    findFirst.mockReset();
    updateMany.mockReset();
  });

  it("ưu tiên job Codex mới trước backlog báo lỗi runtime", async () => {
    findFirst.mockResolvedValueOnce({
      id: "codex-job",
      name: "codex.job.execute",
      payload: { jobId: "job-1", userId: "user-1" },
      idempotencyKey: "codex-execute:job-1",
      attempts: 0,
      maxAttempts: 3,
    });
    updateMany.mockResolvedValueOnce({ count: 1 });

    const claimed = await new LocalJobQueue().claim();

    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledWith({
      where: { status: "queued", name: "codex.job.execute" },
      orderBy: { createdAt: "desc" },
    });
    expect(claimed?.name).toBe("codex.job.execute");
  });

  it("không giành job Flow khi phục hồi worker nền", async () => {
    updateMany.mockResolvedValueOnce({ count: 2 });
    const staleBefore = new Date("2026-09-12T01:00:00.000Z");

    await new LocalJobQueue().requeueStale(staleBefore);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        status: "running",
        startedAt: { lt: staleBefore },
        NOT: { name: { startsWith: "desktop.flow." } },
      },
      data: {
        status: "queued",
        startedAt: null,
        error: "Worker bị gián đoạn; job được resume từ checkpoint.",
      },
    });
  });
});
