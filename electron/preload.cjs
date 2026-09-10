/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopApp", {
  getVersion: () => ipcRenderer.invoke("desktop-app:version"),
});

contextBridge.exposeInMainWorld("desktopUpdater", {
  check: () => ipcRenderer.invoke("desktop-update:check"),
  download: () => ipcRenderer.invoke("desktop-update:download"),
  install: () => ipcRenderer.invoke("desktop-update:install"),
  on: (event, listener) => {
    const channel = `desktop-update:${event}`;
    const handler = (_ipcEvent, payload) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});

contextBridge.exposeInMainWorld("desktopFacebook", {
  open: () => ipcRenderer.invoke("facebook-browser:open"),
  scan: (entries, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("facebook-browser:scan-progress", handler);
    return ipcRenderer.invoke("facebook-browser:scan", entries).finally(() => ipcRenderer.removeListener("facebook-browser:scan-progress", handler));
  },
});

contextBridge.exposeInMainWorld("desktopGemini", {
  open: (prompt) => ipcRenderer.invoke("gemini-browser:open", prompt),
  openFlow: () => ipcRenderer.invoke("gemini-browser:open-flow"),
  copy: (prompt) => ipcRenderer.invoke("gemini-browser:copy", prompt),
  importImages: (projectId, slots) => ipcRenderer.invoke("gemini-browser:import-images", { projectId, slots }),
  runJob: (projectId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:progress", handler);
    return ipcRenderer.invoke("gemini-browser:run-job", { projectId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:progress", handler));
  },
  runVideoJob: (projectId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:video-progress", handler);
    return ipcRenderer.invoke("gemini-browser:run-video-job", { projectId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:video-progress", handler));
  },
});

contextBridge.exposeInMainWorld("desktopFlow", {
  open: () => ipcRenderer.invoke("gemini-browser:open-flow"),
  runImageJob: (projectId, channelId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("flow-browser:image-progress", handler);
    return ipcRenderer.invoke("flow-browser:run-image-job", { projectId, channelId, slots }).finally(() => ipcRenderer.removeListener("flow-browser:image-progress", handler));
  },
  runVideoJob: (projectId, channelId, slots, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("gemini-browser:video-progress", handler);
    return ipcRenderer.invoke("gemini-browser:run-video-job", { projectId, channelId, slots }).finally(() => ipcRenderer.removeListener("gemini-browser:video-progress", handler));
  },
});

contextBridge.exposeInMainWorld("desktopVideoEditor", {
  pickAudio: () => ipcRenderer.invoke("video-editor:pick-audio"),
  renderFinal: (projectId, sceneNumbers, options, onProgress) => {
    const handler = (_event, progress) => onProgress?.(progress);
    ipcRenderer.on("video-editor:progress", handler);
    return ipcRenderer.invoke("video-editor:render-final", { projectId, sceneNumbers, options }).finally(() => ipcRenderer.removeListener("video-editor:progress", handler));
  },
});

contextBridge.exposeInMainWorld("desktopAuth", {
  save: (token, expiresAt) => ipcRenderer.invoke("desktop-auth:save", { token, expiresAt }),
  clear: () => ipcRenderer.invoke("desktop-auth:clear"),
});
