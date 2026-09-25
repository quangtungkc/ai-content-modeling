import { afterEach, describe, expect, it, vi } from "vitest";
import { FacebookProvider } from "./facebook";

const channel = { platform: "facebook" as const, externalId: "page-1", handle: "@page-1", displayName: "Page 1", url: "https://www.facebook.com/page-1" };
const video = { platform: "facebook" as const, externalId: "video-1", url: "https://www.facebook.com/watch/?v=video-1", publishedAt: new Date("2026-09-19T10:00:00.000Z") };

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Facebook competitor provider", () => {
  it("selects up to ten verified videos from the past seven days", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-25T06:00:00.000Z"));
    const entries = [
      ...Array.from({ length: 10 }, (_, index) => ({ id: `old-${index}`, permalink_url: `https://www.facebook.com/watch/?v=old-${index}`, created_time: "2026-09-17T06:00:00.000Z" })),
      ...Array.from({ length: 12 }, (_, index) => ({ id: `recent-${index}`, permalink_url: `https://www.facebook.com/watch/?v=recent-${index}`, created_time: new Date(Date.UTC(2026, 8, 19, index, 0)).toISOString() })),
    ];
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: entries }));
    vi.stubGlobal("fetch", fetchMock);

    const videos = await new FacebookProvider("token").getRecentVideos(channel);
    const requestUrl = new URL(String(fetchMock.mock.calls[0]?.[0]));

    expect(requestUrl.searchParams.get("limit")).toBe("100");
    expect(videos).toHaveLength(10);
    expect(videos[0]?.externalId).toBe("recent-11");
    expect(videos[9]?.externalId).toBe("recent-2");
  });

  it("reads lifetime views from video insights when the video object omits views", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ likes: { summary: { total_count: 12 } }, comments: { summary: { total_count: 3 } }, shares: { count: 2 } }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ name: "total_video_views", values: [{ value: 12345 }] }] }));
    vi.stubGlobal("fetch", fetchMock);

    const metrics = await new FacebookProvider("token").getVideoMetrics(video);

    expect(metrics.views).toBe(12345);
    expect(metrics.likes).toBe(12);
    expect(metrics.comments).toBe(3);
    expect(metrics.shares).toBe(2);
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain("/video-1/video_insights");
  });

  it("does not silently convert missing views to zero", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ likes: 0, comments: 0, shares: 0 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new FacebookProvider("token").getVideoMetrics(video)).rejects.toThrow("không trả về số view thực tế");
  });
});
