/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");

const APP_URL = process.env.DESKTOP_APP_URL || "https://ai-content-modeling.vercel.app/";
let mainWindow;

function notifyUpdate(event, payload = {}) {
  mainWindow?.webContents.send(`desktop-update:${event}`, payload);
}

autoUpdater.autoDownload = false;
autoUpdater.on("update-available", (info) => notifyUpdate("available", { version: info.version }));
autoUpdater.on("update-not-available", () => notifyUpdate("not-available"));
autoUpdater.on("download-progress", (progress) => notifyUpdate("progress", { percent: Math.round(progress.percent) }));
autoUpdater.on("update-downloaded", () => notifyUpdate("downloaded"));
autoUpdater.on("error", (error) => notifyUpdate("error", { message: error.message }));

ipcMain.handle("desktop-update:check", async () => {
  if (!app.isPackaged) return { status: "dev" };
  try {
    const result = await autoUpdater.checkForUpdates();
    return { status: result?.updateInfo.version === app.getVersion() ? "not-available" : "checking" };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Không thể kiểm tra cập nhật." };
  }
});
ipcMain.handle("desktop-update:download", async () => {
  await autoUpdater.downloadUpdate();
  return { status: "downloading" };
});
ipcMain.handle("desktop-update:install", () => {
  autoUpdater.quitAndInstall();
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    backgroundColor: "#f4f7fb",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: require("path").join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow = window;
  void window.loadURL(APP_URL);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
