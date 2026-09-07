import { AppError } from "@/lib/errors";

export type SupportedPlatform = "TikTok" | "YouTube" | "Facebook";
export type NormalizedCompetitor = { platform: SupportedPlatform; url: string; externalId: string; handle: string };

type PlatformRule = { platform: SupportedPlatform; hosts: Set<string>; pathPattern: RegExp; buildUrl: (handle: string) => string };
const rules: PlatformRule[] = [
  { platform: "TikTok", hosts: new Set(["tiktok.com", "www.tiktok.com", "m.tiktok.com"]), pathPattern: /^\/@([^/]+)\/?$/, buildUrl: (handle) => `https://www.tiktok.com/@${handle}` },
  { platform: "YouTube", hosts: new Set(["youtube.com", "www.youtube.com"]), pathPattern: /^\/@([^/]+)\/?$/, buildUrl: (handle) => `https://www.youtube.com/@${handle}` },
  { platform: "Facebook", hosts: new Set(["facebook.com", "www.facebook.com", "m.facebook.com"]), pathPattern: /^\/([^/?]+)\/?$/, buildUrl: (handle) => `https://www.facebook.com/${handle}` },
];

export function normalizeCompetitorUrl(input: string): NormalizedCompetitor {
  let parsed: URL;
  try { parsed = new URL(input.trim()); } catch { throw new AppError("INVALID_COMPETITOR_URL", "Competitor URL không hợp lệ.", 400); }
  if (parsed.protocol !== "https:") throw new AppError("INVALID_COMPETITOR_URL", "Competitor URL phải dùng HTTPS.", 400);
  const rule = rules.find((candidate) => candidate.hosts.has(parsed.hostname.toLowerCase()));
  if (!rule) throw new AppError("UNSUPPORTED_PLATFORM", "Platform này chưa được hỗ trợ trong MVP.", 400);
  const handle = parsed.pathname.match(rule.pathPattern)?.[1];
  if (!handle) throw new AppError("INVALID_COMPETITOR_URL", `URL ${rule.platform} chưa có định danh Page/Channel hợp lệ.`, 400);
  const normalizedHandle = handle.toLowerCase();
  return { platform: rule.platform, url: rule.buildUrl(normalizedHandle), externalId: normalizedHandle, handle: `@${normalizedHandle}` };
}
