const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const defaultLockPath = path.join(projectRoot, ".next-build.lock");

function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code === "EPERM"; }
}

async function readLock(lockPath) {
  try { return JSON.parse(await fsp.readFile(lockPath, "utf8")); } catch { return null; }
}

function buildAlreadyRunning(lockPath, existing) {
  const error = new Error(`BUILD_ALREADY_RUNNING: production build lock is held at ${lockPath}${existing?.pid ? ` by PID ${existing.pid}` : ""}`);
  error.code = "BUILD_ALREADY_RUNNING";
  error.lockPath = lockPath;
  error.owner = existing;
  return error;
}

async function acquireBuildLock(lockPath = process.env.NEXT_BUILD_LOCK_PATH || defaultLockPath, options = {}) {
  const resolved = path.resolve(lockPath);
  await fsp.mkdir(path.dirname(resolved), { recursive: true });
  const token = options.token || crypto.randomUUID();
  const owner = { pid: options.pid || process.pid, token, startedAt: new Date().toISOString(), root: projectRoot };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await fsp.open(resolved, "wx");
      await handle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await handle.close();
      let released = false;
      return { lockPath: resolved, owner, async release() { if (released) return; released = true; const current = await readLock(resolved); if (current?.token === token) await fsp.rm(resolved, { force: true }); } };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const existing = await readLock(resolved);
      if (processIsAlive(existing?.pid)) throw buildAlreadyRunning(resolved, existing);
      await fsp.rm(resolved, { force: true });
    }
  }
  throw buildAlreadyRunning(resolved, await readLock(resolved));
}

function runNextBuild() {
  const nextEntrypoint = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [nextEntrypoint, "build"], { cwd: projectRoot, env: process.env, stdio: "inherit", windowsHide: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve(typeof code === "number" ? code : signal ? 1 : 0));
  });
}

async function main() {
  let lock;
  try { lock = await acquireBuildLock(); process.exitCode = await runNextBuild(); }
  catch (error) { console.error(error?.code === "BUILD_ALREADY_RUNNING" ? error.message : error?.stack || error); process.exitCode = 1; }
  finally { await lock?.release().catch(() => undefined); }
}

if (require.main === module) void main();
module.exports = { acquireBuildLock, buildAlreadyRunning, defaultLockPath, processIsAlive };
