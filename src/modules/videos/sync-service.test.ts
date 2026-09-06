import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { competitor: { findMany: vi.fn(), update: vi.fn() }, competitorVideo: { upsert: vi.fn() }, videoMetricSnapshot: { upsert: vi.fn() } } }));
vi.mock("@/lib/platform", () => ({ getCompetitorProvider: vi.fn() }));
vi.mock("@/modules/usage/service", () => ({ recordUsage: vi.fn() }));

describe("video sync integration boundary", () => {
  it("deduplicates repeated external video ids before persistence", async () => {
    const { db } = await import("@/lib/db");
    const { getCompetitorProvider } = await import("@/lib/platform");
    vi.mocked(db.competitor.findMany).mockResolvedValue([{ id: "competitor-1", channelId: "channel-1", status: "ACTIVE", url: "https://tiktok.com/@demo", channel: { userId: "user-1" } }] as never);
    vi.mocked(getCompetitorProvider).mockReturnValue({ platform: "tiktok", resolveChannel: vi.fn().mockResolvedValue({ platform: "tiktok", externalId: "demo", handle: "@demo", displayName: "demo", url: "https://tiktok.com/@demo" }), getRecentVideos: vi.fn().mockResolvedValue([{ externalId: "video-1", url: "https://tiktok.com/v/1", caption: null, thumbnail: null, publishedAt: new Date(), durationSec: 10 }, { externalId: "video-1", url: "https://tiktok.com/v/1", caption: null, thumbnail: null, publishedAt: new Date(), durationSec: 10 }]), getVideoMetrics: vi.fn().mockResolvedValue({ views: 1, likes: 1, comments: 0, capturedAt: new Date() }) } as never);
    vi.mocked(db.competitorVideo.upsert).mockResolvedValue({ id: "stored-1" } as never);
    vi.mocked(db.videoMetricSnapshot.upsert).mockResolvedValue({} as never);
    const { syncChannelVideos } = await import("./sync-service");
    await syncChannelVideos("channel-1", { incr: vi.fn().mockResolvedValue(1), expire: vi.fn() } as never);
    expect(db.competitorVideo.upsert).toHaveBeenCalledTimes(1);
  });
});
