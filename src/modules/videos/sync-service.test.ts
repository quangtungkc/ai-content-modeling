import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { competitor: { findMany: vi.fn(), update: vi.fn() }, competitorVideo: { upsert: vi.fn() }, videoMetricSnapshot: { upsert: vi.fn() } } }));
vi.mock("@/lib/platform", () => ({ getCompetitorProvider: vi.fn() }));
vi.mock("@/modules/usage/service", () => ({ recordUsage: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("video sync integration boundary", () => {
  it("deduplicates repeated external video ids before persistence", async () => {
    const { db } = await import("@/lib/db");
    const { getCompetitorProvider } = await import("@/lib/platform");
    vi.mocked(db.competitor.findMany).mockResolvedValue([{ id: "competitor-1", channelId: "channel-1", status: "ACTIVE", url: "https://tiktok.com/@demo", channel: { userId: "user-1" } }] as never);
    vi.mocked(getCompetitorProvider).mockReturnValue({ platform: "tiktok", resolveChannel: vi.fn().mockResolvedValue({ platform: "tiktok", externalId: "demo", handle: "@demo", displayName: "demo", url: "https://tiktok.com/@demo" }), getRecentVideos: vi.fn().mockResolvedValue([{ externalId: "video-1", url: "https://tiktok.com/v/1", caption: null, thumbnail: null, publishedAt: new Date(), durationSec: 10 }, { externalId: "video-1", url: "https://tiktok.com/v/1", caption: null, thumbnail: null, publishedAt: new Date(), durationSec: 10 }]), getVideoMetrics: vi.fn().mockResolvedValue({ views: 1, likes: 1, comments: 0, capturedAt: new Date() }) } as never);
    vi.mocked(db.competitorVideo.upsert).mockResolvedValue({ id: "stored-1" } as never);
    vi.mocked(db.videoMetricSnapshot.upsert).mockResolvedValue({} as never);
    const { syncChannelVideos } = await import("./sync-service");
    await syncChannelVideos("channel-1");
    expect(db.competitorVideo.upsert).toHaveBeenCalledTimes(1);
  });

  it("limits each competitor to ten newest videos and continues after one metrics failure", async () => {
    const { db } = await import("@/lib/db");
    const { getCompetitorProvider } = await import("@/lib/platform");
    const videos = Array.from({ length: 12 }, (_, index) => ({ externalId: `video-${index}`, url: `https://facebook.com/video-${index}`, caption: null, thumbnail: null, publishedAt: new Date(Date.UTC(2026, 8, 19, index, 0)), durationSec: 10 }));
    vi.mocked(db.competitor.findMany).mockResolvedValue([{ id: "competitor-1", channelId: "channel-1", status: "ACTIVE", url: "https://facebook.com/page", channel: { userId: "user-1" } }] as never);
    vi.mocked(getCompetitorProvider).mockReturnValue({ platform: "facebook", resolveChannel: vi.fn().mockResolvedValue({ platform: "facebook", externalId: "page", handle: "@page", displayName: "page", url: "https://facebook.com/page" }), getRecentVideos: vi.fn().mockResolvedValue(videos), getVideoMetrics: vi.fn().mockImplementation(async (video) => { if (video.externalId === "video-11") throw new Error("metrics unavailable"); return { views: 100, likes: 10, comments: 1, capturedAt: new Date() }; }) } as never);
    vi.mocked(db.competitorVideo.upsert).mockResolvedValue({ id: "stored-1" } as never);
    vi.mocked(db.videoMetricSnapshot.upsert).mockResolvedValue({} as never);

    const { syncChannelVideos } = await import("./sync-service");
    await syncChannelVideos("channel-1");

    expect(db.competitorVideo.upsert).toHaveBeenCalledTimes(10);
    expect(db.videoMetricSnapshot.upsert).toHaveBeenCalledTimes(9);
    expect(db.competitor.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ syncError: expect.stringContaining("Đã quét 10 video") }) }));
  });
});
