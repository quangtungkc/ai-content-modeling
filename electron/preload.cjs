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
  scan: (entries) => ipcRenderer.invoke("facebook-browser:scan", entries),
});
