/* eslint-disable no-console */
const { EventEmitter } = require("node:events");
const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");

const DEFAULT_PROFILE = path.join(process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || process.cwd(), "AppData", "Local"), "ModelingAI", "EdgeGeminiProfile");
const DEFAULT_PORT = 9333;
const EDGE_RUNTIME_MARKER = "edge-gemini-runtime.json";

function isGeminiUrl(value) {
  return typeof value === "string" && /^https:\/\/gemini\.google\.com\//i.test(value);
}

function isFlowUrl(value) {
  return typeof value === "string" && /^https:\/\/flow\.google\.com\//i.test(value);
}

function targetMatches(target, matcher) {
  return Boolean(target && target.type === "page" && target.webSocketDebuggerUrl && (typeof matcher !== "function" || matcher(target.url || "")));
}

function selectManagedPageTarget(targets, matcher) {
  const pages = Array.isArray(targets) ? targets.filter((target) => targetMatches(target, matcher)) : [];
  return pages[0] || null;
}

function normalizePath(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();
}

function discoverEdgeExecutable(env = process.env) {
  const candidates = [
    env.EDGE_EXECUTABLE_PATH,
    env.ProgramFiles && path.join(env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function httpJson(port, pathname, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: "127.0.0.1", port, path: pathname, timeout: timeoutMs, headers: { Accept: "application/json" } }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode !== 200) return reject(new Error(`EDGE_CDP_HTTP_${response.statusCode}`));
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.on("timeout", () => request.destroy(new Error("EDGE_CDP_HTTP_TIMEOUT")));
  });
}

function canBindPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => resolve(true)));
  });
}

function runPowerShell(script) {
  return new Promise((resolve, reject) => {
    execFile("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
      if (error) return reject(error);
      resolve(stdout.trim());
    });
  });
}

async function findManagedEdgeProcesses(profileDirectory) {
  const escaped = String(profileDirectory).replaceAll("'", "''");
  const script = `$profile='${escaped}'; @(Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -and $_.CommandLine -match '--user-data-dir[= ]+\\\"?' + [regex]::Escape($profile) } | Select-Object ProcessId,CommandLine) | ConvertTo-Json -Compress`;
  try {
    const raw = await runPowerShell(script);
    if (!raw) return [];
    const value = JSON.parse(raw);
    return (Array.isArray(value) ? value : [value]).map((item) => ({ pid: Number(item.ProcessId), commandLine: String(item.CommandLine || "") })).filter((item) => Number.isInteger(item.pid) && item.commandLine);
  } catch {
    return [];
  }
}

function portFromCommandLine(commandLine) {
  const match = String(commandLine || "").match(/--remote-debugging-port[= ]+(\d+)/i);
  return match ? Number(match[1]) : null;
}

function hasProfileInCommandLine(commandLine, profileDirectory) {
  const normalized = normalizePath(profileDirectory);
  return String(commandLine || "").toLowerCase().includes(normalized) || String(commandLine || "").toLowerCase().includes(`--user-data-dir=${normalized}`);
}

function isEdgeBrowserVersion(value) {
  return /\bEdg\//i.test(String(value?.Browser || "")) || /Microsoft Edge/i.test(String(value?.Browser || ""));
}

async function readEdgeEndpoint(port) {
  try {
    const version = await httpJson(port, "/json/version");
    if (!isEdgeBrowserVersion(version)) return null;
    const targets = await httpJson(port, "/json/list");
    return { port, version, targets: Array.isArray(targets) ? targets : [] };
  } catch {
    return null;
  }
}

async function choosePort(start = DEFAULT_PORT, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const port = Number(start) + offset;
    if (port > 65535) break;
    if (await canBindPort(port)) return port;
  }
  throw new Error("EDGE_CDP_PORT_UNAVAILABLE");
}

function readRuntimeMarker(profileDirectory) {
  const markerPath = path.join(profileDirectory, EDGE_RUNTIME_MARKER);
  try { return JSON.parse(fs.readFileSync(markerPath, "utf8")); } catch { return null; }
}

function writeRuntimeMarker(profileDirectory, value) {
  fs.mkdirSync(profileDirectory, { recursive: true });
  fs.writeFileSync(path.join(profileDirectory, EDGE_RUNTIME_MARKER), JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
}

function safeOriginPath(value) {
  try { const url = new URL(String(value)); return `${url.origin}${url.pathname}`; } catch { return null; }
}

class EdgeCdpConnection extends EventEmitter {
  constructor(webSocketDebuggerUrl, target) {
    super();
    this.webSocketDebuggerUrl = webSocketDebuggerUrl;
    this.target = target;
    this.socket = new globalThis.WebSocket(webSocketDebuggerUrl);
    this.nextId = 0;
    this.pending = new Map();
    this.opened = false;
    this.readyPromise = new Promise((resolve, reject) => { this.resolveReady = resolve; this.rejectReady = reject; });
    this.socket.onopen = () => { this.opened = true; this.resolveReady(); };
    this.socket.onerror = () => {
      if (!this.opened) this.rejectReady(new Error("EDGE_CDP_CONNECTION_FAILED"));
      this.rejectPending(new Error("EDGE_CDP_CONNECTION_FAILED"));
      this.emit("detach", "connection-error");
    };
    this.socket.onclose = () => { this.rejectPending(new Error("EDGE_CDP_CONNECTION_CLOSED")); this.emit("detach", "connection-closed"); };
    this.socket.onmessage = (event) => this.handleMessage(event);
  }

  async ready() { await this.readyPromise; }

  async handleMessage(event) {
    let payload;
    try {
      let raw = event.data;
      if (typeof raw !== "string") raw = typeof raw?.text === "function" ? await raw.text() : String(raw);
      payload = JSON.parse(raw);
    } catch { return; }
    if (payload.id && this.pending.has(payload.id)) {
      const request = this.pending.get(payload.id);
      this.pending.delete(payload.id);
      if (payload.error) request.reject(new Error(payload.error.message || "EDGE_CDP_COMMAND_FAILED"));
      else request.resolve(payload.result || {});
      return;
    }
    if (payload.method) this.emit("message", null, payload.method, payload.params || {});
  }

  rejectPending(error) { for (const request of this.pending.values()) request.reject(error); this.pending.clear(); }

  async sendCommand(method, params = {}) {
    await this.ready();
    if (!this.opened) throw new Error("EDGE_CDP_CONNECTION_CLOSED");
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  attach() { return true; }
  isAttached() { return this.opened; }
  detach() { try { this.socket.close(); } catch { /* Already closed. */ } }
}

class EdgeWebContents extends EventEmitter {
  constructor(connection, target) {
    super();
    this.debugger = connection;
    this.session = {
      fetch: (url, options) => fetch(url, options),
      clearCache: async () => undefined,
      on: () => undefined,
      removeListener: () => undefined,
    };
    this.id = target.targetId || target.id || null;
    this.currentUrl = target.url || "about:blank";
    this.currentTitle = target.title || "";
    this.loading = false;
    this.destroyed = false;
    connection.on("message", (_event, method, params) => {
      if (method === "Page.frameStartedLoading" && (!this.mainFrameId || !params.frameId || params.frameId === this.mainFrameId)) this.loading = true;
      if (method === "Page.frameNavigated" && params.frame?.url && !params.frame.parentId) { this.mainFrameId = params.frame.id; this.currentUrl = params.frame.url; this.loading = false; }
      if (method === "Page.navigatedWithinDocument" && params.url) { this.currentUrl = params.url; this.loading = false; }
      if (method === "Page.loadEventFired") { this.loading = false; this.emit("did-finish-load"); }
      if (method === "Page.frameStoppedLoading") this.loading = false;
    });
    connection.on("detach", () => { this.destroyed = true; this.emit("destroyed"); });
  }

  isDestroyed() { return this.destroyed; }
  isLoading() { return this.loading; }
  getURL() { return this.currentUrl; }
  getTitle() { return this.currentTitle; }
  focus() { void this.debugger.sendCommand("Page.bringToFront").catch(() => {}); return undefined; }
  async executeJavaScript(expression) {
    if (this.destroyed) throw new Error("EDGE_CDP_TARGET_DESTROYED");
    const result = await this.debugger.sendCommand("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result?.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "EDGE_CDP_RUNTIME_EXCEPTION");
    return result?.result?.value;
  }
  async loadURL(url) {
    this.loading = true;
    await this.debugger.sendCommand("Page.navigate", { url });
    await this.waitForLoad(60_000);
  }
  async reload() { this.loading = true; await this.debugger.sendCommand("Page.reload", { ignoreCache: false }); await this.waitForLoad(60_000); }
  async waitForLoad(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (!this.loading) return;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("EDGE_GEMINI_PAGE_LOAD_TIMEOUT");
  }
  sendInputEvent(event) {
    const key = String(event.keyCode || event.key || "").toUpperCase();
    const windowsVirtualKeyCode = key === "ENTER" || key === "RETURN" ? 13 : key === "ESCAPE" ? 27 : undefined;
    void this.debugger.sendCommand("Input.dispatchKeyEvent", { type: event.type, key: key === "ENTER" ? "Enter" : event.key, code: key === "ENTER" ? "Enter" : event.code, windowsVirtualKeyCode, nativeVirtualKeyCode: windowsVirtualKeyCode }).catch(() => {});
    return true;
  }
  async capturePage(options = {}) {
    const params = { format: "png", fromSurface: true, captureBeyondViewport: true };
    if (options && Number.isFinite(options.x) && Number.isFinite(options.y) && Number.isFinite(options.width) && Number.isFinite(options.height)) params.clip = { x: options.x, y: options.y, width: options.width, height: options.height, scale: 1 };
    const result = await this.debugger.sendCommand("Page.captureScreenshot", params);
    const buffer = Buffer.from(result.data || "", "base64");
    return { toPNG: () => buffer };
  }
}

class EdgeGeminiWindow {
  constructor(runtime, connection, target) {
    this.runtime = runtime;
    this.connection = connection;
    this.target = target;
    this.webContents = new EdgeWebContents(connection, target);
    this.closed = false;
    connection.on("detach", () => { this.closed = true; });
  }
  isDestroyed() { return this.closed || this.webContents.isDestroyed(); }
  isVisible() { return !this.isDestroyed(); }
  isFocused() { return true; }
  isMinimized() { return false; }
  show() { return undefined; }
  focus() { this.webContents.focus(); return undefined; }
  close() { this.closed = true; this.connection.detach(); }
}

class EdgeGeminiRuntime {
  constructor(options = {}) {
    this.profileDirectory = path.resolve(options.profileDirectory || process.env.EDGE_GEMINI_PROFILE || DEFAULT_PROFILE);
    this.requestedPort = Number(options.debugPort || process.env.EDGE_GEMINI_DEBUG_PORT || DEFAULT_PORT);
    this.edgeExecutablePath = options.edgeExecutablePath || discoverEdgeExecutable();
    this.process = null;
    this.port = null;
    this.launchedByModelingAi = false;
    this.window = null;
  }

  async connect(options = {}) {
    if (!this.edgeExecutablePath) throw new Error("EDGE_EXECUTABLE_NOT_FOUND");
    fs.mkdirSync(this.profileDirectory, { recursive: true });
    const existing = await this.findExistingManagedEndpoint();
    const targetMatcher = options.targetMatcher || isGeminiUrl;
    const initialUrl = options.initialUrl || "https://gemini.google.com/app";
    const endpoint = existing || await this.launchManagedEdge(initialUrl);
    let target;
    try {
      target = await this.waitForTarget(endpoint.port, targetMatcher, 60_000);
    } catch (error) {
      if (targetMatcher === isGeminiUrl) throw error;
      const refreshed = await readEdgeEndpoint(endpoint.port);
      target = selectManagedPageTarget(refreshed?.targets, () => true);
    }
    if (!target) throw new Error(options.targetError || "EDGE_TARGET_NOT_FOUND");
    const targetNeedsNavigation = !targetMatcher(String(target.url || ""));
    const connection = new EdgeCdpConnection(target.webSocketDebuggerUrl, target);
    await connection.ready();
    await connection.sendCommand("Page.enable");
    await connection.sendCommand("Runtime.enable");
    if (targetNeedsNavigation) await connection.sendCommand("Page.navigate", { url: initialUrl });
    this.port = endpoint.port;
    this.window = new EdgeGeminiWindow(this, connection, target);
    return this.window;
  }

  async findExistingManagedEndpoint() {
    const processes = await findManagedEdgeProcesses(this.profileDirectory);
    const marker = readRuntimeMarker(this.profileDirectory);
    const candidatePorts = [...new Set(processes.map((item) => portFromCommandLine(item.commandLine)).filter(Number.isInteger).concat(Number.isInteger(marker?.port) ? [marker.port] : []))];
    for (const port of candidatePorts) {
      const endpoint = await readEdgeEndpoint(port);
      if (!endpoint) continue;
      const matchingProcess = processes.find((item) => portFromCommandLine(item.commandLine) === port && hasProfileInCommandLine(item.commandLine, this.profileDirectory));
      if (matchingProcess) {
        this.launchedByModelingAi = marker?.owner === "Modeling AI";
        if (this.launchedByModelingAi) this.process = { pid: matchingProcess.pid };
        return endpoint;
      }
    }
    return null;
  }

  async launchManagedEdge(initialUrl = "https://gemini.google.com/app") {
    const port = await choosePort(this.requestedPort);
    const args = ["--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${this.profileDirectory}`, "--no-first-run", "--no-default-browser-check", "--new-window", initialUrl];
    this.process = spawn(this.edgeExecutablePath, args, { detached: true, windowsHide: false, stdio: "ignore" });
    this.launchedByModelingAi = true;
    this.port = port;
    writeRuntimeMarker(this.profileDirectory, { profileDirectory: this.profileDirectory, port, pid: this.process.pid, launchedAt: new Date().toISOString(), owner: "Modeling AI" });
    this.process.unref();
    const endpointDeadline = Date.now() + 30_000;
    while (Date.now() < endpointDeadline) {
      const endpoint = await readEdgeEndpoint(port);
      if (endpoint) return endpoint;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("EDGE_CDP_ENDPOINT_START_TIMEOUT");
  }

  async waitForTarget(port, matcher, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const endpoint = await readEdgeEndpoint(port);
      const target = selectManagedPageTarget(endpoint?.targets, matcher);
      if (target) return target;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(matcher === isGeminiUrl ? "GEMINI_TARGET_NOT_FOUND_IN_EDGE" : "EDGE_TARGET_NOT_FOUND");
  }

  async waitForGeminiTarget(port, timeoutMs) { return this.waitForTarget(port, isGeminiUrl, timeoutMs); }

  async closeManagedProcess() {
    const pid = this.process?.pid || readRuntimeMarker(this.profileDirectory)?.pid;
    if (!this.launchedByModelingAi || !Number.isInteger(pid)) return false;
    await new Promise((resolve) => execFile("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve()));
    this.process = null;
    return true;
  }

  status() {
    return { executablePath: this.edgeExecutablePath, profileDirectory: this.profileDirectory, debugPort: this.port, processOwnership: this.launchedByModelingAi ? "OWNED_BY_MODELING_AI" : "ATTACHED_EXISTING_MANAGED_PROFILE" };
  }
}

module.exports = { DEFAULT_PROFILE, DEFAULT_PORT, EDGE_RUNTIME_MARKER, EdgeGeminiRuntime, EdgeGeminiWindow, discoverEdgeExecutable, choosePort, findManagedEdgeProcesses, hasProfileInCommandLine, isGeminiUrl, isFlowUrl, targetMatches, selectManagedPageTarget, readEdgeEndpoint };
