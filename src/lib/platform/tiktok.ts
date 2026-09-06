import { PlatformProviderError, PlatformProviderNotConfiguredError } from "./errors";
import type { CompetitorChannel, CompetitorPlatformProvider, RecentVideo, VideoMetrics } from "./types";

const TIKTOK_HOSTS = new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]);

export class TikTokProvider implements CompetitorPlatformProvider {
  readonly platform = "tiktok" as const;

  constructor(private readonly accessToken?: string) {}

  async resolveChannel(url: string): Promise<CompetitorChannel> {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new PlatformProviderError("TikTok URL không hợp lệ."); }
    if (parsed.protocol !== "https:" || !TIKTOK_HOSTS.has(parsed.hostname.toLowerCase())) {
      throw new PlatformProviderError("URL không thuộc TikTok.", { url });
    }
    const handle = parsed.pathname.match(/^\/@([^/]+)\/?$/)?.[1];
    if (!handle) throw new PlatformProviderError("TikTok channel URL cần có dạng https://www.tiktok.com/@handle.");
    return { platform: this.platform, externalId: handle, handle: `@${handle}`, displayName: handle, url: `https://www.tiktok.com/@${handle}` };
  }

  async getRecentVideos(channel: CompetitorChannel): Promise<RecentVideo[]> {
    void channel;
    this.requireAccess();
    return [];
  }

  async getVideoMetrics(video: RecentVideo): Promise<VideoMetrics> {
    void video;
    this.requireAccess();
    return { views: 0, likes: 0, comments: 0, capturedAt: new Date() };
  }

  private requireAccess(): never {
    if (!this.accessToken) throw new PlatformProviderNotConfiguredError("TikTok");
    throw new PlatformProviderError("TikTok API adapter chưa được triển khai.");
  }
}
