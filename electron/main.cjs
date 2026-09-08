/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = 3210;
const APP_URL = process.env.DESKTOP_APP_URL || (app.isPackaged ? `http://127.0.0.1:${PORT}` : "http://localhost:3000");
let mainWindow;
let serverProcess;
let workerProcess;
let facebookWindow;
let geminiWindow;
let geminiLoadPromise;

function notifyUpdate(event, payload = {}) {
  mainWindow?.webContents.send(`desktop-update:${event}`, payload);
}

function ensureRuntime() {
  const userData = app.getPath("userData");
  const databasePath = path.join(userData, "modeling-ai.db");
  const configPath = path.join(userData, "desktop-config.json");
  const templatePath = path.join(runtimeRoot(), "modeling-ai-template.db");
  if (!fs.existsSync(databasePath)) fs.copyFileSync(templatePath, databasePath);
  let config;
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  } else {
    config = {
      authSecret: crypto.randomBytes(32).toString("hex"),
      credentialEncryptionKey: crypto.randomBytes(32).toString("hex"),
    };
    fs.writeFileSync(configPath, JSON.stringify(config), { encoding: "utf8", mode: 0o600 });
  }
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    PORT: String(PORT),
    HOSTNAME: "127.0.0.1",
    DESKTOP_MODE: "1",
    DATABASE_URL: `file:${databasePath.replace(/\\/g, "/")}`,
    AUTH_SECRET: config.authSecret,
    CREDENTIAL_ENCRYPTION_KEY: config.credentialEncryptionKey,
    GEMINI_MODEL: process.env.GEMINI_MODEL || "gemini-3.6-flash",
    AI_PROVIDER: process.env.AI_PROVIDER || "unconfigured",
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || "v24.0",
  };
}

function runtimeConfigPath() {
  return path.join(app.getPath("userData"), "desktop-config.json");
}

function markSyncAfterUpdate() {
  const configPath = runtimeConfigPath();
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  fs.writeFileSync(configPath, JSON.stringify({ ...config, syncAfterUpdate: true }), { encoding: "utf8", mode: 0o600 });
}

function consumeSyncAfterUpdate() {
  const configPath = runtimeConfigPath();
  if (!fs.existsSync(configPath)) return false;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  if (!config.syncAfterUpdate) return false;
  fs.writeFileSync(configPath, JSON.stringify({ ...config, syncAfterUpdate: false }), { encoding: "utf8", mode: 0o600 });
  return true;
}

function updateDesktopSession(value) {
  const configPath = runtimeConfigPath();
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};
  fs.writeFileSync(configPath, JSON.stringify({ ...config, desktopSession: value }), { encoding: "utf8", mode: 0o600 });
}

function getDesktopSession() {
  const configPath = runtimeConfigPath();
  if (!fs.existsSync(configPath)) return null;
  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  return config.desktopSession && typeof config.desktopSession.token === "string" ? config.desktopSession : null;
}

async function ensureDesktopSession() {
  const existing = getDesktopSession();
  if (existing && new Date(existing.expiresAt).getTime() > Date.now()) return existing;
  try {
    const response = await fetch(`${APP_URL}/api/auth/desktop-session`, { method: "POST" });
    if (!response.ok) return null;
    const body = await response.json();
    const token = body?.data?.token;
    const expiresAt = body?.data?.expiresAt;
    if (typeof token !== "string" || typeof expiresAt !== "string") return null;
    const session = { token, expiresAt };
    updateDesktopSession(session);
    return session;
  } catch {
    return null;
  }
}

function runtimeRoot() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar.unpacked", "electron", "dist")
    : path.join(__dirname, "dist");
}

function startLocalServices() {
  if (!app.isPackaged || process.env.DESKTOP_APP_URL) return;
  const appDirectory = path.join(runtimeRoot(), "app");
  const environment = ensureRuntime();
  const log = fs.openSync(path.join(app.getPath("userData"), "desktop-runtime.log"), "a");
  serverProcess = spawn(process.execPath, [path.join(appDirectory, "server.js")], { cwd: appDirectory, env: environment, windowsHide: true, stdio: ["ignore", log, log] });
  workerProcess = spawn(process.execPath, [path.join(appDirectory, "worker.cjs")], { cwd: appDirectory, env: environment, windowsHide: true, stdio: ["ignore", log, log] });
}

function waitForServer(attempts = 60) {
  return new Promise((resolve, reject) => {
    const check = (remaining) => {
      const request = http.get(`${APP_URL}/api/health`, (response) => {
        response.resume();
        if (response.statusCode && response.statusCode < 500) resolve();
        else if (remaining > 0) setTimeout(() => check(remaining - 1), 500);
        else reject(new Error("Local server did not become ready"));
      });
      request.on("error", () => {
        if (remaining > 0) setTimeout(() => check(remaining - 1), 500);
        else reject(new Error("Local server did not become ready"));
      });
    };
    check(attempts);
  });
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
  markSyncAfterUpdate();
  autoUpdater.quitAndInstall();
});
ipcMain.handle("desktop-auth:save", (_event, value) => {
  if (!value || typeof value.token !== "string" || typeof value.expiresAt !== "string") throw new Error("Phiên đăng nhập không hợp lệ.");
  updateDesktopSession({ token: value.token, expiresAt: value.expiresAt });
  return { status: "saved" };
});
ipcMain.handle("desktop-auth:clear", (event) => {
  updateDesktopSession(null);
  return event.sender.session.cookies.remove(APP_URL, "ai_content_modeling_session").then(() => ({ status: "cleared" }));
});

function createFacebookWindow() {
  if (facebookWindow && !facebookWindow.isDestroyed()) {
    facebookWindow.show();
    facebookWindow.focus();
    return facebookWindow;
  }
  facebookWindow = new BrowserWindow({
    width: 1200,
    height: 850,
    title: "Facebook — Modeling AI",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:modeling-ai-facebook",
    },
  });
  facebookWindow.on("closed", () => { facebookWindow = undefined; });
  void facebookWindow.loadURL("https://www.facebook.com/");
  return facebookWindow;
}

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function scanFacebookPages(entries, onProgress) {
  const browser = createFacebookWindow();
  const results = [];
  onProgress?.({ processed: 0, total: entries.length });
  try {
    for (const [index, entry] of entries.entries()) {
      try {
      const videosUrl = `${entry.url.replace(/\/$/, "")}/videos`;
      await browser.loadURL(videosUrl);
      await delay(2500);
      await browser.webContents.executeJavaScript("window.scrollTo(0, Math.max(document.body.scrollHeight * 0.6, 1400));", true);
      await delay(2500);
      const page = await browser.webContents.executeJavaScript(`
        (() => {
          const currentUrl = window.location.href;
          if (currentUrl.includes("/login") || document.body.innerText.includes("Log in to Facebook")) {
            return { needsLogin: true, items: [] };
          }
          const compactNumber = (value) => {
            if (!value) return null;
            const match = value.match(/([0-9][0-9.,\\s]*)([KMB])?/i);
            if (!match) return null;
            const raw = match[1].replace(/\\s/g, "");
            const number = match[2] ? Number.parseFloat(raw.replace(",", ".")) : Number(raw.replace(/[.,]/g, ""));
            if (!Number.isFinite(number)) return null;
            const multiplier = match[2] === "K" ? 1_000 : match[2] === "M" ? 1_000_000 : match[2] === "B" ? 1_000_000_000 : 1;
            return Math.round(number * multiplier);
          };
          const relativeDate = (text) => {
            const match = text.match(/\\b(\\d+)\\s*(h|giờ|m|phút|d|ngày)\\b/i);
            if (!match) return null;
            const amount = Number(match[1]);
            const unit = match[2].toLowerCase();
            const minutes = unit === "m" || unit === "phút" ? amount : unit === "h" || unit === "giờ" ? amount * 60 : amount * 1440;
            return new Date(Date.now() - minutes * 60_000).toISOString();
          };
          const found = new Map();
          for (const anchor of document.querySelectorAll("a[href]")) {
            const href = anchor.href;
            if (!/\\/(reel|videos|posts)\\//.test(href) && !/watch\\/?\\?v=/.test(href) && !/\\/share\\/r\\//.test(href)) continue;
            if (found.has(href)) continue;
            let container = anchor.closest('[role="article"]');
            if (!container) {
              container = anchor;
              for (let level = 0; level < 6 && container.parentElement; level += 1) {
                if (container.innerText && container.innerText.length > 30) break;
                container = container.parentElement;
              }
            }
            const text = (container?.innerText || anchor.innerText || "").trim();
            if (!text) continue;
            const views = compactNumber(text.match(/([0-9][0-9.,\\s]*[KMB]?)\\s*(?:views|lượt xem)/i)?.[1]);
            const likes = compactNumber(text.match(/([0-9][0-9.,\\s]*[KMB]?)\\s*(?:reactions|likes|lượt thích)/i)?.[1]);
            const comments = compactNumber(text.match(/([0-9][0-9.,\\s]*[KMB]?)\\s*(?:comments|bình luận)/i)?.[1]);
            const shares = compactNumber(text.match(/([0-9][0-9.,\\s]*[KMB]?)\\s*(?:shares|lượt chia sẻ)/i)?.[1]);
            found.set(href, { url: href, caption: text.slice(0, 1000), publishedAt: relativeDate(text), views, likes, comments, shares });
          }
          return { needsLogin: false, items: [...found.values()].slice(0, 10) };
        })()
      `, true);
        results.push({ competitorId: entry.id, sourceUrl: entry.url, ...page });
      } catch (error) {
        results.push({ competitorId: entry.id, sourceUrl: entry.url, needsLogin: false, items: [], error: error instanceof Error ? error.message : "Không thể mở Trang Facebook." });
      }
      onProgress?.({ processed: index + 1, total: entries.length });
    }
  } finally {
    if (!browser.isDestroyed()) browser.close();
  }
  return results;
}

ipcMain.handle("facebook-browser:open", () => {
  createFacebookWindow();
  return { status: "opened" };
});
ipcMain.handle("facebook-browser:scan", async (_event, entries) => {
  if (!Array.isArray(entries)) throw new Error("Danh sách đối thủ không hợp lệ.");
  const validEntries = entries.filter((entry) => entry && typeof entry.id === "string" && typeof entry.url === "string");
  return scanFacebookPages(validEntries, (progress) => _event.sender.send("facebook-browser:scan-progress", progress));
});

ipcMain.handle("gemini-browser:open", async (_event, prompt) => {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Prompt Gemini không hợp lệ.");
  clipboard.writeText(prompt.trim());
  await shell.openExternal("https://gemini.google.com/app");
  return { status: "opened" };
});

ipcMain.handle("gemini-browser:copy", (_event, prompt) => {
  if (typeof prompt !== "string" || !prompt.trim()) throw new Error("Prompt Gemini không hợp lệ.");
  clipboard.writeText(prompt.trim());
  return { status: "copied" };
});

function createGeminiWindow() {
  if (geminiWindow && !geminiWindow.isDestroyed()) {
    geminiWindow.show();
    geminiWindow.focus();
    return geminiWindow;
  }
  geminiWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 700,
    title: "Gemini Ultra — Modeling AI",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:modeling-ai-gemini",
    },
  });
  geminiWindow.on("closed", () => { geminiWindow = undefined; });
  geminiLoadPromise = new Promise((resolve) => geminiWindow.webContents.once("did-finish-load", resolve));
  void geminiWindow.loadURL("https://gemini.google.com/app");
  return geminiWindow;
}

function waitForGeminiLoad(window) {
  if (window.webContents.isLoading() && geminiLoadPromise) return geminiLoadPromise;
  return Promise.resolve();
}

function saveGeminiImage(projectId, slot, dataUrl) {
  const match = /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl);
  if (!match) throw new Error("Gemini không trả về dữ liệu ảnh hợp lệ.");
  const mimeToExtension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif" };
  const extension = mimeToExtension[match[1].toLowerCase()];
  if (!extension) throw new Error(`Định dạng ảnh Gemini chưa được hỗ trợ: ${match[1]}`);
  const imageRoot = path.join(app.getPath("userData"), "generated-images", projectId);
  fs.mkdirSync(imageRoot, { recursive: true });
  const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
  const allowedExtensions = Object.values(mimeToExtension);
  for (const oldExtension of allowedExtensions) {
    const oldTarget = path.join(imageRoot, `${slot.kind}-${sceneNumber}${oldExtension}`);
    if (fs.existsSync(oldTarget)) fs.rmSync(oldTarget);
  }
  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("Ảnh Gemini vượt quá giới hạn 20 MB.");
  fs.writeFileSync(path.join(imageRoot, `${slot.kind}-${sceneNumber}${extension}`), buffer);
  return `/api/v1/projects/${projectId}/images?kind=${slot.kind}&sceneNumber=${sceneNumber}`;
}

ipcMain.handle("gemini-browser:run-job", async (event, value) => {
  const projectId = value?.projectId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu tạo ảnh không hợp lệ.");
  }
  const window = createGeminiWindow();
  await waitForGeminiLoad(window);
  const pageText = await window.webContents.executeJavaScript("document.body?.innerText || ''", true);
  if (/sign in|đăng nhập|log in/i.test(pageText) && /accounts|login/i.test(window.webContents.getURL())) {
    throw new Error("Gemini Ultra chưa đăng nhập trong cửa sổ của app. Hãy đăng nhập một lần rồi chạy lại.");
  }
  const images = {};
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!slot || !["character", "background", "scene"].includes(slot.kind) || typeof slot.prompt !== "string") throw new Error("Prompt ảnh không hợp lệ.");
    event.sender.send("gemini-browser:progress", { processed: index, total: slots.length, label: slot.label ?? `Ảnh ${index + 1}` });
    const script = `(async () => {
      const prompt = ${JSON.stringify(slot.prompt)};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const before = new Set([...document.images].map((image) => image.currentSrc || image.src));
      const input = document.querySelector('textarea, [contenteditable="true"]');
      if (!input) return { error: "Không tìm thấy ô nhập prompt Gemini." };
      input.focus();
      if (input.tagName === "TEXTAREA") {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(input, prompt);
      } else {
        document.execCommand("selectAll", false);
        document.execCommand("insertText", false, prompt);
      }
      input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: prompt }));
      await sleep(300);
      const send = [...document.querySelectorAll('button, [role="button"]')].find((element) => {
        const label = ((element.getAttribute("aria-label") || "") + " " + (element.getAttribute("title") || "") + " " + (element.textContent || "")).toLowerCase();
        return !element.disabled && (label.includes("send") || label.includes("gửi") || label.includes("submit"));
      });
      if (!send) return { error: "Không tìm thấy nút gửi prompt Gemini." };
      send.click();
      for (let elapsed = 0; elapsed < 180000; elapsed += 1500) {
        await sleep(1500);
        const candidates = [...document.images].filter((image) => {
          const source = image.currentSrc || image.src;
          return source && !before.has(source) && (image.naturalWidth || image.width) >= 256 && (image.naturalHeight || image.height) >= 256;
        });
        const image = candidates[candidates.length - 1];
        if (image) {
          try {
            const response = await fetch(image.currentSrc || image.src);
            const blob = await response.blob();
            const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
            return { dataUrl };
          } catch { return { error: "Không thể đọc ảnh Gemini vừa tạo." }; }
        }
      }
      return { error: "Gemini không tạo ảnh trong thời gian chờ 180 giây." };
    })()`;
    const result = await window.webContents.executeJavaScript(script, true);
    if (!result?.dataUrl) throw new Error(result?.error ?? "Không thể tạo ảnh trên Gemini Ultra.");
    const url = saveGeminiImage(projectId, slot, result.dataUrl);
    images[`${slot.kind}-${Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0}`] = `${url}&v=${Date.now()}`;
    event.sender.send("gemini-browser:progress", { processed: index + 1, total: slots.length, label: slot.label ?? `Ảnh ${index + 1}` });
  }
  return { status: "completed", images };
});

ipcMain.handle("gemini-browser:import-images", async (_event, value) => {
  const projectId = value?.projectId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu nhập ảnh không hợp lệ.");
  }
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: `Chọn ${slots.length} ảnh theo đúng thứ tự`,
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Tất cả tệp hình ảnh", extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"] }],
  });
  if (selection.canceled) return { status: "cancelled", images: {} };
  if (selection.filePaths.length !== slots.length) throw new Error(`Hãy chọn đúng ${slots.length} ảnh theo thứ tự đã hiển thị.`);
  const imageRoot = path.join(app.getPath("userData"), "generated-images", projectId);
  fs.mkdirSync(imageRoot, { recursive: true });
  const allowedExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]);
  const allowedKinds = new Set(["character", "background", "scene"]);
  const images = {};
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const source = selection.filePaths[index];
    if (!slot || !allowedKinds.has(slot.kind)) throw new Error("Loại ảnh không hợp lệ.");
    const extension = path.extname(source).toLowerCase();
    if (!allowedExtensions.has(extension)) throw new Error("Định dạng ảnh chưa được hỗ trợ.");
    const stat = fs.statSync(source);
    if (stat.size > 20 * 1024 * 1024) throw new Error("Mỗi ảnh phải nhỏ hơn 20 MB.");
    const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
    for (const oldExtension of allowedExtensions) {
      const oldTarget = path.join(imageRoot, `${slot.kind}-${sceneNumber}${oldExtension}`);
      if (fs.existsSync(oldTarget)) fs.rmSync(oldTarget);
    }
    const targetName = `${slot.kind}-${sceneNumber}${extension}`;
    fs.copyFileSync(source, path.join(imageRoot, targetName));
    images[`${slot.kind}-${sceneNumber}`] = `/api/v1/projects/${projectId}/images?kind=${slot.kind}&sceneNumber=${sceneNumber}`;
  }
  return { status: "imported", images };
});

async function createWindow(syncAfterUpdate = false) {
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
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow = window;
  const desktopSession = await ensureDesktopSession();
  if (desktopSession) {
    await window.webContents.session.cookies.set({
      url: APP_URL,
      name: "ai_content_modeling_session",
      value: desktopSession.token,
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      expirationDate: new Date(desktopSession.expiresAt).getTime() / 1000,
    });
  }
  const url = syncAfterUpdate ? `${APP_URL}/?autoSync=1` : APP_URL;
  void window.loadURL(url);
}

app.whenReady().then(async () => {
  startLocalServices();
  await waitForServer();
  await createWindow(consumeSyncAfterUpdate());
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  serverProcess?.kill();
  workerProcess?.kill();
});
