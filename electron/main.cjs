/* eslint-disable @typescript-eslint/no-require-imports */
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

// Keep development Electron and the packaged desktop app on the same local data store.
app.setPath("userData", path.join(app.getPath("appData"), "ai-content-modeling"));

const PORT = 3210;
const APP_URL = process.env.DESKTOP_APP_URL || (app.isPackaged ? `http://127.0.0.1:${PORT}` : "http://localhost:3000");
let mainWindow;
let serverProcess;
let workerProcess;
let facebookWindow;
let geminiWindow;
let geminiLoadPromise;
let flowWindow;
let flowLoadPromise;

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

function createFlowWindow() {
  if (flowWindow && !flowWindow.isDestroyed()) {
    flowWindow.show();
    flowWindow.focus();
    return flowWindow;
  }
  flowWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 960,
    minHeight: 700,
    title: "Google Flow — Modeling AI",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: "persist:modeling-ai-gemini",
    },
  });
  flowWindow.on("closed", () => { flowWindow = undefined; });
  flowLoadPromise = new Promise((resolve) => flowWindow.webContents.once("did-finish-load", resolve));
  void flowWindow.loadURL("https://flow.google.com/?pli=1");
  return flowWindow;
}

function waitForGeminiLoad(window) {
  if (window.webContents.isLoading() && geminiLoadPromise) return geminiLoadPromise;
  return Promise.resolve();
}

async function waitForFlowLoad(window) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    if (window.isDestroyed()) throw new Error("Cửa sổ Google Flow đã bị đóng.");
    try {
      const state = await window.webContents.executeJavaScript(`(() => ({ readyState: document.readyState, url: window.location.href }))()`, true);
      if (state?.url?.includes("accounts.google.com")) {
        throw new Error("Google Flow yêu cầu đăng nhập. Hãy đăng nhập trong cửa sổ Flow rồi chạy lại.");
      }
      if (state?.url?.includes("flow.google.com") && state.readyState !== "loading") return;
    } catch (error) {
      if (error instanceof Error && error.message.includes("Google Flow yêu cầu đăng nhập")) throw error;
    }
    await delay(500);
  }
  throw new Error("Google Flow mở quá lâu hoặc chưa tải xong. Hãy kiểm tra kết nối và trạng thái đăng nhập rồi thử lại.");
}

async function reloadGeminiBeforeNextPrompt(window) {
  if (window.isDestroyed()) throw new Error("Cửa sổ Gemini đã bị đóng trước khi gửi prompt tiếp theo.");
  const conversationUrl = window.webContents.getURL();
  geminiLoadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Gemini tải lại quá lâu trước khi gửi prompt tiếp theo.")), 45_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timeout); resolve(); });
  });
  window.webContents.reload();
  await geminiLoadPromise;
  if (conversationUrl.includes("gemini.google.com/app/") && !window.webContents.getURL().includes("gemini.google.com/app/")) {
    geminiLoadPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Không thể quay lại cuộc trò chuyện Gemini hiện tại sau khi tải lại.")), 45_000);
      window.webContents.once("did-finish-load", () => { clearTimeout(timeout); resolve(); });
    });
    await window.webContents.loadURL(conversationUrl);
    await geminiLoadPromise;
  }
  await delay(1_500);
  for (let elapsed = 0; elapsed < 20_000; elapsed += 500) {
    const ready = await window.webContents.executeJavaScript(`(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).find((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.width > 100 && bounds.height > 20;
      });
      if (!input || window.location.href.includes('accounts.google.com')) return false;
      return true;
    })()`, true);
    if (!ready) {
      await delay(500);
      continue;
    }
    await delay(800);
    return;
  }
  throw new Error("Gemini đã tải lại nhưng chưa sẵn sàng nhận prompt tiếp theo.");
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

function saveFlowImage(projectId, slot, buffer, mimeType = "image/png") {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) throw new Error("Google Flow không trả về ảnh hợp lệ.");
  if (buffer.length > 20 * 1024 * 1024) throw new Error("Ảnh Google Flow vượt quá giới hạn 20 MB.");
  const mimeToExtension = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/bmp": ".bmp", "image/avif": ".avif" };
  const extension = mimeToExtension[mimeType.toLowerCase()] || ".png";
  const imageRoot = path.join(app.getPath("userData"), "generated-images", projectId);
  fs.mkdirSync(imageRoot, { recursive: true });
  const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
  for (const oldExtension of Object.values(mimeToExtension)) {
    const oldTarget = path.join(imageRoot, `${slot.kind}-${sceneNumber}${oldExtension}`);
    if (fs.existsSync(oldTarget)) fs.rmSync(oldTarget);
  }
  fs.writeFileSync(path.join(imageRoot, `${slot.kind}-${sceneNumber}${extension}`), buffer);
  return `/api/v1/projects/${projectId}/images?kind=${slot.kind}&sceneNumber=${sceneNumber}`;
}

function findGeneratedImagePath(projectId, kind, sceneNumber = 0) {
  const imageRoot = path.join(app.getPath("userData"), "generated-images", projectId);
  for (const extension of [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".avif"]) {
    const target = path.join(imageRoot, `${kind}-${sceneNumber}${extension}`);
    if (fs.existsSync(target)) return target;
  }
  throw new Error(`Chưa có ảnh ${kind === "character" ? "nhân vật" : `cảnh ${sceneNumber}`}.`);
}

function findSceneImagePath(projectId, sceneNumber) {
  return findGeneratedImagePath(projectId, "scene", sceneNumber);
}

function saveGeminiVideo(projectId, sceneNumber, buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1024) throw new Error("Google Flow không trả về video hợp lệ.");
  if (buffer.length > 200 * 1024 * 1024) throw new Error("Video Google Flow vượt quá giới hạn 200 MB.");
  const videoRoot = path.join(app.getPath("userData"), "generated-videos", projectId);
  fs.mkdirSync(videoRoot, { recursive: true });
  fs.writeFileSync(path.join(videoRoot, `scene-${sceneNumber}.mp4`), buffer);
  return `/api/v1/projects/${projectId}/videos?sceneNumber=${sceneNumber}`;
}

function findFfmpegPath() {
  const configured = process.env.MODELING_AI_FFMPEG_PATH;
  if (configured && fs.existsSync(configured)) return configured;

  const bundled = path.join(process.resourcesPath || "", "ffmpeg", "ffmpeg.exe");
  if (fs.existsSync(bundled)) return bundled;

  const capCutApps = path.join(process.env.LOCALAPPDATA || "", "CapCut", "Apps");
  if (fs.existsSync(capCutApps)) {
    const candidates = fs.readdirSync(capCutApps, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(capCutApps, entry.name, "ffmpeg.exe"))
      .filter((candidate) => fs.existsSync(candidate))
      .sort()
      .reverse();
    if (candidates[0]) return candidates[0];
  }
  throw new Error("Chưa tìm thấy bộ xử lý video. Hãy cài CapCut hoặc liên hệ hỗ trợ để cài runtime video.");
}

function runFfmpeg(args, allowFailure = false) {
  const executable = findFfmpegPath();
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || allowFailure) return resolve(output);
      const detail = output.trim().slice(-1200);
      reject(new Error(`Không thể xuất video. ${detail || `FFmpeg dừng với mã ${code}.`}`));
    });
  });
}

async function renderFinalVideo(event, projectId, sceneNumbers) {
  const videoRoot = path.join(app.getPath("userData"), "generated-videos", projectId);
  const sourceFiles = sceneNumbers.map((sceneNumber) => path.join(videoRoot, `scene-${sceneNumber}.mp4`));
  for (const source of sourceFiles) {
    if (!fs.existsSync(source) || fs.statSync(source).size < 1024) throw new Error("Thiếu video của một hoặc nhiều phân cảnh. Hãy tạo lại cảnh bị thiếu trước khi ghép.");
  }

  const finalPath = path.join(videoRoot, "final.mp4");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "modeling-ai-edit-"));
  try {
    event.sender.send("video-editor:progress", { stage: "normalize", processed: 0, total: sourceFiles.length, label: "Đang chuẩn hóa video..." });
    const normalized = [];
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const target = path.join(temporaryRoot, `scene-${index + 1}.mp4`);
      await runFfmpeg(["-y", "-hide_banner", "-i", sourceFiles[index], "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30", "-c:v", "h264_mf", "-b:v", "4500k", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target]);
      normalized.push(target);
      event.sender.send("video-editor:progress", { stage: "normalize", processed: index + 1, total: sourceFiles.length, label: `Đã chuẩn hóa cảnh ${sceneNumbers[index]}.` });
    }

    event.sender.send("video-editor:progress", { stage: "render", processed: 0, total: 1, label: "Đang ghép các phân cảnh..." });
    if (normalized.length === 1) {
      fs.copyFileSync(normalized[0], finalPath);
    } else {
      const playlistPath = path.join(temporaryRoot, "playlist.txt");
      fs.writeFileSync(playlistPath, normalized.map((file) => `file '${file.replace(/'/g, "'\\\\''")}'`).join("\n"), "utf8");
      await runFfmpeg(["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", playlistPath, "-c", "copy", "-movflags", "+faststart", finalPath]);
    }
    if (!fs.existsSync(finalPath) || fs.statSync(finalPath).size < 1024) throw new Error("Video cuối không hợp lệ sau khi xuất.");
    event.sender.send("video-editor:progress", { stage: "completed", processed: 1, total: 1, label: "Đã xuất video hoàn chỉnh." });
    return { status: "completed", video: `/api/v1/projects/${projectId}/videos?final=1&v=${Date.now()}` };
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

async function dispatchBrowserClick(window, point) {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  window.show();
  window.focus();
  window.webContents.focus();
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await delay(120);
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await delay(70);
  await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function findFlowControlPoint(window, labels, exact = false) {
  const expression = [
    "(() => {",
    "  const wanted = " + JSON.stringify(labels) + ".map((value) => value.toLowerCase().replace(/\\s+/g, ' ').trim());",
    "  const exactMatch = " + JSON.stringify(exact) + ";",
    "  const roots = [document];",
    "  const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) {",
    "    for (const element of roots[index].querySelectorAll('*')) {",
    "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
    "    }",
    "  }",
    "  const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase()).filter(Boolean);",
    "  const isVisible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };",
    "  const candidates = roots.flatMap((root) => [...root.querySelectorAll('button, [role=\"button\"], [role=\"menuitem\"], [role=\"option\"], [role=\"radio\"], a')]).filter((element) => !element.disabled && isVisible(element));",
    "  const matches = candidates.filter((element) => { const labels = labelsFor(element); return exactMatch ? labels.some((label) => wanted.some((value) => label === value || label.startsWith(value + ' ') || label.endsWith(value))) : labels.some((label) => wanted.some((value) => label === value || label.includes(value))); });",
    "  const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable=\"true\"]')]).find(isVisible);",
    "  const inputBounds = input?.getBoundingClientRect();",
    "  const score = (element) => { const labels = labelsFor(element); const exactRank = labels.some((label) => wanted.includes(label)) ? 0 : 1; const bounds = element.getBoundingClientRect(); const distance = inputBounds ? Math.hypot(bounds.left - inputBounds.left, bounds.top - inputBounds.top) : 0; return exactRank * 1000000 + distance; };",
    "  const selected = matches.sort((left, right) => score(left) - score(right))[0];",
    "  if (!selected) return null;",
    "  const bounds = selected.getBoundingClientRect();",
    "  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };",
    "})()",
  ].join("\n");
  return window.webContents.executeJavaScript(expression, true);
}

async function waitForFlowControlPoint(window, labels, exact = false, timeout = 30_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await findFlowControlPoint(window, labels, exact);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy điều khiển Google Flow: " + labels.join(" / ") + ".");
}

async function clickFlowControl(window, labels, exact = false, timeout = 30_000) {
  const point = await waitForFlowControlPoint(window, labels, exact, timeout);
  await dispatchBrowserClick(window, point);
  await delay(350);
}

async function dispatchBrowserEscape(window) {
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await window.webContents.debugger.sendCommand("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await delay(350);
}

async function findFlowAssetPoint(window, filename) {
  const expression = [
    "(() => {",
    "  const target = " + JSON.stringify(filename) + ".toLowerCase();",
    "  const roots = [document];",
    "  const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) {",
    "    for (const element of roots[index].querySelectorAll('*')) {",
    "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
    "    }",
    "  }",
    "  const candidates = roots.flatMap((root) => [...root.querySelectorAll('button, [role=\"option\"], [role=\"listitem\"], [role=\"button\"], div')]).filter((element) => {",
    "    const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); const text = (element.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase();",
    "    return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && text === target;",
    "  });",
    "  const selected = candidates.sort((left, right) => (left.textContent || '').length - (right.textContent || '').length)[0];",
    "  if (!selected) return null;",
    "  const bounds = selected.getBoundingClientRect();",
    "  return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };",
    "})()",
  ].join("\n");
  return window.webContents.executeJavaScript(expression, true);
}

async function findFlowFileInput(window) {
  return window.webContents.debugger.sendCommand("Runtime.evaluate", {
    expression: "(() => { const roots = [document]; const seen = new Set(roots); for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } } } return roots.flatMap((root) => [...root.querySelectorAll('input[type=file]')]).find((input) => !input.disabled) || null; })()",
    returnByValue: false,
  });
}

async function waitForFlowAsset(window, filename) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    const ready = await window.webContents.executeJavaScript("(() => { const text = document.body?.innerText || ''; const target = " + JSON.stringify(filename) + "; const uploading = /đang tải lên|uploading|đang tải bản xem trước|loading preview/i.test(text); return text.toLowerCase().includes(target.toLowerCase()) && !uploading; })()", true);
    if (ready) return;
    await delay(500);
  }
  throw new Error("Google Flow chưa tải xong ảnh " + filename + ".");
}

async function uploadFlowAsset(window, filePath) {
  const filename = path.basename(filePath);
  if (await findFlowAssetPoint(window, filename)) return;
  await clickFlowControl(window, ["Thêm thành phần vào ô nhập câu lệnh", "Add media to prompt", "Thêm nội dung nghe nhìn", "Add media"], false);
  const uploadPoint = await waitForFlowControlPoint(window, ["Tải nội dung nghe nhìn lên", "Upload media", "Upload files", "Upload"], false);
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  let candidate;
  let fileChooserResolve;
  const fileChooserPromise = new Promise((resolve) => { fileChooserResolve = resolve; });
  const fileChooserListener = (_event, method, params) => { if (method === "Page.fileChooserOpened") fileChooserResolve(params); };
  window.webContents.debugger.on("message", fileChooserListener);
  try {
    await window.webContents.debugger.sendCommand("Page.enable");
    await window.webContents.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true });
  } catch { /* Chromium có thể không hỗ trợ bắt hộp chọn tệp. */ }
  await dispatchBrowserClick(window, uploadPoint);
  const chooser = await Promise.race([fileChooserPromise, delay(2_000).then(() => null)]);
  window.webContents.debugger.removeListener("message", fileChooserListener);
  if (chooser?.backendNodeId) {
    const resolved = await window.webContents.debugger.sendCommand("DOM.resolveNode", { backendNodeId: chooser.backendNodeId });
    if (resolved?.object?.objectId) {
      await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], objectId: resolved.object.objectId });
      await waitForFlowAsset(window, filename);
      await dispatchBrowserEscape(window);
      return;
    }
  }
  await window.webContents.executeJavaScript("(() => { if (!document.querySelector('input[data-modeling-ai-flow-upload]')) { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.dataset.modelingAiFlowUpload = 'true'; input.style.position = 'fixed'; input.style.left = '-10000px'; document.body.appendChild(input); } return true; })()", true);
  for (let elapsed = 0; elapsed < 5_000; elapsed += 250) {
    await delay(250);
    candidate = await findFlowFileInput(window);
    if (candidate?.result?.objectId) break;
  }
  if (!candidate?.result?.objectId) throw new Error("Không tìm thấy ô tải nội dung nghe nhìn lên Google Flow.");
  await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], objectId: candidate.result.objectId });
  await window.webContents.executeJavaScript("(() => { const input = document.querySelector('input[data-modeling-ai-flow-upload]'); input?.dispatchEvent(new Event('change', { bubbles: true })); return true; })()", true);
  await waitForFlowAsset(window, filename);
  await dispatchBrowserEscape(window);
}

async function addFlowAssetToStart(window, filePath) {
  const filename = path.basename(filePath);
  await clickFlowControl(window, ["Bắt đầu", "Start"], true);
  const assetPoint = await waitForFlowControlPoint(window, [filename], true, 20_000).catch(async () => waitForFlowControlPoint(window, [filename], false, 20_000));
  await dispatchBrowserClick(window, assetPoint);
  await delay(700);
}

async function clearFlowComposer(window) {
  const point = await findFlowControlPoint(window, ["Xoá câu lệnh", "Xóa câu lệnh", "Clear prompt"], false);
  if (point) {
    await dispatchBrowserClick(window, point);
    await delay(500);
  }
}

async function ensureFlowMode(window, mode) {
  const wanted = mode.toLowerCase();
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    const state = await window.webContents.executeJavaScript(`(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const isVisible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
        .filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());
      const candidate = roots.flatMap((root) => [...root.querySelectorAll('[role="radio"]')])
        .find((element) => isVisible(element) && labelsFor(element).some((label) => label === ${JSON.stringify(wanted)} || label.endsWith(' ' + ${JSON.stringify(wanted)}) || label.endsWith(${JSON.stringify(wanted)})));
      if (!candidate) return { selected: false, point: null };
      const bounds = candidate.getBoundingClientRect();
      return { selected: candidate.getAttribute('aria-checked') === 'true', point: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } };
    })()`, true);
    if (state?.selected) return;
    if (state?.point) {
      await dispatchBrowserClick(window, state.point);
      await delay(350);
      return;
    }
    await delay(500);
  }
  throw new Error('Không tìm thấy chế độ ' + mode + ' trong cài đặt Google Flow.');
}

async function configureFlowVideo(window) {
  await clickFlowControl(window, ["Điều kiện kích hoạt cài đặt", "Video settings", "Settings"], false);
  await ensureFlowMode(window, "Video");
  await clickFlowControl(window, ["9:16"], true);
  await clickFlowControl(window, ["Chọn nhóm mô hình", "Select model", "Model"], false);
  await clickFlowControl(window, ["Veo 3.1 - Lite [Lower Priority]"], true, 15_000);
  const qualityPoint = await findFlowControlPoint(window, ["720p"], true);
  if (qualityPoint) { await dispatchBrowserClick(window, qualityPoint); await delay(350); }
  await clickFlowControl(window, ["6 giây", "6 seconds", "6s"], false);
  await clickFlowControl(window, ["x1"], true);
  // Flow exposes the Start/End frame inputs after the other settings are set.
  await clickFlowControl(window, ["Frames"], true);
  await dispatchBrowserEscape(window);
}

async function configureFlowImage(window, aspectRatio) {
  await clickFlowControl(window, ["Điều kiện kích hoạt cài đặt", "Video settings", "Settings"], false);
  await clickFlowControl(window, ["Image", "Ảnh"], false);
  const supportedAspectRatios = new Set(["16:9", "4:3", "1:1", "3:4", "9:16"]);
  const flowAspectRatio = supportedAspectRatios.has(aspectRatio) ? aspectRatio : "9:16";
  await clickFlowControl(window, [flowAspectRatio], true);
  await clickFlowControl(window, ["x1"], true);
  await dispatchBrowserEscape(window);
}

async function createFlowProject(window) {
  await window.webContents.loadURL("https://flow.google.com/?pli=1");
  await waitForFlowLoad(window);
  let requestedWorkspace = false;
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    if (window.webContents.getURL().includes("accounts.google.com")) {
      throw new Error("Google Flow yêu cầu đăng nhập. Hãy đăng nhập một lần trong cửa sổ Flow rồi chạy lại.");
    }
    const nextPoint = await findFlowControlPoint(window, ["Tiếp theo", "Next"], true);
    if (nextPoint) {
      await dispatchBrowserClick(window, nextPoint);
      await delay(500);
      continue;
    }
    if (!requestedWorkspace) {
      const enterFlowPoint = await findFlowControlPoint(window, ["Create with Google Flow", "Tạo bằng Google Flow"], true);
      if (enterFlowPoint) {
        await dispatchBrowserClick(window, enterFlowPoint);
        requestedWorkspace = true;
        await delay(1_000);
        continue;
      }
    }
    const newProjectPoint = await findFlowControlPoint(window, ["Dự án mới", "New project"], false);
    if (newProjectPoint) {
      await dispatchBrowserClick(window, newProjectPoint);
      break;
    }
    await delay(500);
  }
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    const url = window.webContents.getURL();
    if (/flow\.google\.com\/project\//i.test(url)) return url;
    await delay(500);
  }
  throw new Error("Google Flow không mở được project mới.");
}

async function reloadFlowProject(window, projectUrl) {
  const targetUrl = projectUrl || window.webContents.getURL();
  flowLoadPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Google Flow tải lại quá lâu.")), 60_000);
    window.webContents.once("did-finish-load", () => { clearTimeout(timeout); resolve(); });
  });
  // Opening a generated clip leaves Flow in its video viewer. A browser reload
  // preserves that viewer, so the next scene cannot find the video controls.
  // Navigate to the original project URL instead to restore the composer.
  await window.webContents.loadURL(targetUrl);
  await flowLoadPromise;
  if (!window.webContents.getURL().startsWith(targetUrl)) {
    await window.webContents.loadURL(targetUrl);
    await waitForFlowLoad(window);
  }
  await delay(1_500);
  await waitForFlowComposer(window);
}

async function waitForFlowComposer(window, timeout = 20_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const ready = await window.webContents.executeJavaScript(`(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const isVisible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 100 && bounds.height >= 20 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      return roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).some(isVisible);
    })()`, true);
    if (ready) return;
    const backPoint = await findFlowControlPoint(window, ["Back button to go to previous page", "Quay lại", "Back", "arrow_back"], false, 1_000).catch(() => null);
    if (backPoint) {
      await dispatchBrowserClick(window, backPoint);
      await delay(800);
      continue;
    }
    await delay(500);
  }
  throw new Error("Google Flow chưa quay về màn hình soạn lệnh.");
}

async function inspectFlowVideo(window, beforeSources = [], beforeCardCount = 0) {
  const expression = [
    "(() => {",
    "  const before = new Set(" + JSON.stringify(beforeSources) + ");",
    "  const roots = [document]; const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } } }",
    "  const videos = roots.flatMap((root) => [...root.querySelectorAll('video')]).filter((video) => { const bounds = video.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const sourceFor = (video) => video.currentSrc || video.src || video.querySelector('source')?.src || '';",
    "  const video = videos.reverse().find((candidate) => { const source = sourceFor(candidate); return source && !before.has(source) && candidate.readyState >= 2 && Number.isFinite(candidate.duration) && candidate.duration > 0; });",
    "  const resourceSources = performance.getEntriesByType('resource').map((entry) => entry.name).filter((source) => /flow-content\\.google\\/video\\//i.test(source) && !before.has(source));",
    "  const videoCards = roots.flatMap((root) => [...root.querySelectorAll('img[alt=\"Generated video thumbnail\"]')]).filter((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const thumbnail = videoCards[0] || null;",
    "  const text = document.body?.innerText || '';",
    "  const playButton = roots.flatMap((root) => [...root.querySelectorAll('button[aria-label=\"Play\"], button[aria-label=\"Phát\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const playCircle = roots.flatMap((root) => [...root.querySelectorAll('[role=\"button\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0 && element.querySelector('mat-icon')?.textContent?.trim() === 'play_circle'; });",
    "  const thumbnailBounds = thumbnail?.getBoundingClientRect();",
    "  const playButtonBounds = playButton?.getBoundingClientRect();",
    "  const playCircleBounds = playCircle?.getBoundingClientRect();",
    "  return { videoSource: video ? sourceFor(video) : (resourceSources[resourceSources.length - 1] || null), duration: video && Number.isFinite(video.duration) ? video.duration : null, videoCardCount: videoCards.length, videoCard: Boolean(thumbnail), thumbnailPoint: thumbnailBounds ? { x: thumbnailBounds.left + thumbnailBounds.width / 2, y: thumbnailBounds.top + thumbnailBounds.height / 2 } : null, playButton: Boolean(playButton), playButtonPoint: playButtonBounds ? { x: playButtonBounds.left + playButtonBounds.width / 2, y: playButtonBounds.top + playButtonBounds.height / 2 } : null, playCircle: Boolean(playCircle), playCirclePoint: playCircleBounds ? { x: playCircleBounds.left + playCircleBounds.width / 2, y: playCircleBounds.top + playCircleBounds.height / 2 } : null, failed: /không thành công|không tải được video|failed|couldn't load video|could not load video|generation failed/i.test(text) };",
    "})()",
  ].join("\n");
  return window.webContents.executeJavaScript(expression, true).then((state) => ({ ...state, beforeCardCount }));
}

async function waitForFlowVideo(window, beforeSources, beforeCardCount = 0, timeout = 600_000) {
  let openedVideoCard = false;
  let startedPlayback = false;
  for (let elapsed = 0; elapsed < timeout; elapsed += 2_000) {
    const state = await inspectFlowVideo(window, beforeSources, beforeCardCount);
    if (state?.videoSource) return state;
    if (state?.videoCardCount > beforeCardCount && !openedVideoCard) {
      openedVideoCard = true;
      if (state.thumbnailPoint) await dispatchBrowserClick(window, state.thumbnailPoint);
      await delay(1_000);
      continue;
    }
    if (!startedPlayback && (state?.playButtonPoint || state?.playCirclePoint)) {
      startedPlayback = true;
      await dispatchBrowserClick(window, state.playButtonPoint || state.playCirclePoint);
      await delay(1_000);
      continue;
    }
    if (state?.failed) return state;
    await delay(2_000);
  }
  return { failed: false, timedOut: true };
}

async function getFlowVideoBuffer(window, result) {
  if (typeof result?.videoSource === "string" && result.videoSource && !result.videoSource.startsWith("blob:")) {
    const response = await window.webContents.session.fetch(result.videoSource);
    if (!response.ok) throw new Error("Google Flow không cho phép tải video vừa tạo.");
    return Buffer.from(await response.arrayBuffer());
  }
  const dataUrl = await window.webContents.executeJavaScript("(async () => { const video = [...document.querySelectorAll('video')].reverse().find((candidate) => (candidate.currentSrc || candidate.src || '').startsWith('blob:')); if (!video) return null; const response = await window.fetch(video.currentSrc || video.src); const blob = await response.blob(); return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); })()", true);
  const match = typeof dataUrl === "string" ? /^data:video\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl) : null;
  if (!match) throw new Error("Không tìm thấy dữ liệu video Google Flow để tải về app.");
  return Buffer.from(match[1], "base64");
}

async function waitForFlowVideoWithRecovery(window, projectUrl, beforeSources, beforeCardCount = 0) {
  let state = await waitForFlowVideo(window, beforeSources, beforeCardCount);
  if (state?.videoSource && !state?.failed) return state;
  await reloadFlowProject(window, projectUrl);
  state = await waitForFlowVideo(window, beforeSources, beforeCardCount, 30_000);
  if (state?.failed) {
    const retryPoint = await waitForFlowControlPoint(window, ["Thử lại", "Try again", "Retry"], true, 15_000);
    await dispatchBrowserClick(window, retryPoint);
    state = await waitForFlowVideo(window, beforeSources, beforeCardCount);
    if (state?.videoSource && !state?.failed) return state;
    if (state?.videoSource && state?.failed) throw new Error("Google Flow vẫn báo tạo video không thành công sau khi gửi tạo lại.");
    throw new Error("Google Flow vẫn không tạo được video sau khi gửi tạo lại.");
  }
  if (state?.videoSource) return state;
  if (!state?.failed) throw new Error("Google Flow không trả về video sau khi tải lại trang.");
  throw new Error("Google Flow vẫn báo tạo video không thành công sau khi tải lại và gửi tạo lại.");
}

async function inspectFlowImage(window, beforeSources = []) {
  const expression = [
    "(() => {",
    "  const before = new Set(" + JSON.stringify(beforeSources) + ");",
    "  const roots = [document]; const seen = new Set(roots);",
    "  for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } } }",
    "  const images = roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => { const bounds = image.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; });",
    "  const sourceFor = (image) => image.currentSrc || image.src || image.querySelector('source')?.src || '';",
    "  const image = images.reverse().find((candidate) => { const source = sourceFor(candidate); return source && !before.has(source) && candidate.complete && (candidate.naturalWidth || candidate.width) >= 128 && (candidate.naturalHeight || candidate.height) >= 128 && (/flow-content\\.google\\/image\\//i.test(source) || /tile displaying a user's image/i.test(candidate.alt || '')); });",
    "  const resourceSources = performance.getEntriesByType('resource').map((entry) => entry.name).filter((source) => /flow-content\\.google\\/image\\//i.test(source) && !before.has(source));",
    "  const text = document.body?.innerText || '';",
    "  return { imageSource: image ? sourceFor(image) : (resourceSources[resourceSources.length - 1] || null), failed: /không thành công|không tải được ảnh|failed|couldn't load image|could not load image|generation failed/i.test(text) };",
    "})()",
  ].join("\n");
  return window.webContents.executeJavaScript(expression, true);
}

async function waitForFlowImage(window, beforeSources, timeout = 600_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 2_000) {
    const state = await inspectFlowImage(window, beforeSources);
    if (state?.imageSource) return state;
    if (state?.failed) return state;
    await delay(2_000);
  }
  return { failed: false, timedOut: true };
}

async function getFlowImageBuffer(window, result) {
  if (typeof result?.imageSource === "string" && result.imageSource && !result.imageSource.startsWith("blob:")) {
    const response = await window.webContents.session.fetch(result.imageSource);
    if (!response.ok) throw new Error("Google Flow không cho phép tải ảnh vừa tạo.");
    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0].toLowerCase();
    if (!mimeType.startsWith("image/")) throw new Error("Google Flow không trả về tệp ảnh hợp lệ.");
    return { buffer: Buffer.from(await response.arrayBuffer()), mimeType };
  }
  const dataUrl = await window.webContents.executeJavaScript("(async () => { const image = [...document.querySelectorAll('img')].reverse().find((candidate) => (candidate.currentSrc || candidate.src || '').startsWith('blob:')); if (!image) return null; const response = await window.fetch(image.currentSrc || image.src); const blob = await response.blob(); return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); })()", true);
  const match = typeof dataUrl === "string" ? /^data:(image\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(dataUrl) : null;
  if (!match) throw new Error("Không tìm thấy dữ liệu ảnh Google Flow để tải về app.");
  return { buffer: Buffer.from(match[2], "base64"), mimeType: match[1].toLowerCase() };
}

async function waitForFlowImageWithRecovery(window, projectUrl, beforeSources) {
  let state = await waitForFlowImage(window, beforeSources);
  if (state?.imageSource && !state?.failed) return state;
  await reloadFlowProject(window, projectUrl);
  state = await waitForFlowImage(window, beforeSources, 30_000);
  if (state?.failed) {
    const retryPoint = await waitForFlowControlPoint(window, ["Thử lại", "Try again", "Retry"], true, 15_000);
    await dispatchBrowserClick(window, retryPoint);
    state = await waitForFlowImage(window, beforeSources);
    if (state?.imageSource && !state?.failed) return state;
    if (state?.imageSource && state?.failed) throw new Error("Google Flow vẫn báo tạo ảnh không thành công sau khi gửi tạo lại.");
    throw new Error("Google Flow vẫn không tạo được ảnh sau khi gửi tạo lại.");
  }
  if (state?.imageSource) return state;
  if (!state?.failed) throw new Error("Google Flow không trả về ảnh sau khi tải lại trang.");
  throw new Error("Google Flow vẫn báo tạo ảnh không thành công sau khi tải lại và gửi tạo lại.");
}

async function captureGeminiImage(window, rect) {
  if (!rect || !Number.isFinite(rect.x) || !Number.isFinite(rect.y) || !Number.isFinite(rect.width) || !Number.isFinite(rect.height)) {
    throw new Error("Không xác định được vùng ảnh Gemini vừa tạo.");
  }
  const image = await window.webContents.capturePage({
    x: Math.max(0, Math.floor(rect.x)),
    y: Math.max(0, Math.floor(rect.y)),
    width: Math.max(1, Math.floor(rect.width)),
    height: Math.max(1, Math.floor(rect.height)),
  });
  const png = image.toPNG();
  if (png.length < 1024) throw new Error("Không thể chụp ảnh Gemini vừa tạo.");
  return `data:image/png;base64,${png.toString("base64")}`;
}

async function getGeminiImageDataUrl(window, source, captureRect) {
  if (typeof source !== "string" || !source) throw new Error("Không tìm thấy nguồn ảnh Gemini.");
  if (source.startsWith("data:image/")) return source;
  try {
    const response = await window.webContents.session.fetch(source);
    if (!response.ok) throw new Error("Gemini chặn tải trực tiếp ảnh.");
    const mimeType = (response.headers.get("content-type") || "image/png").split(";")[0].toLowerCase();
    if (!mimeType.startsWith("image/")) throw new Error("Gemini không trả về tệp ảnh hợp lệ.");
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${mimeType};base64,${buffer.toString("base64")}`;
  } catch {
    return captureGeminiImage(window, captureRect);
  }
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
    if (index > 0) {
      event.sender.send("gemini-browser:progress", { processed: index, total: slots.length, label: "Đang tải lại Gemini trước khi dán ảnh tiếp theo..." });
      await reloadGeminiBeforeNextPrompt(window);
    }
    const slot = slots[index];
    if (!slot || !["character", "background", "scene"].includes(slot.kind) || typeof slot.prompt !== "string") throw new Error("Prompt ảnh không hợp lệ.");
    event.sender.send("gemini-browser:progress", { processed: index, total: slots.length, label: slot.label ?? `Ảnh ${index + 1}` });
    const prepareScript = `(() => {
      const prompt = ${JSON.stringify(slot.prompt)};
      const collectRoots = () => {
        const roots = [document];
        const seen = new Set(roots);
        for (let index = 0; index < roots.length; index += 1) {
          for (const element of roots[index].querySelectorAll("*")) {
            if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
          }
        }
        return roots;
      };
      const allImages = () => collectRoots().flatMap((root) => [...root.querySelectorAll("img")]);
      const allCanvases = () => collectRoots().flatMap((root) => [...root.querySelectorAll("canvas")]);
      const before = new Set(allImages().map((image) => image.currentSrc || image.src).filter(Boolean));
      const beforeCanvases = new Set(allCanvases());
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
      input.focus();
      return { beforeSources: [...before], beforeCanvasCount: beforeCanvases.size, promptPrefix: prompt.slice(0, 48) };
    })()`;
    const prepared = await window.webContents.executeJavaScript(prepareScript, true);
    if (!prepared || prepared.error) throw new Error(prepared?.error ?? "Không thể chuẩn bị prompt Gemini.");
    await new Promise((resolve) => setTimeout(resolve, 350));
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    const sendScript = `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll("*")) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const input = document.querySelector('textarea, [contenteditable="true"]');
      if (!input) return { error: "Không tìm thấy ô nhập prompt Gemini." };
      const inputText = input.tagName === "TEXTAREA" ? input.value : (input.innerText || input.textContent || "");
      if (!inputText.includes(${JSON.stringify(prepared.promptPrefix)})) return { sent: true };
      input.focus();
      const inputBounds = input.getBoundingClientRect();
      const candidates = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"]')]).filter((element) => {
        const label = ((element.getAttribute("aria-label") || "") + " " + (element.getAttribute("title") || "") + " " + (element.textContent || "")).toLowerCase();
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return !element.disabled && bounds.width > 0 && bounds.height > 0 && style.visibility !== "hidden" && style.display !== "none" && (label.includes("send") || label.includes("gửi") || label.includes("submit"));
      });
      const send = candidates.sort((left, right) => {
        const leftBounds = left.getBoundingClientRect();
        const rightBounds = right.getBoundingClientRect();
        return Math.hypot(leftBounds.left - inputBounds.right, leftBounds.top - inputBounds.bottom) - Math.hypot(rightBounds.left - inputBounds.right, rightBounds.top - inputBounds.bottom);
      })[0];
      if (!send) return { sent: false };
      const bounds = send.getBoundingClientRect();
      return { sent: true, clickPoint: { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } };
    })()`;
    const sendResult = await window.webContents.executeJavaScript(sendScript, true);
    if (sendResult?.error) throw new Error(sendResult.error);
    if (!sendResult?.sent) {
      throw new Error("Gemini chưa nhận được prompt. Hãy kiểm tra cửa sổ Gemini đang mở và thử lại.");
    }
    if (sendResult.clickPoint) {
      await dispatchBrowserClick(window, sendResult.clickPoint);
    }
    await new Promise((resolve) => setTimeout(resolve, 900));
    const deliveryCheck = await window.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('textarea, [contenteditable="true"]');
      return input ? (input.tagName === "TEXTAREA" ? input.value : (input.innerText || input.textContent || "")) : "";
    })()`, true);
    if (deliveryCheck.includes(prepared.promptPrefix)) {
      window.webContents.focus();
      window.webContents.sendInputEvent({ type: "keyDown", keyCode: "ENTER" });
      window.webContents.sendInputEvent({ type: "keyUp", keyCode: "ENTER" });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const retryCheck = await window.webContents.executeJavaScript(`(() => {
        const input = document.querySelector('textarea, [contenteditable="true"]');
        return input ? (input.tagName === "TEXTAREA" ? input.value : (input.innerText || input.textContent || "")) : "";
      })()`, true);
      if (retryCheck.includes(prepared.promptPrefix)) throw new Error("Gemini không nhận thao tác gửi tự động. App đã thử cả chuột trình duyệt và phím Enter.");
    }
    const script = `(async () => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const collectRoots = () => {
        const roots = [document];
        const seen = new Set(roots);
        for (let index = 0; index < roots.length; index += 1) {
          for (const element of roots[index].querySelectorAll("*")) {
            if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
          }
        }
        return roots;
      };
      const allImages = () => collectRoots().flatMap((root) => [...root.querySelectorAll("img")]);
      const allCanvases = () => collectRoots().flatMap((root) => [...root.querySelectorAll("canvas")]);
      const before = new Set(${JSON.stringify(prepared.beforeSources)});
      const beforeCanvasCount = ${prepared.beforeCanvasCount};
      for (let elapsed = 0; elapsed < 180000; elapsed += 1500) {
        await sleep(1500);
        const candidates = allImages().filter((image) => {
          const source = image.currentSrc || image.src;
          return source && !before.has(source) && image.complete && (image.naturalWidth || image.width) >= 128 && (image.naturalHeight || image.height) >= 128;
        });
        const image = candidates[candidates.length - 1];
        if (image) {
          const bounds = image.getBoundingClientRect();
          const captureRect = { x: bounds.left, y: bounds.top, width: bounds.width, height: bounds.height };
          const source = image.currentSrc || image.src;
          try {
            if (source.startsWith("blob:")) {
              const response = await fetch(source);
              const blob = await response.blob();
              const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
              return { dataUrl };
            }
            return { imageSource: source, captureRect };
          } catch { return { imageSource: source, captureRect }; }
        }
        const canvases = allCanvases();
        const canvas = canvases.slice(beforeCanvasCount).find((item) => item.width >= 128 && item.height >= 128);
        if (canvas) {
          try { return { dataUrl: canvas.toDataURL("image/png") }; } catch { return { error: "Không thể đọc ảnh Gemini vừa tạo." }; }
        }
      }
      return { error: "Gemini không tạo ảnh trong thời gian chờ 180 giây." };
    })()`;
    const result = await window.webContents.executeJavaScript(script, true);
    if (!result?.dataUrl && !result?.imageSource) throw new Error(result?.error ?? "Không thể tạo ảnh trên Gemini Ultra.");
    const dataUrl = result.dataUrl ?? await getGeminiImageDataUrl(window, result.imageSource, result.captureRect);
    const url = saveGeminiImage(projectId, slot, dataUrl);
    images[`${slot.kind}-${Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0}`] = `${url}&v=${Date.now()}`;
    event.sender.send("gemini-browser:progress", { processed: index + 1, total: slots.length, label: slot.label ?? `Ảnh ${index + 1}` });
  }
  return { status: "completed", images };
});

async function runFlowImageJob(event, projectId, slots) {
  event.sender.send("flow-browser:image-progress", { processed: 0, total: slots.length, label: "Đang mở Google Flow..." });
  const window = createFlowWindow();
  const projectUrl = await createFlowProject(window);
  const images = {};
  for (let index = 0; index < slots.length; index += 1) {
    if (index > 0) {
      event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang quay về màn hình tạo ảnh Google Flow trước ảnh tiếp theo..." });
      await reloadFlowProject(window, projectUrl);
    }
    const slot = slots[index];
    if (!slot || !["character", "background", "scene"].includes(slot.kind) || typeof slot.prompt !== "string" || !slot.prompt.trim()) {
      throw new Error("Dữ liệu ảnh tạo bằng Google Flow không hợp lệ.");
    }
    event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: slot.label || "Ảnh " + (index + 1) });
    let slotError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await clearFlowComposer(window);
    event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang cấu hình Google Flow cho " + (slot.label || "ảnh") + "..." });
    await configureFlowImage(window, slot.aspectRatio || "9:16");

    const prepared = await window.webContents.executeJavaScript([
      "(() => {",
      "  const roots = [document];",
      "  const seen = new Set(roots);",
      "  for (let index = 0; index < roots.length; index += 1) {",
      "    for (const element of roots[index].querySelectorAll('*')) {",
      "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
      "    }",
      "  }",
      "  const allImages = () => roots.flatMap((root) => [...root.querySelectorAll('img')]);",
      "  const beforeSources = allImages().map((image) => image.currentSrc || image.src).filter(Boolean);",
      "  const beforeResources = performance.getEntriesByType('resource').map((entry) => entry.name).filter((source) => /flow-content\\.google\\/image\\//i.test(source));",
      "  const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable=\"true\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 100 && bounds.height >= 20; });",
      "  if (!input) return { error: 'Không tìm thấy ô nhập prompt Google Flow.' };",
      "  const prompt = " + JSON.stringify(slot.prompt) + ";",
      "  input.focus();",
      "  if (input.tagName === 'TEXTAREA') { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, prompt); }",
      "  else { document.execCommand('selectAll', false); document.execCommand('insertText', false, prompt); }",
      "  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));",
      "  input.dispatchEvent(new Event('change', { bubbles: true }));",
      "  return { beforeSources: [...beforeSources, ...beforeResources] };",
      "})()",
    ].join("\n"), true);
    if (prepared?.error) throw new Error(prepared.error);

    event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang gửi lệnh tạo " + (slot.label || "ảnh") + "..." });
    const sendPoint = await waitForFlowControlPoint(window, ["Bắt đầu tạo", "Tạo ảnh", "Generate", "Create", "Start generation"], false, 30_000);
    await dispatchBrowserClick(window, sendPoint);
    await delay(1_200);
    event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang chờ Google Flow tạo " + (slot.label || "ảnh") + "..." });
    const result = await waitForFlowImageWithRecovery(window, projectUrl, prepared.beforeSources ?? []);
    const { buffer, mimeType } = await getFlowImageBuffer(window, result);
    const url = saveFlowImage(projectId, slot, buffer, mimeType);
    const sceneNumber = Number.isInteger(slot.sceneNumber) ? slot.sceneNumber : 0;
    images[`${slot.kind}-${sceneNumber}`] = `${url}&v=${Date.now()}`;
    event.sender.send("flow-browser:image-progress", { processed: index + 1, total: slots.length, label: slot.label || "Ảnh " + (index + 1) });
        slotError = null;
        break;
      } catch (error) {
        slotError = error;
        if (attempt === 1) throw error;
        event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang tải lại Google Flow để thử lại ảnh..." });
        await reloadFlowProject(window, projectUrl);
      }
    }
    if (slotError) throw slotError;
  }
  return { status: "completed", images };
}

async function runFlowVideoJob(event, projectId, slots) {
  event.sender.send("gemini-browser:video-progress", { processed: 0, total: slots.length, label: "Đang mở Google Flow..." });
  const window = createFlowWindow();
  const projectUrl = await createFlowProject(window);
  const videos = {};
  for (let index = 0; index < slots.length; index += 1) {
    if (index > 0) {
      event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang quay về màn hình tạo video Google Flow trước cảnh tiếp theo..." });
      await reloadFlowProject(window, projectUrl);
    }
    const slot = slots[index];
    if (!Number.isInteger(slot?.sceneNumber) || typeof slot.visualBlock !== "string" || typeof slot.actionBlock !== "string" || typeof slot.audioBlock !== "string") {
      throw new Error("Dữ liệu phân cảnh tạo video không hợp lệ.");
    }
    const sceneNumber = slot.sceneNumber;
    const imagePath = findSceneImagePath(projectId, sceneNumber);
    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: slot.label || "Cảnh " + sceneNumber });

    await clearFlowComposer(window);
    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang cấu hình Google Flow cho cảnh " + sceneNumber + "..." });
    await configureFlowVideo(window);
    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang tải đúng ảnh cảnh " + sceneNumber + " lên Google Flow..." });
    await uploadFlowAsset(window, imagePath);
    await addFlowAssetToStart(window, imagePath);

    const prepared = await window.webContents.executeJavaScript([
      "(() => {",
      "  const roots = [document];",
      "  const seen = new Set(roots);",
      "  for (let index = 0; index < roots.length; index += 1) {",
      "    for (const element of roots[index].querySelectorAll('*')) {",
      "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
      "    }",
      "  }",
      "  const videos = roots.flatMap((root) => [...root.querySelectorAll('video')]);",
      "  const beforeSources = videos.map((video) => video.currentSrc || video.src || video.querySelector('source')?.src).filter(Boolean);",
      "  const beforeCardCount = roots.flatMap((root) => [...root.querySelectorAll('img[alt=\"Generated video thumbnail\"]')]).filter((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 0 && bounds.height > 0; }).length;",
      "  const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable=\"true\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 100 && bounds.height >= 20; });",
      "  if (!input) return { error: 'Không tìm thấy ô nhập prompt Google Flow.' };",
      "  input.focus();",
      "  if (input.tagName === 'TEXTAREA') { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, ''); }",
      "  else { document.execCommand('selectAll', false); document.execCommand('delete', false); }",
      "  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));",
      "  return { beforeSources, beforeCardCount };",
      "})()",
    ].join("\n"), true);
    if (prepared?.error) throw new Error(prepared.error);

    const videoFormat = "vertical 9:16";
    const prompt = "Create one 6-second " + videoFormat + " video from the attached scene image only. Use this exact scene image as the Start frame for scene " + sceneNumber + ". Do not use an End frame, character reference, or separate background image. Preserve the exact scene composition, environment, lighting, and art style. Animate only this scene. Action: " + slot.actionBlock + ". Camera and visual direction: " + slot.visualBlock + ". Audio and sound direction: " + slot.audioBlock + ". Generate one final video with audio.";
    const promptResult = await window.webContents.executeJavaScript([
      "(() => {",
      "  const prompt = " + JSON.stringify(prompt) + ";",
      "  const roots = [document];",
      "  const seen = new Set(roots);",
      "  for (let index = 0; index < roots.length; index += 1) {",
      "    for (const element of roots[index].querySelectorAll('*')) {",
      "      if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }",
      "    }",
      "  }",
      "  const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable=\"true\"]')]).find((element) => { const bounds = element.getBoundingClientRect(); return bounds.width > 100 && bounds.height >= 20; });",
      "  if (!input) return { error: 'Không tìm thấy ô nhập prompt Google Flow.' };",
      "  input.focus();",
      "  if (input.tagName === 'TEXTAREA') { const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set; setter?.call(input, prompt); }",
      "  else { document.execCommand('insertText', false, prompt); }",
      "  input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: prompt }));",
      "  input.dispatchEvent(new Event('change', { bubbles: true }));",
      "  return { promptPrefix: prompt.slice(0, 48) };",
      "})()",
    ].join("\n"), true);
    if (promptResult?.error) throw new Error(promptResult.error);

    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang gửi lệnh tạo video cảnh " + sceneNumber + "..." });
    const sendPoint = await waitForFlowControlPoint(window, ["Bắt đầu tạo", "Tạo video", "Generate", "Create", "Start generation"], false, 30_000);
    await dispatchBrowserClick(window, sendPoint);
    await delay(1_200);

    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang chờ Google Flow tạo video cảnh " + sceneNumber + "..." });
    const result = await waitForFlowVideoWithRecovery(window, projectUrl, prepared.beforeSources ?? [], prepared.beforeCardCount ?? 0);
    const buffer = await getFlowVideoBuffer(window, result);
    const url = saveGeminiVideo(projectId, sceneNumber, buffer);
    videos["scene-" + sceneNumber] = url + "&v=" + Date.now();
    event.sender.send("gemini-browser:video-progress", { processed: index + 1, total: slots.length, label: slot.label || "Cảnh " + sceneNumber });
  }
  return { status: "completed", videos };
}


ipcMain.handle("flow-browser:run-image-job", async (event, value) => {
  const projectId = value?.projectId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu tạo ảnh bằng Google Flow không hợp lệ.");
  }
  return runFlowImageJob(event, projectId, slots);
});

ipcMain.handle("gemini-browser:run-video-job", async (event, value) => {
  const projectId = value?.projectId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu tạo video không hợp lệ.");
  }
  return runFlowVideoJob(event, projectId, slots);
});

ipcMain.handle("gemini-browser:open-flow", async () => {
  const window = createFlowWindow();
  await waitForFlowLoad(window);
  window.show();
  window.focus();
  return { status: "opened" };
});

ipcMain.handle("video-editor:render-final", async (event, value) => {
  const projectId = value?.projectId;
  const sceneNumbers = value?.sceneNumbers;
  const isValidSceneList = Array.isArray(sceneNumbers)
    && sceneNumbers.length > 0
    && sceneNumbers.length <= 30
    && sceneNumbers.every((sceneNumber) => Number.isInteger(sceneNumber) && sceneNumber > 0)
    && new Set(sceneNumbers).size === sceneNumbers.length;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || !isValidSceneList) {
    throw new Error("Yêu cầu ghép video không hợp lệ.");
  }
  return renderFinalVideo(event, projectId, sceneNumbers);
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
