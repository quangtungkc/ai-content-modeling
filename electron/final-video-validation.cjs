function validateFinalVideoProbe(output) {
  const text = String(output || "");
  const duration = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  const seconds = duration ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3]) : 0;
  const video = text.match(/Video:\s*h264\b[^\r\n]*?\b(\d{2,5})x(\d{2,5})\b/i);
  const audio = /Audio:\s*aac\b/i.test(text);
  if (!Number.isFinite(seconds) || seconds <= 0.1 || !video || Number(video[1]) !== 720 || Number(video[2]) !== 1280 || !audio) {
    throw new Error("FINAL_MEDIA_VALIDATION_FAILED: video cuối phải là MP4 H.264/AAC 720x1280 với thời lượng hợp lệ.");
  }
  return { durationSec: seconds, width: Number(video[1]), height: Number(video[2]), videoCodec: "h264", audioCodec: "aac" };
}

module.exports = { validateFinalVideoProbe };
