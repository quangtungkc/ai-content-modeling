/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");
// Electron runs this preload in a sandbox. Local CommonJS imports are not
// available there, so keep the invoke allow-list self-contained in the
// preload while the main process continues to use ipc-contract.cjs.
const INVOKE_CHANNELS = Object.freeze([
  "desktop-app:version", "desktop-auth:clear", "desktop-auth:save", "desktop-update:check", "desktop-update:download", "desktop-update:install",
  "facebook-browser:open", "facebook-browser:scan", "flow-browser:prepare-manual-submission", "flow-browser:resume-after-manual-submission", "flow-browser:run-image-job",
  "gemini-browser:analyze-source", "gemini-browser:copy", "gemini-browser:develop-project", "gemini-browser:generate-idea", "gemini-browser:import-images", "gemini-browser:open", "gemini-browser:open-flow", "gemini-browser:run-job", "gemini-browser:run-video-job",
  "runtime-error:report", "video-editor:pick-audio", "video-editor:render-final",
]);
const invokeChannelSet = new Set(INVOKE_CHANNELS);
function assertKnownInvokeChannel(channel) {
  if (typeof channel !== "string" || !invokeChannelSet.has(channel)) throw new Error(`IPC_CHANNEL_NOT_ALLOWED: ${String(channel)}`);
  return channel;
}

function reviveStructuredError(payload) {
  const error = new Error(typeof payload?.message === "string" ? payload.message : "Desktop Gemini request failed.");
  error.name = "DesktopStructuredError";
  if (payload && typeof payload === "object") Object.assign(error, payload);
  return error;
}

function invoke(channel, ...args) {
  assertKnownInvokeChannel(channel);
  return ipcRenderer.invoke(channel, ...args).catch((error) => {
    void ipcRenderer.invoke("runtime-error:report", { source: `ipc:${channel}`, message: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
    throw error;
  });
}

function invokeStructured(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).then((result) => {
    if (result && result.ok === false && result.error) throw reviveStructuredError(result.error);
    if (result && result.ok === true && Object.prototype.hasOwnProperty.call(result, "data")) return result.data;
    return result;
  }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const context = error && typeof error === "object" && error.details && typeof error.details === "object" ? error.details : undefined;
    void ipcRenderer.invoke("runtime-error:report", { source: `ipc:${channel}`, message, code: error?.code, context }).catch(() => undefined);
    throw error;
  });
}

contextBridge.exposeInMainWorld("desktopApp", {
  getVersion: () => invoke("desktop-app:version"),
});

contextBridge.exposeInMainWorld("desktopUpdater", {
  check: () => invoke("desktop-update:check"),
  download: () => invoke("desktop-update:download"),
  install: () => invoke("desktop-update:install"),
  on: (event, listener) => {
    const channel = `desktop-update:${event}`;
    const handler = (_ipcEvent, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

contextBridge.exposeInMainWorld("desktopFacebook", {
  open: () => invoke("facebook-browser:open"),
  scan: (entries, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("facebook-browser:scan-progress", handler);
    return invoke("facebook-browser:scan", entries).finally(() => ipcRenderer.removeListener("facebook-browser:scan-progress", handler));
  },
});

contextBridge.exposeInMainWorld("desktopGemini", {
  open: (prompt) => invoke("gemini-browser:open", prompt),
  openFlow: () => invoke("gemini-browser:open-flow"),
  copy: (prompt) => invoke("gemini-browser:copy", prompt),
  analyzeSource: (video, channelDNA, runId) => invoke("gemini-browser:analyze-source", { video, channelDNA, runId }),
  generateIdea: (video, analysis, channelDNA, artStyle, runId) => invoke("gemini-browser:generate-idea", { video, analysis, channelDNA, artStyle, runId }),
  developProject: (video, analysis, idea, channelDNA, aspectRatio, runId) => invokeStructured("gemini-browser:develop-project", { video, analysis, idea, channelDNA, aspectRatio, runId }),
  importImages: (projectId, slots) => invoke("gemini-browser:import-images", { projectId, slots }),
  runJob: (projectId, slots, onProgress, runId) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:progress", handler);
    return invoke("gemini-browser:run-job", { projectId, slots, runId }).finally(() => ipcRenderer.removeListener("gemini-browser:progress", handler));
  },
  runVideoJob: (projectId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:video-progress", handler);
    return invokeStructured("gemini-browser:run-video-job", { projectId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:video-progress", handler));
  },
});

contextBridge.exposeInMainWorld("desktopFlow", {
  open: () => invoke("gemini-browser:open-flow"),
  runImageJob: (projectId, channelId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("flow-browser:image-progress", handler);
    return invoke("flow-browser:run-image-job", { projectId, channelId, slots }).finally(() => ipcRenderer.removeListener("flow-browser:image-progress", handler));
  },
  runVideoJob: (projectId, channelId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:video-progress", handler);
    return invokeStructured("gemini-browser:run-video-job", { projectId, channelId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:video-progress", handler));
  },
  resumeAfterManualSubmission: (checkpointId) => invoke("flow-browser:resume-after-manual-submission", { checkpointId }),
  prepareManualSubmission: (projectId, channelId, slot) => invoke("flow-browser:prepare-manual-submission", { projectId, channelId, slot }),
});

contextBridge.exposeInMainWorld("desktopVideoEditor", {
  pickAudio: () => invoke("video-editor:pick-audio"),
  renderFinal: (projectId, sceneNumbers, options, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("video-editor:progress", handler);
    return invoke("video-editor:render-final", { projectId, sceneNumbers, options }).finally(() => ipcRenderer.removeListener("video-editor:progress", handler));
  },
});

contextBridge.exposeInMainWorld("desktopAuth", {
  save: (token, expiresAt) => invoke("desktop-auth:save", { token, expiresAt }),
  clear: () => invoke("desktop-auth:clear"),
});
