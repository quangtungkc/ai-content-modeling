/* eslint-disable @typescript-eslint/no-require-imports */
const { contextBridge, ipcRenderer } = require("electron");

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

contextBridge.exposeInMainWorld("desktopAuth", {
  save: (token, expiresAt) => ipcRenderer.invoke("desktop-auth:save", { token, expiresAt }),
  clear: () => ipcRenderer.invoke("desktop-auth:clear"),
});
