const INVOKE_CHANNELS = Object.freeze([
  "desktop-app:version", "desktop-auth:clear", "desktop-auth:save", "desktop-update:check", "desktop-update:download", "desktop-update:install",
  "facebook-browser:open", "facebook-browser:scan", "facebook-browser:scan-following", "flow-browser:prepare-manual-submission", "flow-browser:resume-after-manual-submission", "flow-browser:run-image-job",
  "gemini-browser:analyze-source", "gemini-browser:copy", "gemini-browser:develop-project", "gemini-browser:generate-idea", "gemini-browser:import-images", "gemini-browser:open", "gemini-browser:open-flow", "gemini-browser:run-job", "gemini-browser:run-video-job",
  "runtime-error:report", "video-editor:pick-audio", "video-editor:render-final",
]);
const invokeChannelSet = new Set(INVOKE_CHANNELS);
function assertKnownInvokeChannel(channel) {
  if (typeof channel !== "string" || !invokeChannelSet.has(channel)) throw new Error(`IPC_CHANNEL_NOT_ALLOWED: ${String(channel)}`);
  return channel;
}
function isAllowedExternalUrl(value) {
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:"; } catch { return false; }
}
module.exports = { INVOKE_CHANNELS, assertKnownInvokeChannel, isAllowedExternalUrl };
