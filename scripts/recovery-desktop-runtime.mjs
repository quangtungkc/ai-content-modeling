import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const appPort = Number(process.env.RECOVERY_APP_PORT || 3210);
const cdpPort = Number(process.env.RECOVERY_CDP_PORT || 53591);
const appUrl = `http://127.0.0.1:${appPort}`;
const userDataDir = process.env.RECOVERY_USER_DATA_DIR || path.join(os.tmpdir(), "modeling-ai-issue005-live");
const electronExecutable = path.join(root, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron");
const require = createRequire(import.meta.url);
const { buildDevRuntimeIdentity, compareDevRuntimeIdentity } = require("../electron/dev-runtime-identity.cjs");

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function buildRecoveryEnvironment(rendererUrl, mediaRoot = userDataDir) {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  const runtimeDirectory = path.join(appData, "ai-content-modeling");
  const configPath = path.join(runtimeDirectory, "desktop-config.json");
  const databaseUrl = `file:${path.join(runtimeDirectory, "modeling-ai.db").replace(/\\/g, "/")}`;
  let runtimeConfig = {};
  try {
    runtimeConfig = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    // The desktop app will report a normal configuration error if the existing runtime config is unavailable.
  }
  const identity = buildDevRuntimeIdentity({ root });
  return {
    ...process.env,
    DESKTOP_APP_URL: rendererUrl,
    DESKTOP_MODE: "1",
    DESKTOP_CONFIG_PATH: configPath,
    DATABASE_URL: databaseUrl,
    DESKTOP_DATABASE_URL: databaseUrl,
    MODELING_AI_GENERATED_MEDIA_ROOT: mediaRoot,
    MODELING_SOURCE_ROOT_ID: identity.sourceRootId,
    MODELING_SOURCE_COMMIT: identity.sourceCommit,
    MODELING_RUNTIME_REVISION: identity.runtimeRevision,
    ...(typeof runtimeConfig.authSecret === "string" ? { AUTH_SECRET: runtimeConfig.authSecret } : {}),
    ...(typeof runtimeConfig.credentialEncryptionKey === "string" ? { CREDENTIAL_ENCRYPTION_KEY: runtimeConfig.credentialEncryptionKey } : {}),
  };
}

async function verifyRendererIdentity(rendererUrl, expectedIdentity, fetchImpl = fetch) {
  const response = await fetchImpl(`${rendererUrl}/api/runtime-identity`, { signal: AbortSignal.timeout(2_000) });
  let actual = null;
  try { actual = await response.json(); } catch { /* Keep the mismatch diagnostic structured. */ }
  const comparison = compareDevRuntimeIdentity(expectedIdentity, actual);
  if (!response.ok || !comparison.match) {
    const code = response.ok && actual ? "RENDERER_SOURCE_MISMATCH" : "DEV_RENDERER_PORT_OCCUPIED_BY_UNEXPECTED_RUNTIME";
    throw new Error(`${code}: ${JSON.stringify({ expectedIdentity, actualIdentity: actual, mismatchedFields: comparison.mismatchedFields })}`);
  }
  return actual;
}

async function waitForHealth(url, timeoutMs = 60_000, expectedIdentity = buildDevRuntimeIdentity({ root })) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        await verifyRendererIdentity(url, expectedIdentity);
        return;
      }
    } catch (error) {
      lastError = error;
      // The Next server may need several seconds to compile the first request.
    }
    await delay(500);
  }
  if (lastError?.message?.startsWith("RENDERER_SOURCE_MISMATCH") || lastError?.message?.startsWith("DEV_RENDERER_PORT_OCCUPIED_BY_UNEXPECTED_RUNTIME")) throw lastError;
  throw new Error(`RECOVERY_RENDERER_HEALTH_TIMEOUT: ${url}`);
}

function npmDevCommand(port) {
  const command = process.platform === "win32" ? (process.env.ComSpec || "cmd.exe") : "npm";
  const args = process.platform === "win32"
    ? ["/d", "/s", "/c", `npm run dev -- --hostname 127.0.0.1 --port ${port}`]
    : ["run", "dev", "--", "--hostname", "127.0.0.1", "--port", String(port)];
  return { command, args };
}

export async function startRecoveryDesktopRuntime({
  port = appPort,
  devToolsPort = cdpPort,
  dataDirectory = userDataDir,
  spawnProcess = spawn,
  waitForServer = waitForHealth,
} = {}) {
  if (!existsSync(path.join(root, "package.json"))) throw new Error(`PACKAGE_JSON_MISSING: ${path.join(root, "package.json")}`);
  if (!existsSync(electronExecutable)) throw new Error(`ELECTRON_EXECUTABLE_MISSING: ${electronExecutable}`);
  const rendererUrl = `http://127.0.0.1:${port}`;
  const environment = buildRecoveryEnvironment(rendererUrl, dataDirectory);
  const identity = buildDevRuntimeIdentity({ root, env: environment });
  const rendererCommand = npmDevCommand(port);
  const renderer = spawnProcess(rendererCommand.command, rendererCommand.args, { cwd: root, env: environment, windowsHide: true, stdio: "inherit" });
  await waitForServer(rendererUrl, undefined, identity);
  const desktopEnvironment = { ...environment, MODELING_AI_USER_DATA_DIR: dataDirectory };
  const desktop = spawnProcess(electronExecutable, [`--user-data-dir=${dataDirectory}`, `--remote-debugging-port=${devToolsPort}`, "--enable-logging", "electron/main.cjs"], { cwd: root, env: desktopEnvironment, windowsHide: true, stdio: "inherit" });
  return { renderer, desktop, rendererUrl, userDataDir: dataDirectory, devToolsPort };
}

async function main() {
  const runtime = await startRecoveryDesktopRuntime();
  const stopRenderer = () => {
    if (!runtime.renderer.killed) runtime.renderer.kill();
  };
  process.on("SIGINT", stopRenderer);
  process.on("SIGTERM", stopRenderer);
  runtime.desktop.once("exit", (code) => {
    stopRenderer();
    process.exit(code ?? 0);
  });
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || "")) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
