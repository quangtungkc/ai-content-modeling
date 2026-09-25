const RECENT_VIDEO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function findFacebookVideoCard(anchor) {
  let node = anchor;
  for (let level = 0; level < 12 && node; level += 1, node = node.parentElement) {
    if (!node.querySelector?.("time, abbr, [data-utime]")) continue;
    const videoPaths = new Set([...node.querySelectorAll("a[href]")].flatMap((link) => {
      try {
        const url = new URL(link.href);
        const match = url.pathname.match(/\/(?:reel|videos|posts)\/(\d+)\/?$/i);
        return match ? [match[1]] : [];
      } catch { return []; }
    }));
    if (videoPaths.size === 1) return node;
    if (videoPaths.size > 1) return null;
  }
  return null;
}

function verifiedFacebookPublishedAt(container, nowMs = Date.now()) {
  if (!container || !Number.isFinite(nowMs)) return null;
  const windowMs = 7 * 24 * 60 * 60 * 1000;
  const cutoff = nowMs - windowMs;
  const parseRelative = (value) => {
    const text = String(value || "").trim().toLowerCase();
    if (/^(vừa xong|just now|hôm nay|today)$/.test(text)) return nowMs;
    if (/^(hôm qua|yesterday)(?:\s+(?:lúc|at)\s+.+)?$/.test(text)) return nowMs - 86_400_000;
    const match = text.match(/^(?:about\s+|khoảng\s+)?(\d+)\s*(seconds?|secs?|s|minutes?|mins?|phút|m|hours?|hrs?|giờ|h|days?|ngày|d|weeks?|tuần|w)(?:\s+ago|\s+trước)?$/i);
    if (!match) return null;
    const count = Number(match[1]);
    const unit = match[2];
    if (!Number.isSafeInteger(count) || count < 0) return null;
    const multiplier = /^(seconds?|secs?|s)$/.test(unit) ? 1_000
      : /^(minutes?|mins?|phút|m)$/.test(unit) ? 60_000
        : /^(hours?|hrs?|giờ|h)$/.test(unit) ? 3_600_000
          : /^(days?|ngày|d)$/.test(unit) ? 86_400_000
            : 604_800_000;
    // A rounded "7 days" or "1 week" label cannot prove the post is inside
    // the seven-day window, even when the displayed value equals the limit.
    if (count * multiplier >= windowMs) return cutoff - 1;
    return nowMs - count * multiplier;
  };
  const parseAbsolute = (value) => {
    const text = String(value || "").trim();
    if (!text || /^\d+$/.test(text)) return null;
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const nodes = [...container.querySelectorAll("time, abbr, [data-utime], a[aria-label], a[title]")];
  for (const node of nodes) {
    const unixValue = node.getAttribute("data-utime");
    const unix = unixValue === null ? NaN : Number(unixValue);
    if (Number.isFinite(unix) && unix > 0) {
      const milliseconds = unix < 1e12 ? unix * 1_000 : unix;
      return milliseconds >= cutoff && milliseconds <= nowMs ? new Date(milliseconds).toISOString() : null;
    }
    for (const attribute of ["datetime", "title", "aria-label"]) {
      const value = node.getAttribute(attribute);
      if (!value) continue;
      const date = parseAbsolute(value) || parseRelative(value);
      if (date !== null) return date >= cutoff && date <= nowMs ? new Date(date).toISOString() : null;
    }
    if (node.matches("time, abbr")) {
      const date = parseRelative(node.textContent) || parseAbsolute(node.textContent);
      if (date !== null) return date >= cutoff && date <= nowMs ? new Date(date).toISOString() : null;
    }
  }
  return null;
}

module.exports = { RECENT_VIDEO_WINDOW_MS, findFacebookVideoCard, verifiedFacebookPublishedAt };
