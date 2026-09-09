import { describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({ rm: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/db", () => {
  const resolved = () => vi.fn().mockResolvedValue({ count: 1 });
  return {
    db: {
      $transaction: vi.fn((operations: Array<Promise<unknown>>) => Promise.all(operations)),
      competitorVideo: { findFirst: vi.fn(), delete: vi.fn().mockResolvedValue({}) },
      modelingIdea: { findMany: vi.fn(), deleteMany: resolved() },
      contentProject: { findMany: vi.fn(), deleteMany: resolved() },
      automationRun: { updateMany: resolved(), deleteMany: resolved(), findFirst: vi.fn(), delete: vi.fn() },
      sceneGenerationVersion: { deleteMany: resolved() },
      videoGenerationJob: { deleteMany: resolved() },
      videoGeneration: { deleteMany: resolved() },
      sceneAsset: { deleteMany: resolved() },
      assetValidation: { deleteMany: resolved() },
      asset: { deleteMany: resolved() },
      projectReview: { deleteMany: resolved() },
      usageEvent: { deleteMany: resolved() },
      storyboardScene: { deleteMany: resolved() },
      sourceAnalysis: { deleteMany: resolved() },
      reportItem: { deleteMany: resolved() },
      videoMetricSnapshot: { deleteMany: resolved() },
    },
  };
});

describe("xóa video cùng dữ liệu modeling", () => {
  it("xóa video nguồn, project, lịch sử và thư mục media liên quan", async () => {
    const { db } = await import("@/lib/db");
    const { rm } = await import("node:fs/promises");
    vi.mocked(db.competitorVideo.findFirst).mockResolvedValue({ id: "video-1" } as never);
    vi.mocked(db.modelingIdea.findMany).mockResolvedValue([{ id: "idea-1", project: { id: "project-1" } }] as never);
    vi.mocked(db.contentProject.findMany).mockResolvedValue([{ id: "project-1", scenes: [{ id: "scene-1" }], assets: [{ id: "asset-1" }] }] as never);
    const { deleteSourceVideoWithModeling } = await import("./deletion-service");

    await expect(deleteSourceVideoWithModeling("video-1", "user-1")).resolves.toEqual({ deletedVideoId: "video-1", deletedProjects: 1 });
    expect(db.contentProject.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["project-1"] } } });
    expect(db.automationRun.deleteMany).toHaveBeenCalledWith({ where: { userId: "user-1", sourceVideoId: "video-1" } });
    expect(db.competitorVideo.delete).toHaveBeenCalledWith({ where: { id: "video-1" } });
    expect(rm).toHaveBeenCalledTimes(4);
  });
});
