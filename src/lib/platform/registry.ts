import { AppError } from "@/lib/errors";
import { TikTokProvider } from "./tiktok";
import { FacebookProvider } from "./facebook";
import type { CompetitorPlatformProvider } from "./types";

type ProviderFactory = () => CompetitorPlatformProvider;

const providersByHost = new Map<string, ProviderFactory>([
  ["tiktok.com", () => new TikTokProvider(process.env.TIKTOK_ACCESS_TOKEN)],
  ["www.tiktok.com", () => new TikTokProvider(process.env.TIKTOK_ACCESS_TOKEN)],
  ["m.tiktok.com", () => new TikTokProvider(process.env.TIKTOK_ACCESS_TOKEN)],
]);

export function getCompetitorProvider(url: string, accessToken?: string): CompetitorPlatformProvider {
  let hostname: string;
  try { hostname = new URL(url).hostname.toLowerCase(); } catch { throw new AppError("INVALID_COMPETITOR_URL", "Competitor URL không hợp lệ.", 400); }
  const factory = providersByHost.get(hostname);
  if (!factory && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(hostname)) return new FacebookProvider(accessToken);
  if (!factory) throw new AppError("UNSUPPORTED_PLATFORM", "Platform này chưa được hỗ trợ trong MVP.", 400, { hostname });
  return factory();
}
