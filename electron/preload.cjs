/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

function invoke(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).catch((error) => {
    void ipcRenderer.invoke("runtime-error:report", { source: `ipc:${channel}`, message: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
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
  importImages: (projectId, slots) => invoke("gemini-browser:import-images", { projectId, slots }),
  runJob: (projectId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:progress", handler);
    return invoke("gemini-browser:run-job", { projectId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:progress", handler));
  },
  runVideoJob: (projectId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:video-progress", handler);
    return invoke("gemini-browser:run-video-job", { projectId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:video-progress", handler));
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
    return invoke("gemini-browser:run-video-job", { projectId, channelId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:video-progress", handler));
  },
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
