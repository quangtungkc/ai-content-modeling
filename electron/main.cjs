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
let flowRemoteClient;

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

async function ensureLocalDatabaseSchema(databaseUrl) {
  if (typeof databaseUrl !== "string" || !databaseUrl.startsWith("file:")) return;
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const columns = await prisma.$queryRawUnsafe('PRAGMA table_info("StoryboardScene")');
    if (!Array.isArray(columns) || !columns.some((column) => column?.name === "startFramePrompt")) {
      await prisma.$executeRawUnsafe('ALTER TABLE "StoryboardScene" ADD COLUMN "startFramePrompt" TEXT');
    }
  } finally {
    await prisma.$disconnect();
  }
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

async function startLocalServices() {
  if (!app.isPackaged || process.env.DESKTOP_APP_URL) return;
  const appDirectory = path.join(runtimeRoot(), "app");
  const environment = ensureRuntime();
  await ensureLocalDatabaseSchema(environment.DATABASE_URL);
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

function getRemoteDebuggingPort() {
  const argument = process.argv.find((value) => value.startsWith("--remote-debugging-port="));
  const port = Number(argument?.split("=")[1]);
  return Number.isInteger(port) && port > 0 ? port : null;
}

function readRemoteDebuggingTargets(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: "127.0.0.1", port, path: "/json/list" }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(2_000, () => request.destroy(new Error("Remote CDP timeout.")));
  });
}

async function waitForRemoteFlowTarget(url, timeout = 10_000) {
  const port = getRemoteDebuggingPort();
  if (!port || typeof globalThis.WebSocket !== "function") return null;
  for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
    try {
      const targets = await readRemoteDebuggingTargets(port);
      const target = targets.find((item) => item.type === "page" && item.webSocketDebuggerUrl && (item.url === url || /flow\.google\.com\/project\//i.test(item.url)));
      if (target) return target;
    } catch { /* Cổng debug có thể chưa sẵn sàng. */ }
    await delay(250);
  }
  return null;
}

async function getFlowRemoteClient(window) {
  if (!getRemoteDebuggingPort() || window !== flowWindow || typeof globalThis.WebSocket !== "function") return null;
  if (flowRemoteClient) return flowRemoteClient;
  const target = await waitForRemoteFlowTarget(window.webContents.getURL(), 15_000);
  if (!target) return null;
  const client = connectRemoteCdp(target.webSocketDebuggerUrl);
  await client.ready();
  flowRemoteClient = client;
  return client;
}

async function executeFlowJavaScript(window, expression) {
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) return remoteClient.evaluate(expression);
  return window.webContents.executeJavaScript(expression, true);
}

function connectRemoteCdp(webSocketDebuggerUrl) {
  const socket = new globalThis.WebSocket(webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const events = [];
  let opened = false;
  let openResolve;
  let openReject;
  const openPromise = new Promise((resolve, reject) => { openResolve = resolve; openReject = reject; });
  socket.onopen = () => { opened = true; openResolve(); };
  socket.onerror = (event) => { if (!opened) openReject(new Error("Không kết nối được remote CDP Google Flow.")); for (const request of pending.values()) request.reject(new Error("Remote CDP đã lỗi.")); pending.clear(); };
  socket.onclose = () => { for (const request of pending.values()) request.reject(new Error("Remote CDP đã đóng kết nối.")); pending.clear(); };
  socket.onmessage = async (message) => {
    let payload;
    try {
      let raw = message.data;
      if (typeof raw !== "string") {
        if (typeof raw?.text === "function") raw = await raw.text();
        else if (raw instanceof ArrayBuffer) raw = Buffer.from(raw).toString("utf8");
        else if (ArrayBuffer.isView(raw)) raw = Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength).toString("utf8");
        else raw = String(raw);
      }
      payload = JSON.parse(raw);
    } catch { return; }
    if (payload.id && pending.has(payload.id)) {
      const request = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) request.reject(new Error(payload.error.message || "Remote CDP command failed."));
      else request.resolve(payload);
    } else if (payload.method) events.push(payload);
  };
  return {
    async ready() { await openPromise; },
    send(method, params = {}) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    async evaluate(expression) {
      const response = await this.send("Runtime.evaluate", { expression, returnByValue: true });
      return response?.result?.result?.value;
    },
    async waitForEvent(method, timeout = 12_000) {
      for (let elapsed = 0; elapsed < timeout; elapsed += 250) {
        const index = events.findIndex((event) => event.method === method);
        if (index >= 0) return events.splice(index, 1)[0].params || {};
        await delay(250);
      }
      return null;
    },
    close() { try { socket.close(); } catch { /* Kết nối có thể đã đóng. */ } },
  };
}

async function remoteFlowPoint(client, labels, exact = false) {
  return client.evaluate(`(() => {
    const wanted = ${JSON.stringify(labels)}.map((value) => value.toLowerCase().replace(/\\s+/g, ' ').trim());
    const exactMatch = ${JSON.stringify(exact)};
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const labelsFor = (element) => [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase()).filter(Boolean);
    const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
    const candidates = roots.flatMap((root) => [...root.querySelectorAll('button, [role="button"], [role="menuitem"], [role="option"], [role="radio"], a')]).filter((element) => !element.disabled && visible(element));
    const matches = candidates.filter((element) => labelsFor(element).some((label) => exactMatch ? wanted.some((value) => label === value || label.startsWith(value + ' ') || label.endsWith(value)) : wanted.some((value) => label === value || label.includes(value))));
    const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).find(visible);
    const inputBounds = input?.getBoundingClientRect();
    const score = (element) => { const labels = labelsFor(element); const exactRank = labels.some((label) => wanted.includes(label)) ? 0 : 1; const bounds = element.getBoundingClientRect(); const distance = inputBounds ? Math.hypot(bounds.left - inputBounds.left, bounds.top - inputBounds.top) : 0; return exactRank * 1000000 + distance; };
    const selected = matches.sort((left, right) => score(left) - score(right))[0];
    if (!selected) return null;
    const bounds = selected.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`);
}

async function waitForRemoteFlowPoint(client, labels, exact = false, timeout = 15_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await remoteFlowPoint(client, labels, exact).catch(() => null);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy điều khiển Google Flow qua CDP: " + labels.join(" / ") + ".");
}

async function remoteFlowClick(client, point) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: Math.round(point.x), y: Math.round(point.y) });
  await delay(120);
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: Math.round(point.x), y: Math.round(point.y), button: "left", clickCount: 1 });
  await delay(70);
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: Math.round(point.x), y: Math.round(point.y), button: "left", clickCount: 1 });
}

async function waitForRemoteFlowUploadPoint(client, timeout = 15_000) {
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await client.evaluate(`(() => {
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'; };
      const selected = roots.flatMap((root) => [...root.querySelectorAll('button[role="menuitem"], [role="menuitem"], flow-menu-item, [data-menu-item]')]).find((element) => {
        if (!visible(element) || element.disabled) return false;
        const values = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent].filter(Boolean).map(normalize);
        const combined = values.join(' ');
        return values.includes('upload') || (combined.includes('upload') && !combined.includes('uploads'));
      });
      if (!selected) return null; const bounds = selected.getBoundingClientRect(); return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy mục Upload trong menu Google Flow qua CDP.");
}

async function waitForRemoteFlowAsset(client, filename, beforeImageCount = 0) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    const ready = await client.evaluate(`(() => {
      const target = ${JSON.stringify(filename)}.toLowerCase(); const text = document.body?.innerText || '';
      const uploading = /đang tải lên|uploading|đang tải bản xem trước|loading preview|\\b(?:[1-9]?\\d)%\\b/i.test(text);
      const roots = [document]; const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) for (const element of roots[index].querySelectorAll('*')) if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      const hasFilename = roots.flatMap((root) => [...root.querySelectorAll('*')]).some((element) => [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')].filter(Boolean).some((value) => value.toLowerCase().includes(target)));
      const visibleImages = roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => { const bounds = image.getBoundingClientRect(); const style = getComputedStyle(image); return bounds.width >= 32 && bounds.height >= 32 && image.complete && (image.naturalWidth || image.width) >= 64 && style.visibility !== 'hidden' && style.display !== 'none'; }).length;
      return !uploading && (hasFilename || visibleImages > ${beforeImageCount});
    })()`);
    if (ready) return;
    await delay(500);
  }
  throw new Error("Google Flow chưa tải xong ảnh " + filename + ".");
}

async function uploadFlowAssetViaRemoteCdp(window, filePath, attachToPrompt, onStatus) {
  const client = await getFlowRemoteClient(window);
  if (!client) return false;
  try {
    onStatus("Đã kết nối target Google Flow bằng CDP.");
    const filename = path.basename(filePath);
    const beforeImageCount = await client.evaluate(`(() => [...document.querySelectorAll('img')].filter((image) => image.complete && (image.naturalWidth || image.width) >= 64).length)()`);
    const mediaPoint = await waitForRemoteFlowPoint(client, ["Add media menu", "Thêm nội dung nghe nhìn", "Thêm phương tiện"], true);
    await client.send("Page.enable", { enableFileChooserOpenedEvent: true }).catch(() => client.send("Page.enable"));
    await client.send("Page.setInterceptFileChooserDialog", { enabled: true });
    await client.evaluate(`document.querySelector('button[aria-label="Add media menu"]').click()`);
    await delay(600);
    onStatus("Đã mở menu thêm nội dung bằng CDP, đang tìm Upload...");
    const uploadPoint = await waitForRemoteFlowUploadPoint(client);
    onStatus("Đã tìm thấy Upload bằng CDP.");
    await remoteFlowClick(client, uploadPoint);
    onStatus("Đã nhấn Upload bằng CDP, đang chờ hộp chọn tệp Google Flow...");
    const chooser = await client.waitForEvent("Page.fileChooserOpened", 12_000);
    if (!chooser?.backendNodeId) throw new Error("Google Flow không trả về backendNodeId cho file chooser qua CDP: " + JSON.stringify(chooser));
    await client.send("DOM.enable").catch(() => {});
    await client.send("DOM.setFileInputFiles", { files: [filePath], backendNodeId: chooser.backendNodeId });
    onStatus("Đã gắn tệp vào Google Flow bằng CDP, đang chờ Flow lưu ảnh...");
    await waitForRemoteFlowAsset(client, filename, beforeImageCount);
    if (!attachToPrompt) return true;
    await attachFlowAssetToPrompt(window, filename, await countFlowPromptAttachments(window));
    return true;
  } finally { /* Giữ phiên CDP dùng chung cho các bước tiếp theo của Flow. */ }
}

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

function closeFlowWindow() {
  flowRemoteClient?.close();
  flowRemoteClient = undefined;
  const window = flowWindow;
  flowWindow = undefined;
  flowLoadPromise = undefined;
  if (window && !window.isDestroyed()) window.close();
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.webContents.focus();
  }
}

function waitForGeminiLoad(window) {
  if (window.webContents.isLoading() && geminiLoadPromise) return geminiLoadPromise;
  return Promise.resolve();
}

async function waitForFlowLoad(window) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    if (window.isDestroyed()) throw new Error("Cửa sổ Google Flow đã bị đóng.");
    try {
      const state = await executeFlowJavaScript(window, `(() => ({ readyState: document.readyState, url: window.location.href }))()`);
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
    const ready = await executeFlowJavaScript(window, `(() => {
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

function findChannelMainCharacterImagePath(channelId) {
  const characterRoot = path.join(app.getPath("userData"), "channel-characters");
  for (const extension of [".png", ".jpg", ".webp", ".gif", ".bmp", ".avif"]) {
    const target = path.join(characterRoot, `${channelId}${extension}`);
    if (fs.existsSync(target)) return target;
  }
  return null;
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

function clampNumber(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function readMediaDuration(filePath) {
  return runFfmpeg(["-hide_banner", "-i", filePath, "-f", "null", "-"], true).then((output) => {
    const match = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
    if (!match) throw new Error(`Không đọc được thời lượng video: ${path.basename(filePath)}.`);
    const duration = (Number(match[1]) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
    if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Video không có thời lượng hợp lệ: ${path.basename(filePath)}.`);
    return duration;
  });
}

function normalizeVideoEditOptions(value, sceneNumbers) {
  const requestedScenes = Array.isArray(value?.scenes) && value.scenes.length > 0
    ? value.scenes
    : sceneNumbers.map((sceneNumber) => ({ sceneNumber, trimStart: 0, trimEnd: 0 }));
  const requestedNumbers = requestedScenes.map((scene) => scene?.sceneNumber);
  if (requestedScenes.length !== sceneNumbers.length
    || requestedNumbers.some((sceneNumber) => !Number.isInteger(sceneNumber) || !sceneNumbers.includes(sceneNumber))
    || new Set(requestedNumbers).size !== requestedNumbers.length) {
    throw new Error("Danh sách phân cảnh chỉnh sửa không hợp lệ.");
  }
  const transition = value?.transition === "fade" ? "fade" : "none";
  return {
    scenes: requestedScenes.map((scene) => ({
      sceneNumber: scene.sceneNumber,
      trimStart: clampNumber(scene.trimStart, 0, 3600, 0),
      trimEnd: clampNumber(scene.trimEnd, 0, 3600, 0),
    })),
    transition,
    transitionDuration: clampNumber(value?.transitionDuration, 0.2, 0.4, 0.3),
    originalVolume: clampNumber(value?.originalVolume, 0, 2, 1),
    musicVolume: clampNumber(value?.musicVolume, 0, 2, 0.2),
    musicPath: typeof value?.musicPath === "string" && value.musicPath.trim() ? value.musicPath : "",
  };
}

function validateAudioFile(filePath) {
  if (!filePath) return;
  const allowedExtensions = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
  if (!allowedExtensions.has(path.extname(filePath).toLowerCase())) throw new Error("Định dạng nhạc hoặc hiệu ứng âm thanh chưa được hỗ trợ.");
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) throw new Error("Không tìm thấy tệp nhạc hoặc hiệu ứng âm thanh đã chọn.");
  if (fs.statSync(filePath).size > 200 * 1024 * 1024) throw new Error("Tệp nhạc hoặc hiệu ứng âm thanh phải nhỏ hơn 200 MB.");
}

async function renderFinalVideo(event, projectId, sceneNumbers, rawOptions = {}) {
  const options = normalizeVideoEditOptions(rawOptions, sceneNumbers);
  validateAudioFile(options.musicPath);
  const orderedScenes = options.scenes;
  const videoRoot = path.join(app.getPath("userData"), "generated-videos", projectId);
  const sourceFiles = orderedScenes.map((scene) => path.join(videoRoot, `scene-${scene.sceneNumber}.mp4`));
  for (const source of sourceFiles) {
    if (!fs.existsSync(source) || fs.statSync(source).size < 1024) throw new Error("Thiếu video của một hoặc nhiều phân cảnh. Hãy tạo lại cảnh bị thiếu trước khi ghép.");
  }

  const finalPath = path.join(videoRoot, "final.mp4");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "modeling-ai-edit-"));
  try {
    event.sender.send("video-editor:progress", { stage: "normalize", processed: 0, total: sourceFiles.length, label: "Đang chuẩn hóa video..." });
    const normalized = [];
    const durations = [];
    for (let index = 0; index < sourceFiles.length; index += 1) {
      const sceneOptions = orderedScenes[index];
      const sourceDuration = await readMediaDuration(sourceFiles[index]);
      const targetDuration = sourceDuration - sceneOptions.trimStart - sceneOptions.trimEnd;
      if (targetDuration < 0.2) throw new Error(`Cảnh ${sceneOptions.sceneNumber} còn quá ngắn sau khi cắt đầu/cuối.`);
      const target = path.join(temporaryRoot, `scene-${index + 1}.mp4`);
      await runFfmpeg(["-y", "-hide_banner", "-ss", sceneOptions.trimStart.toFixed(3), "-i", sourceFiles[index], "-t", targetDuration.toFixed(3), "-vf", "scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30", "-c:v", "h264_mf", "-b:v", "4500k", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", target]);
      normalized.push(target);
      durations.push(targetDuration);
      event.sender.send("video-editor:progress", { stage: "normalize", processed: index + 1, total: sourceFiles.length, label: `Đã chuẩn hóa cảnh ${sceneOptions.sceneNumber}.` });
    }

    event.sender.send("video-editor:progress", { stage: "render", processed: 0, total: 1, label: "Đang ghép các phân cảnh..." });
    const assembledPath = path.join(temporaryRoot, "assembled.mp4");
    if (normalized.length === 1) {
      fs.copyFileSync(normalized[0], assembledPath);
    } else if (options.transition === "fade") {
      const transitionDuration = options.transitionDuration;
      const filters = [];
      let videoLabel = "0:v";
      let audioLabel = "0:a";
      let accumulatedDuration = durations[0];
      for (let index = 1; index < normalized.length; index += 1) {
        const offset = Math.max(0.01, accumulatedDuration - transitionDuration);
        const nextVideoLabel = `video${index}`;
        const nextAudioLabel = `audio${index}`;
        filters.push(`[${videoLabel}][${index}:v]xfade=transition=fade:duration=${transitionDuration.toFixed(3)}:offset=${offset.toFixed(3)}[${nextVideoLabel}]`);
        filters.push(`[${audioLabel}][${index}:a]acrossfade=d=${transitionDuration.toFixed(3)}:c1=tri:c2=tri[${nextAudioLabel}]`);
        videoLabel = nextVideoLabel;
        audioLabel = nextAudioLabel;
        accumulatedDuration += durations[index] - transitionDuration;
      }
      await runFfmpeg(["-y", "-hide_banner", ...normalized.flatMap((file) => ["-i", file]), "-filter_complex", filters.join(";"), "-map", `[${videoLabel}]`, "-map", `[${audioLabel}]`, "-c:v", "h264_mf", "-b:v", "4500k", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", assembledPath]);
    } else {
      const playlistPath = path.join(temporaryRoot, "playlist.txt");
      fs.writeFileSync(playlistPath, normalized.map((file) => `file '${file.replace(/'/g, "'\\\\''")}'`).join("\n"), "utf8");
      await runFfmpeg(["-y", "-hide_banner", "-f", "concat", "-safe", "0", "-i", playlistPath, "-c", "copy", "-movflags", "+faststart", assembledPath]);
    }

    if (options.musicPath || options.originalVolume !== 1) {
      event.sender.send("video-editor:progress", { stage: "audio", processed: 0, total: 1, label: options.musicPath ? "Đang trộn âm thanh Flow với nhạc/hiệu ứng..." : "Đang điều chỉnh âm thanh Flow..." });
      const audioFilters = [`[0:a]volume=${options.originalVolume.toFixed(3)}[original]`];
      const audioInputs = ["-i", assembledPath];
      let audioMap = "[original]";
      if (options.musicPath) {
        audioInputs.push("-stream_loop", "-1", "-i", options.musicPath);
        audioFilters.push(`[1:a]volume=${options.musicVolume.toFixed(3)}[music]`);
        audioFilters.push("[original][music]amix=inputs=2:duration=first:dropout_transition=2[mixed]");
        audioMap = "[mixed]";
      }
      await runFfmpeg(["-y", "-hide_banner", ...audioInputs, "-filter_complex", audioFilters.join(";"), "-map", "0:v", "-map", audioMap, "-c:v", "copy", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-shortest", "-movflags", "+faststart", finalPath]);
      event.sender.send("video-editor:progress", { stage: "audio", processed: 1, total: 1, label: "Đã xử lý âm thanh." });
    } else {
      fs.copyFileSync(assembledPath, finalPath);
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
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) {
    await remoteFlowClick(remoteClient, { x, y });
    return;
  }
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
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) return remoteFlowPoint(remoteClient, labels, exact);
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

async function waitForFlowUploadMenuPoint(window, timeout = 15_000) {
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) return waitForRemoteFlowUploadPoint(remoteClient, timeout);
  for (let elapsed = 0; elapsed < timeout; elapsed += 500) {
    const point = await executeFlowJavaScript(window, `(() => {
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const normalize = (value) => (value || '').replace(/\\s+/g, ' ').trim().toLowerCase();
      const visible = (element) => {
        const bounds = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return bounds.width > 0 && bounds.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
      };
      const matches = roots.flatMap((root) => [...root.querySelectorAll('button[role="menuitem"], [role="menuitem"], flow-menu-item, [data-menu-item]')])
        .filter((element) => visible(element) && !element.disabled)
        .filter((element) => {
          const aria = normalize(element.getAttribute('aria-label'));
          const title = normalize(element.getAttribute('title'));
          const text = normalize(element.textContent);
          const combined = [aria, title, text].filter(Boolean).join(' ');
          return aria === 'upload' || title === 'upload' || (combined.includes('upload') && !combined.includes('uploads'));
        });
      const selected = matches[0];
      if (!selected) return null;
      const bounds = selected.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    })()`, true);
    if (point) return point;
    await delay(500);
  }
  throw new Error("Không tìm thấy mục Upload trong menu Google Flow.");
}

async function clickFlowControl(window, labels, exact = false, timeout = 30_000) {
  const point = await waitForFlowControlPoint(window, labels, exact, timeout);
  await dispatchBrowserClick(window, point);
  await delay(350);
}

async function dispatchBrowserEscape(window) {
  const remoteClient = await getFlowRemoteClient(window);
  if (remoteClient) {
    await remoteClient.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await remoteClient.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await delay(350);
    return;
  }
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
  return executeFlowJavaScript(window, expression);
}

async function findFlowFileInput(window) {
  return window.webContents.debugger.sendCommand("Runtime.evaluate", {
    expression: "(() => { const roots = [document]; const seen = new Set(roots); for (let index = 0; index < roots.length; index += 1) { for (const element of roots[index].querySelectorAll('*')) { if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); } } } return roots.flatMap((root) => [...root.querySelectorAll('input[type=file]')]).find((input) => !input.disabled) || null; })()",
    returnByValue: false,
  });
}

async function findFlowFileInputBackendNodeId(window) {
  const document = await window.webContents.debugger.sendCommand("DOM.getDocument", { depth: -1, pierce: true });
  const pending = document?.root ? [document.root] : [];
  while (pending.length > 0) {
    const node = pending.shift();
    const attributes = node.attributes || [];
    const type = attributes[attributes.indexOf("type") + 1]?.toLowerCase();
    if (node.nodeName?.toLowerCase() === "input" && type === "file" && node.backendNodeId) return node.backendNodeId;
    if (Array.isArray(node.children)) pending.push(...node.children);
    if (Array.isArray(node.shadowRoots)) pending.push(...node.shadowRoots);
    if (node.contentDocument) pending.push(node.contentDocument);
  }
  return null;
}

async function countFlowVisualImages(window) {
  return executeFlowJavaScript(window, `(() => {
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    return roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => {
      const bounds = image.getBoundingClientRect();
      const style = getComputedStyle(image);
      return bounds.width >= 32 && bounds.height >= 32 && image.complete && (image.naturalWidth || image.width) >= 64
        && style.visibility !== 'hidden' && style.display !== 'none';
    }).length;
  })()`, true);
}

async function waitForFlowAsset(window, filename, beforeImageCount = 0) {
  for (let elapsed = 0; elapsed < 60_000; elapsed += 500) {
    const ready = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(filename)}.toLowerCase();
      const text = document.body?.innerText || '';
      const uploading = /đang tải lên|uploading|đang tải bản xem trước|loading preview|\\b(?:[1-9]?\\d)%\\b/i.test(text);
      const roots = [document];
      const seen = new Set(roots);
      for (let index = 0; index < roots.length; index += 1) {
        for (const element of roots[index].querySelectorAll('*')) {
          if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
        }
      }
      const hasFilename = roots.flatMap((root) => [...root.querySelectorAll('*')]).some((element) =>
        [element.textContent, element.getAttribute('aria-label'), element.getAttribute('title'), element.getAttribute('alt')]
          .filter(Boolean)
          .some((value) => value.toLowerCase().includes(target))
      );
      const visibleImages = roots.flatMap((root) => [...root.querySelectorAll('img')]).filter((image) => {
        const bounds = image.getBoundingClientRect();
        const style = getComputedStyle(image);
        return bounds.width >= 32 && bounds.height >= 32 && image.complete && (image.naturalWidth || image.width) >= 64
          && style.visibility !== 'hidden' && style.display !== 'none';
      }).length;
      return !uploading && (hasFilename || visibleImages > ${beforeImageCount});
    })()`, true);
    if (ready) return;
    await delay(500);
  }
  throw new Error("Google Flow chưa tải xong ảnh " + filename + ".");
}

async function countFlowPromptAttachments(window) {
  return executeFlowJavaScript(window, `(() => {
    const attachedImages = [...document.querySelectorAll('flow-base-prompt-box img[alt="Ingredient image"]')].filter((image) => image.getBoundingClientRect().width > 0);
    if (attachedImages.length) return attachedImages.length;
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
    const input = roots.flatMap((root) => [...root.querySelectorAll('textarea, [contenteditable="true"]')]).find((element) => visible(element) && element.getBoundingClientRect().width > 100);
    if (!input) return 0;
    let container = input;
    for (let depth = 0; depth < 7 && container.parentElement; depth += 1) {
      const parent = container.parentElement;
      const bounds = parent.getBoundingClientRect();
      if (bounds.width > input.getBoundingClientRect().width + 260 || bounds.height > 650) break;
      container = parent;
    }
    return [...container.querySelectorAll('img')].filter((image) => {
      if (!visible(image)) return false;
      const bounds = image.getBoundingClientRect();
      return bounds.width >= 28 && bounds.height >= 28 && bounds.width <= 180 && bounds.height <= 180;
    }).length;
  })()`, true);
}

async function findFlowAssetTilePoint(window, filename) {
  return executeFlowJavaScript(window, `(() => {
    const target = ${JSON.stringify(filename)}.toLowerCase();
    const roots = [document];
    const seen = new Set(roots);
    for (let index = 0; index < roots.length; index += 1) {
      for (const element of roots[index].querySelectorAll('*')) {
        if (element.shadowRoot && !seen.has(element.shadowRoot)) { seen.add(element.shadowRoot); roots.push(element.shadowRoot); }
      }
    }
    const visible = (element) => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return bounds.width >= 32 && bounds.height >= 32 && style.visibility !== 'hidden' && style.display !== 'none';
    };
    const candidates = roots.flatMap((root) => [...root.querySelectorAll('flow-grid-tile-container')]).filter((element) => {
      if (!visible(element)) return false;
      const values = [element.getAttribute('aria-label'), element.getAttribute('title'), element.textContent]
        .filter(Boolean).map((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase());
      return values.some((value) => value === target || value.includes(target));
    });
    const selected = candidates[0];
    if (!selected) return null;
    const bounds = selected.getBoundingClientRect();
    return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
  })()`, true);
}

async function attachFlowAssetToPrompt(window, filename, previousAttachmentCount) {
  if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
  await dispatchBrowserEscape(window);
  const ingredientsPoint = await waitForFlowControlPoint(window, ["Add ingredients to the prompt box", "Thêm thành phần vào hộp câu lệnh", "Thêm thành phần vào ô nhập câu lệnh"], false, 15_000);
  await dispatchBrowserClick(window, ingredientsPoint);
  await delay(600);
  const assetPoint = await waitForFlowControlPoint(window, [filename], false, 10_000);
  if (!assetPoint) throw new Error("Không tìm thấy đúng ảnh tham chiếu " + filename + " trong Google Flow.");
  await dispatchBrowserClick(window, assetPoint);
  for (let elapsed = 0; elapsed < 5_000; elapsed += 250) {
    if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
    await delay(250);
  }
  await clickFlowControl(window, ["Add to prompt", "Thêm vào câu lệnh", "Thêm vào prompt"], true, 30_000);
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    if (await countFlowPromptAttachments(window) > previousAttachmentCount) return;
    await delay(500);
  }
  throw new Error("Ảnh nhân vật chính chưa được gắn vào cùng prompt Google Flow.");
}

async function uploadFlowAsset(window, filePath, attachToPrompt = false, onStatus = () => {}) {
  const filename = path.basename(filePath);
  const beforeImageCount = await countFlowVisualImages(window);
  const previousAttachmentCount = attachToPrompt ? await countFlowPromptAttachments(window) : 0;
  if (await findFlowAssetPoint(window, filename)) {
    if (attachToPrompt) await attachFlowAssetToPrompt(window, filename, previousAttachmentCount);
    return;
  }
  if (getRemoteDebuggingPort()) {
    const uploaded = await uploadFlowAssetViaRemoteCdp(window, filePath, attachToPrompt, onStatus);
    if (uploaded) return;
  }
  if (!window.webContents.debugger.isAttached()) window.webContents.debugger.attach("1.3");
  let fileChooserResolve;
  const fileChooserPromise = new Promise((resolve) => { fileChooserResolve = resolve; });
  const fileChooserListener = (_event, method, params) => {
    if (method === "Page.fileChooserOpened") {
      onStatus("Đã nhận sự kiện file chooser từ Google Flow.");
      console.log("[Flow upload] Page.fileChooserOpened", params);
      fileChooserResolve(params || {});
    }
  };
  window.webContents.debugger.on("message", fileChooserListener);
  try {
    await window.webContents.debugger.sendCommand("Page.enable", { enableFileChooserOpenedEvent: true });
  } catch (error) {
    console.log("[Flow upload] Page.enable mở rộng không thành công", error?.message || error);
    try { await window.webContents.debugger.sendCommand("Page.enable"); } catch (fallbackError) {
      onStatus("CDP không bật được Page.enable: " + (fallbackError?.message || fallbackError));
      throw fallbackError;
    }
  }
  try { await window.webContents.debugger.sendCommand("Page.setInterceptFileChooserDialog", { enabled: true }); } catch (error) {
    onStatus("CDP không bật được chế độ bắt file chooser: " + (error?.message || error));
    throw error;
  }
  const mediaMenuPoint = await waitForFlowControlPoint(window, ["Add media menu", "Thêm nội dung nghe nhìn", "Thêm phương tiện"], true, 5_000).catch(() => null);
  onStatus(mediaMenuPoint ? "Đã tìm thấy nút Add media menu của Flow." : "Không thấy Add media menu, đang dùng nút thành phần dự phòng.");
  const ingredientsPoint = mediaMenuPoint
    ? null
    : await waitForFlowControlPoint(window, ["Add ingredients to the prompt box", "Thêm thành phần vào hộp câu lệnh", "Thêm thành phần vào ô nhập câu lệnh"], false, 15_000);
  await dispatchBrowserClick(window, mediaMenuPoint ?? ingredientsPoint);
  onStatus("Đã mở menu thêm nội dung Google Flow, đang tìm Upload...");
  const uploadPoint = await waitForFlowUploadMenuPoint(window, 15_000);
  await dispatchBrowserClick(window, uploadPoint);
  onStatus("Đã nhấn Upload, đang chờ hộp chọn tệp Google Flow...");
  console.log("[Flow upload] Đã nhấn Upload, đang chờ hộp chọn tệp Google Flow...");
  let chooser = null;
  let chooserReceived = false;
  const chooserWait = fileChooserPromise.then((params) => {
    chooserReceived = true;
    return params;
  });
  for (let elapsed = 0; elapsed < 12_000 && !chooserReceived; elapsed += 250) {
    await window.webContents.debugger.sendCommand("Runtime.evaluate", { expression: "void 0", returnByValue: true }).catch(() => {});
    chooser = await Promise.race([chooserWait, delay(250).then(() => null)]);
  }
  window.webContents.debugger.removeListener("message", fileChooserListener);
  if (chooser === null) {
    for (let elapsed = 0; elapsed < 3_000 && !chooserReceived; elapsed += 250) {
      const backendNodeId = await findFlowFileInputBackendNodeId(window).catch(() => null);
      if (backendNodeId) {
        onStatus("Đã tìm thấy ô file bằng CDP DOM, đang gắn tệp...");
        await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], backendNodeId });
        chooser = { backendNodeId };
        break;
      }
      await delay(250);
    }
    if (chooser === null) throw new Error("Google Flow không phát sự kiện file chooser và không tìm thấy ô file bằng CDP DOM để tải " + filename + ".");
  }
  if (chooser?.backendNodeId) {
    onStatus("Đã bắt sự kiện file chooser của Google Flow.");
    console.log("[Flow upload] Đã bắt sự kiện file chooser của Google Flow.");
    try { await window.webContents.debugger.sendCommand("DOM.enable"); } catch { /* DOM có thể đã được bật sẵn. */ }
    await window.webContents.debugger.sendCommand("DOM.setFileInputFiles", { files: [filePath], backendNodeId: chooser.backendNodeId });
    onStatus("Đã gắn tệp vào Google Flow, đang chờ Flow lưu ảnh...");
    console.log("[Flow upload] Đã gắn tệp vào Google Flow, đang chờ Flow lưu ảnh...");
    await waitForFlowAsset(window, filename, beforeImageCount);
    if (attachToPrompt) await attachFlowAssetToPrompt(window, filename, previousAttachmentCount);
    else await dispatchBrowserEscape(window);
    return;
  }
  throw new Error("Google Flow đã phát file chooser nhưng thiếu backendNodeId khi tải " + filename + ".");
}

async function addFlowAssetToStart(window, filePath) {
  const filename = path.basename(filePath);
  await clickFlowControl(window, ["Bắt đầu", "Start"], true);
  let selected = false;
  for (let elapsed = 0; elapsed < 20_000 && !selected; elapsed += 250) {
    selected = await executeFlowJavaScript(window, `(() => {
      const target = ${JSON.stringify(filename)}.toLowerCase();
      const visible = (element) => { const bounds = element.getBoundingClientRect(); const style = getComputedStyle(element); return bounds.width > 0 && bounds.height > 0 && style.display !== 'none' && style.visibility !== 'hidden'; };
      const matches = [...document.querySelectorAll('button')].filter((element) => visible(element) && [element.textContent, element.getAttribute('aria-label')].filter(Boolean).some((value) => value.replace(/\\s+/g, ' ').trim().toLowerCase() === target));
      const button = matches.find((element) => element.closest('.cdk-overlay-pane, [role="dialog"]')) || matches[matches.length - 1];
      if (!button) return false;
      button.click();
      return true;
    })()`);
    if (!selected) await delay(250);
  }
  if (!selected) throw new Error("Không tìm thấy ảnh " + filename + " trong bảng chọn Start frame Google Flow.");
  const hasStartFrame = () => executeFlowJavaScript(window, `(() => {
    const start = [...document.querySelectorAll('flow-ingredient-bar .frame-trigger')][0];
    return Boolean(start?.querySelector('img, .filled-chip, flow-media-chip, flow-image-ingredient-chip'));
  })()`);
  for (let elapsed = 0; elapsed < 2_000; elapsed += 250) {
    if (await hasStartFrame()) return;
    await delay(250);
  }
  let confirmed = false;
  for (let elapsed = 0; elapsed < 5_000 && !confirmed; elapsed += 250) {
    confirmed = await executeFlowJavaScript(window, `(() => {
    const labels = ['add to prompt', 'thêm vào câu lệnh', 'thêm vào prompt'];
    const button = [...document.querySelectorAll('button')].find((element) => labels.includes((element.textContent || '').replace(/\\s+/g, ' ').trim().toLowerCase()));
    if (!button || button.disabled) return false;
    button.click();
    return true;
  })()`);
    if (!confirmed) await delay(250);
  }
  if (!confirmed && !await hasStartFrame()) throw new Error("Không xác nhận được ảnh " + filename + " vào Start frame Google Flow.");
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    const attached = await hasStartFrame();
    if (attached) return;
    await delay(250);
  }
  throw new Error("Ảnh cảnh " + filename + " chưa được đặt vào Start frame Google Flow.");
}

async function clearFlowComposer(window) {
  const point = await findFlowControlPoint(window, ["Xoá câu lệnh", "Xóa câu lệnh", "Clear prompt"], false);
  if (point) {
    await dispatchBrowserClick(window, point);
    await delay(500);
  }
}

async function ensureFlowMode(window, modes) {
  const wanted = (Array.isArray(modes) ? modes : [modes]).map((mode) => mode.toLowerCase());
  for (let elapsed = 0; elapsed < 15_000; elapsed += 500) {
    const state = await executeFlowJavaScript(window, `(() => {
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
        .find((element) => isVisible(element) && labelsFor(element).some((label) => ${JSON.stringify(wanted)}.some((value) => label === value || label.endsWith(' ' + value) || label.endsWith(value))));
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
  throw new Error('Không tìm thấy chế độ ' + wanted.join(' / ') + ' trong cài đặt Google Flow.');
}

async function configureFlowVideo(window) {
  await clickFlowControl(window, ["Điều kiện kích hoạt cài đặt", "Video settings", "Settings"], false);
  await ensureFlowMode(window, ["Video"]);
  await clickFlowControl(window, ["9:16"], true);
  await clickFlowControl(window, ["Chọn nhóm mô hình", "Select model", "Model"], false);
  await clickFlowControl(window, ["Veo 3.1 - Lite [Lower Priority]"], true, 15_000);
  const qualityPoint = await findFlowControlPoint(window, ["720p"], true);
  if (qualityPoint) { await dispatchBrowserClick(window, qualityPoint); await delay(350); }
  await clickFlowControl(window, ["4 giây", "4 seconds", "4s"], false);
  await clickFlowControl(window, ["x1"], true);
  // Flow exposes the Start/End frame inputs after the other settings are set.
  await clickFlowControl(window, ["Frames"], true);
  await dispatchBrowserEscape(window);
}

async function configureFlowImage(window) {
  await clickFlowControl(window, ["Điều kiện kích hoạt cài đặt", "Video settings", "Settings"], false);
  await ensureFlowMode(window, ["Image", "Ảnh"]);
  await clickFlowControl(window, ["9:16"], true);
  await clickFlowControl(window, ["Chọn nhóm mô hình", "Select model", "Model"], false);
  await clickFlowControl(window, ["Nano Banana Pro"], true, 15_000);
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
      const enterFlowPoint = await findFlowControlPoint(window, ["Create with Google Flow", "Tạo bằng Google Flow", "Try Google Flow", "Thử Google Flow"], true);
      if (enterFlowPoint) {
        const clicked = await executeFlowJavaScript(window, `(() => {
          const labels = ["Create with Google Flow", "Tạo bằng Google Flow", "Try Google Flow", "Thử Google Flow"];
          const wanted = labels.map((value) => value.toLowerCase());
          const button = [...document.querySelectorAll("button, [role=\"button\"]")].find((element) => {
            const values = [element.getAttribute("aria-label"), element.textContent]
              .filter(Boolean)
              .map((value) => value.replace(/\\s+/g, " ").trim().toLowerCase());
            return values.some((value) => wanted.includes(value));
          });
          if (!button) return false;
          button.click();
          return true;
        })()`, true);
        if (!clicked) await dispatchBrowserClick(window, enterFlowPoint);
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
    const ready = await executeFlowJavaScript(window, `(() => {
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
  return executeFlowJavaScript(window, expression).then((state) => ({ ...state, beforeCardCount }));
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
  const dataUrl = await executeFlowJavaScript(window, "(async () => { const video = [...document.querySelectorAll('video')].reverse().find((candidate) => (candidate.currentSrc || candidate.src || '').startsWith('blob:')); if (!video) return null; const response = await window.fetch(video.currentSrc || video.src); const blob = await response.blob(); return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); })()");
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
  return executeFlowJavaScript(window, expression);
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
  const dataUrl = await executeFlowJavaScript(window, "(async () => { const image = [...document.querySelectorAll('img')].reverse().find((candidate) => (candidate.currentSrc || candidate.src || '').startsWith('blob:')); if (!image) return null; const response = await window.fetch(image.currentSrc || image.src); const blob = await response.blob(); return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); }); })()");
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

async function runFlowImageJob(event, projectId, channelId, slots) {
  event.sender.send("flow-browser:image-progress", { processed: 0, total: slots.length, label: "Đang mở Google Flow..." });
  const window = createFlowWindow();
  const images = {};
  const characterReferencePath = findChannelMainCharacterImagePath(channelId);
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const isBackground = slot?.kind === "background";
    const isScene = slot?.kind === "scene";
    if (!slot || (!isBackground && !isScene) || (isScene && (!Number.isInteger(slot.sceneNumber) || slot.sceneNumber < 1)) || (isBackground && slot.sceneNumber !== 0) || typeof slot.prompt !== "string" || !slot.prompt.trim()) {
      throw new Error("Dữ liệu ảnh tạo bằng Google Flow không hợp lệ.");
    }
    event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang mở project Google Flow riêng cho " + (slot.label || "ảnh") + "..." });
    const projectUrl = await createFlowProject(window);
    event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: slot.label || "Ảnh " + (index + 1) });
    let slotError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await clearFlowComposer(window);
        event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang cấu hình Google Flow cho " + (slot.label || "ảnh") + "..." });
        await configureFlowImage(window);
        if (isScene && characterReferencePath) {
          event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang gắn ảnh nhân vật chính làm tham chiếu..." });
          await uploadFlowAsset(window, characterReferencePath, true);
        }
        if (isScene) {
          const backgroundPath = findGeneratedImagePath(projectId, "background", 0);
          if (!fs.existsSync(backgroundPath) || fs.statSync(backgroundPath).size < 1024) throw new Error("Ảnh bối cảnh đồng nhất chưa được tạo và lưu thành công vào app.");
          event.sender.send("flow-browser:image-progress", { processed: index, total: slots.length, label: "Đang gắn ảnh bối cảnh đồng nhất làm tham chiếu..." });
          await uploadFlowAsset(window, backgroundPath, true);
        }

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
    const savedPath = findGeneratedImagePath(projectId, slot.kind, sceneNumber);
    if (!fs.existsSync(savedPath) || fs.statSync(savedPath).size < 1024) throw new Error((isBackground ? "Ảnh bối cảnh đồng nhất" : "Ảnh cảnh " + sceneNumber) + " chưa được lưu thành công vào app.");
    images[`${slot.kind}-${sceneNumber}`] = `${url}&v=${Date.now()}`;
    event.sender.send("flow-browser:image-progress", { processed: index + 1, total: slots.length, label: "Đã tải và lưu " + (slot.label || "ảnh") + " vào app" });
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

async function runFlowVideoJob(event, projectId, channelId, slots) {
  event.sender.send("gemini-browser:video-progress", { processed: 0, total: slots.length, label: "Đang mở Google Flow..." });
  const window = createFlowWindow();
  const videos = {};
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    if (!Number.isInteger(slot?.sceneNumber) || typeof slot.visualBlock !== "string" || typeof slot.actionBlock !== "string" || typeof slot.audioBlock !== "string" || typeof slot.englishPrompt !== "string" || !slot.englishPrompt.trim()) {
      throw new Error("Dữ liệu phân cảnh tạo video không hợp lệ.");
    }
    const sceneNumber = slot.sceneNumber;
    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: `Đang mở project Google Flow riêng cho cảnh ${sceneNumber}...` });
    const projectUrl = await createFlowProject(window);
    const imagePath = findSceneImagePath(projectId, sceneNumber);
    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: slot.label || "Cảnh " + sceneNumber });

    await clearFlowComposer(window);
    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang cấu hình Google Flow cho cảnh " + sceneNumber + "..." });
    await configureFlowVideo(window);
    event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label: "Đang tải đúng ảnh cảnh " + sceneNumber + " lên Google Flow..." });
    await uploadFlowAsset(window, imagePath, false, (label) => event.sender.send("gemini-browser:video-progress", { processed: index, total: slots.length, label }));
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
    const prompt = "Create one 4-second " + videoFormat + " video from the attached start-frame image. Use that image as the exact Start frame for scene " + sceneNumber + ". The start-frame image already combines the approved fixed main character and approved background, so preserve the exact character identity, silhouette, face, colors, clothing, proportions, environment, lighting, composition, props, and art style shown in it. First follow this video-scene prompt written by Gemini without changing its meaning: " + slot.englishPrompt + ". Do not use an End frame and do not add unrelated characters, props, actions, or story beats. Animate only the one primary action specified for this scene. Action reference: " + slot.actionBlock + ". Camera and visual direction reference: " + slot.visualBlock + ". Audio and sound direction reference: " + slot.audioBlock + ". Generate one final video with audio.";
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
    event.sender.send("gemini-browser:video-progress", { processed: index + 1, total: slots.length, label: `Đã tải và lưu thành công video cảnh ${sceneNumber}.` });
  }
  return { status: "completed", videos };
}


ipcMain.handle("flow-browser:run-image-job", async (event, value) => {
  const projectId = value?.projectId;
  const channelId = value?.channelId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || typeof channelId !== "string" || !/^[A-Za-z0-9_-]+$/.test(channelId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu tạo ảnh bằng Google Flow không hợp lệ.");
  }
  const result = await runFlowImageJob(event, projectId, channelId, slots);
  closeFlowWindow();
  return result;
});

ipcMain.handle("gemini-browser:run-video-job", async (event, value) => {
  const projectId = value?.projectId;
  const channelId = value?.channelId;
  const slots = value?.slots;
  if (typeof projectId !== "string" || !/^[A-Za-z0-9_-]+$/.test(projectId) || typeof channelId !== "string" || !/^[A-Za-z0-9_-]+$/.test(channelId) || !Array.isArray(slots) || slots.length === 0) {
    throw new Error("Yêu cầu tạo video không hợp lệ.");
  }
  const result = await runFlowVideoJob(event, projectId, channelId, slots);
  closeFlowWindow();
  return result;
});

ipcMain.handle("gemini-browser:open-flow", async () => {
  const window = createFlowWindow();
  await waitForFlowLoad(window);
  window.show();
  window.focus();
  return { status: "opened" };
});

ipcMain.handle("video-editor:pick-audio", async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: "Chọn nhạc nền hoặc hiệu ứng âm thanh",
    properties: ["openFile"],
    filters: [{ name: "Tệp âm thanh", extensions: ["mp3", "wav", "m4a", "aac", "ogg", "flac"] }],
  });
  if (selection.canceled || !selection.filePaths[0]) return { status: "cancelled" };
  return { status: "selected", path: selection.filePaths[0], name: path.basename(selection.filePaths[0]) };
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
  return renderFinalVideo(event, projectId, sceneNumbers, value?.options);
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
  await startLocalServices();
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
