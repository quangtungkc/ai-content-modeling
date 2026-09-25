export const RECENT_VIDEO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function isRecentVideoPublishedAt(value: Date | string | null | undefined, nowMs = Date.now()): boolean {
  if (!value) return false;
  const publishedAt = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(publishedAt) && publishedAt >= nowMs - RECENT_VIDEO_WINDOW_MS && publishedAt <= nowMs;
}
