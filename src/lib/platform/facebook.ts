import { PlatformProviderError, PlatformProviderNotConfiguredError } from "./errors";
import type { CompetitorChannel, CompetitorPlatformProvider, RecentVideo, VideoMetrics } from "./types";

const HOSTS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]);

type GraphResponse = { id?: string; name?: string; username?: string; link?: string; data?: Array<Record<string, unknown>>; views?: unknown; likes?: unknown; comments?: unknown; shares?: unknown };

export class FacebookProvider implements CompetitorPlatformProvider {
  readonly platform = "facebook" as const;

  constructor(private readonly accessToken?: string, private readonly version = process.env.META_GRAPH_VERSION ?? "v24.0") {}

  async resolveChannel(url: string): Promise<CompetitorChannel> {
    const parsed = this.parseUrl(url);
    const externalId = parsed.searchParams.get("id") ?? parsed.pathname.split("/").filter(Boolean)[0];
    if (!externalId || ["share", "reel", "watch", "videos"].includes(externalId.toLowerCase())) {
      throw new PlatformProviderError("URL Facebook phải là URL Page, ví dụ https://www.facebook.com/page-name.");
    }
    const body = await this.graph(`/${encodeURIComponent(externalId)}`, { fields: "id,name,username,link" });
    const id = typeof body.id === "string" ? body.id : externalId;
    const handle = typeof body.username === "string" ? body.username : externalId;
    return { platform: this.platform, externalId: id, handle: `@${handle}`, displayName: typeof body.name === "string" ? body.name : handle, url: typeof body.link === "string" ? body.link : `https://www.facebook.com/${handle}` };
  }

  async getRecentVideos(channel: CompetitorChannel): Promise<RecentVideo[]> {
    const body = await this.graph(`/${encodeURIComponent(channel.externalId)}/videos`, { fields: "id,permalink_url,description,created_time,picture", limit: "25" });
    return (body.data ?? []).flatMap((item) => {
      if (typeof item.id !== "string" || typeof item.permalink_url !== "string" || typeof item.created_time !== "string") return [];
      return [{ platform: this.platform, externalId: item.id, url: item.permalink_url, caption: typeof item.description === "string" ? item.description : undefined, thumbnail: typeof item.picture === "string" ? item.picture : undefined, publishedAt: new Date(item.created_time) }];
    });
  }

  async getVideoMetrics(video: RecentVideo): Promise<VideoMetrics> {
    const body = await this.graph(`/${encodeURIComponent(video.externalId)}`, { fields: "views,likes.summary(true),comments.summary(true),shares" });
    const likes = this.summaryCount(body.likes);
    const comments = this.summaryCount(body.comments);
    const shares = this.summaryCount(body.shares);
    return { views: typeof body.views === "number" ? body.views : 0, likes, comments, shares, capturedAt: new Date() };
  }

  private parseUrl(value: string) {
    let parsed: URL;
    try { parsed = new URL(value); } catch { throw new PlatformProviderError("URL Facebook không hợp lệ."); }
    if (parsed.protocol !== "https:" || !HOSTS.has(parsed.hostname.toLowerCase())) throw new PlatformProviderError("URL không thuộc Facebook.");
    return parsed;
  }

  private async graph(path: string, params: Record<string, string>) {
    if (!this.accessToken) throw new PlatformProviderNotConfiguredError("Facebook");
    const url = new URL(`https://graph.facebook.com/${this.version}${path}`);
    url.search = new URLSearchParams({ ...params, access_token: this.accessToken }).toString();
    const response = await fetch(url);
    const body = await response.json() as GraphResponse & { error?: { message?: string } };
    if (!response.ok || body.error) throw new PlatformProviderError(body.error?.message ?? "Facebook Graph API không trả về dữ liệu.", { status: response.status });
    return body;
  }

  private summaryCount(value: unknown) {
    if (typeof value === "number") return value;
    if (value && typeof value === "object" && "summary" in value) {
      const total = (value as { summary?: { total_count?: unknown } }).summary?.total_count;
      return typeof total === "number" ? total : 0;
    }
    return 0;
  }
}
