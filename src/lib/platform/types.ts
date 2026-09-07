export type Platform = "tiktok" | "facebook";

export type CompetitorChannel = {
  platform: Platform;
  externalId: string;
  handle: string;
  displayName: string;
  avatar?: string;
  url: string;
};

export type RecentVideo = {
  platform: Platform;
  externalId: string;
  url: string;
  caption?: string;
  thumbnail?: string;
  publishedAt: Date;
  durationSec?: number;
};

export type VideoMetrics = {
  views: number;
  likes: number;
  comments: number;
  shares?: number;
  capturedAt: Date;
};

export interface CompetitorPlatformProvider {
  readonly platform: Platform;
  resolveChannel(url: string): Promise<CompetitorChannel>;
  getRecentVideos(channel: CompetitorChannel): Promise<RecentVideo[]>;
  getVideoMetrics(video: RecentVideo): Promise<VideoMetrics>;
}
