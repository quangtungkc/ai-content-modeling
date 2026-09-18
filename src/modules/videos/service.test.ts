import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {
  competitor: { findFirst: vi.fn() },
  competitorVideo: { findUnique: vi.fn(), upsert: vi.fn() },
  videoMetricSnapshot: { create: vi.fn() },
} }));

describe("manual Facebook video duration persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CASE 7/8/12 persists durationSec while preserving other manual fields", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.competitor.findFirst).mockResolvedValue({ id: "competitor-1" } as never);
    vi.mocked(db.competitorVideo.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.competitorVideo.upsert).mockResolvedValue({ id: "video-1" } as never);
    vi.mocked(db.videoMetricSnapshot.create).mockResolvedValue({ id: "snapshot-1" } as never);
    const { saveManualCompetitorVideo } = await import("./service");
    await saveManualCompetitorVideo("competitor-1", "user-1", { url: "https://www.facebook.com/reel/1668944091489780/", publishedAt: "2026-09-11T00:06:30.775Z", views: 772300, likes: 4, comments: 5, shares: 6, caption: "source caption", durationSec: 13.42 });
    expect(db.competitorVideo.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ duration: 13.42 }), update: expect.objectContaining({ duration: 13.42 }) }));
    expect(db.videoMetricSnapshot.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ views: 772300, likes: 4, comments: 5, shares: 6 }) }));
  });

  it("CASE 9 updates an existing null duration", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.competitor.findFirst).mockResolvedValue({ id: "competitor-1" } as never);
    vi.mocked(db.competitorVideo.findUnique).mockResolvedValue({ duration: null } as never);
    vi.mocked(db.competitorVideo.upsert).mockResolvedValue({ id: "video-1" } as never);
    vi.mocked(db.videoMetricSnapshot.create).mockResolvedValue({} as never);
    const { saveManualCompetitorVideo } = await import("./service");
    await saveManualCompetitorVideo("competitor-1", "user-1", { url: "https://www.facebook.com/reel/1/", publishedAt: "2026-09-11T00:06:30.775Z", views: 1, durationSec: 13 });
    expect(db.competitorVideo.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ duration: 13 }) }));
  });

  it("CASE 10 preserves a valid existing duration when rescan has null or omitted duration", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.competitor.findFirst).mockResolvedValue({ id: "competitor-1" } as never);
    vi.mocked(db.competitorVideo.findUnique).mockResolvedValue({ duration: 13 } as never);
    vi.mocked(db.competitorVideo.upsert).mockResolvedValue({ id: "video-1" } as never);
    vi.mocked(db.videoMetricSnapshot.create).mockResolvedValue({} as never);
    const { saveManualCompetitorVideo } = await import("./service");
    await saveManualCompetitorVideo("competitor-1", "user-1", { url: "https://www.facebook.com/reel/2/", publishedAt: "2026-09-11T00:06:30.775Z", views: 1, durationSec: null });
    expect(db.competitorVideo.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ duration: 13 }) }));
  });

  it("CASE 11 rejects invalid duration values from persistence as null", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.competitor.findFirst).mockResolvedValue({ id: "competitor-1" } as never);
    vi.mocked(db.competitorVideo.findUnique).mockResolvedValue(null as never);
    vi.mocked(db.competitorVideo.upsert).mockResolvedValue({ id: "video-1" } as never);
    vi.mocked(db.videoMetricSnapshot.create).mockResolvedValue({} as never);
    const { saveManualCompetitorVideo } = await import("./service");
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, "13"]) {
      await saveManualCompetitorVideo("competitor-1", "user-1", { url: `https://www.facebook.com/reel/${String(invalid).replace(/\W/g, "") || "x"}/`, publishedAt: "2026-09-11T00:06:30.775Z", views: 1, durationSec: invalid });
    }
    expect(vi.mocked(db.competitorVideo.upsert).mock.calls.every(([arg]) => (arg as { create: { duration: unknown } }).create.duration === null)).toBe(true);
  });
});
