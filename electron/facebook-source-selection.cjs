function facebookVideoIdentity(value) {
  try {
    const url = new URL(value);
    if (!/(^|\.)facebook\.com$/i.test(url.hostname)) return null;
    const path = url.pathname.match(/^\/(?:reel|videos|posts)\/(\d+)\/?$/i);
    if (path) return path[1];
    if (/^\/watch\/?$/i.test(url.pathname)) return url.searchParams.get("v") || null;
  } catch { /* Invalid URLs are not video identities. */ }
  return null;
}

function isVideoBoundToFacebookReel(video, reelId) {
  if (!video || !reelId) return false;
  for (let node = video.parentElement, level = 0; node && level < 12; node = node.parentElement, level += 1) {
    const videoCount = node.querySelectorAll?.("video").length;
    if (videoCount !== 1) return false;
    if (node.outerHTML?.includes(reelId)) return true;
  }
  return false;
}

function selectFacebookSourceVideo(candidates, currentUrl, expectedUrl) {
  const expectedId = facebookVideoIdentity(expectedUrl);
  if (!expectedId || facebookVideoIdentity(currentUrl) !== expectedId) return { index: null, error: "SOURCE_VIDEO_PAGE_MISMATCH" };
  const centered = candidates.filter((item) => {
    const rect = item.rect;
    return item.connected && item.visible && item.boundToReel && rect && rect.width >= 64 && rect.height >= 64
      && rect.x + rect.width / 2 >= 0 && rect.x + rect.width / 2 < item.viewportWidth
      && rect.y + rect.height / 2 >= 0 && rect.y + rect.height / 2 < item.viewportHeight;
  });
  if (centered.length !== 1) return { index: null, error: centered.length ? "SOURCE_VIDEO_VISIBLE_AMBIGUOUS" : "SOURCE_VIDEO_TARGET_NOT_VISIBLE" };
  const selected = centered[0];
  if (!selected.ready || !selected.durationSec) return { index: null, error: "SOURCE_VIDEO_TARGET_NOT_READY" };
  return { index: selected.index, durationSec: selected.durationSec, error: null };
}

module.exports = { facebookVideoIdentity, isVideoBoundToFacebookReel, selectFacebookSourceVideo };
