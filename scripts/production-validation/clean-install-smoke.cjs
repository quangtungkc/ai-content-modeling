// Official controlled installed-app startup smoke. Never sends generation commands.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const net = require("node:net");
const { spawn, execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const asar = require("@electron/asar");
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function cleanInstallSmoke(executable) {
  if (!executable || !path.isAbsolute(executable) || !fs.statSync(executable).isFile()) throw new Error("Absolute installed EXE required");
  const archive = path.join(path.dirname(executable), "resources", "app.asar");
  const main = asar.extractFile(archive, path.join("electron", "main.cjs")).toString();
  const helper = asar.extractFile(archive, path.join("electron", "user-data.cjs")).toString();
  if (!main.includes("initializeUserData(app)") || !helper.includes("MODELING_AI_USER_DATA_DIR")) throw new Error("Installed build does not support isolated userData; refusing launch");
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(3210, "127.0.0.1", () => server.close(resolve));
  });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ModelingAI-release-smoke-"));
  let child;
  let safeToRemove = true;
  const stop = async () => {
    if (child && child.exitCode === null) {
      safeToRemove = false;
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
      await Promise.race([new Promise(resolve => child.once("exit", resolve)), delay(5000)]);
      if (child.exitCode === null) throw new Error("Smoke app did not exit; retaining temporary userData");
      safeToRemove = true;
    }
    child = null;
  };
  try {
    let previousSchema;
    let configHash;
    for (let launch = 0; launch < 2; launch++) {
      const env = { ...process.env, MODELING_AI_USER_DATA_DIR: directory, DESKTOP_FLOW_BRIDGE_DISABLED: "1" };
      delete env.ELECTRON_RUN_AS_NODE;
      delete env.DESKTOP_APP_URL;
      child = spawn(executable, [], { env, cwd: path.dirname(executable), windowsHide: true, stdio: "ignore" });
      const spawnFailure = new Promise((_, reject) => child.once("error", reject));
      await Promise.race([spawnFailure, (async () => {
        const deadline = Date.now() + 45000;
        let ready = false;
        while (Date.now() < deadline) {
          if (child.exitCode !== null) throw new Error("Smoke app exited before ready");
          if (fs.existsSync(path.join(directory, "DevToolsActivePort")) && fs.existsSync(path.join(directory, "modeling-ai.db"))) {
            try {
              const response = await fetch("http://127.0.0.1:3210/api/health", { signal: AbortSignal.timeout(2000) });
              if (response.ok) { ready = true; break; }
            } catch {}
          }
          await delay(250);
        }
        if (!ready) throw new Error("ISOLATED_STARTUP_NOT_READY");
      })()]);
      const db = new DatabaseSync(path.join(directory, "modeling-ai.db"), { readOnly: true });
      try {
        const columns = table => db.prepare(`PRAGMA table_info("${table}")`).all();
        for (const name of ["channelId", "modelingIdeaId", "lastCompletedStage", "failedStage", "resumeTarget", "failureFingerprint", "attemptCount", "incidentHistory", "checkpoint", "sourceModelingSpecVersion"]) {
          if (!columns("AutomationRun").some(column => column.name === name)) throw new Error(`Missing AutomationRun.${name}`);
        }
        for (const [table, name] of [["CompetitorVideo", "duration"], ["ContentProject", "sourceDuration"]]) {
          if (columns(table).find(column => column.name === name)?.type !== "REAL") throw new Error(`Invalid duration declaration ${table}.${name}`);
        }
        for (const table of ["PostAssemblyQaRun", "PostAssemblyOutputVersion", "PromptFidelityTrace", "CharacterIdentityPack", "TroubleshootingRule"]) if (!columns(table).length) throw new Error(`Missing ${table}`);
        const schema = JSON.stringify(db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all());
        if (previousSchema && previousSchema !== schema) throw new Error("Isolated restart changed schema");
        previousSchema = schema;
      } finally { db.close(); }
      const nextConfigHash = crypto.createHash("sha256").update(fs.readFileSync(path.join(directory, "desktop-config.json"))).digest("hex");
      if (configHash && configHash !== nextConfigHash) throw new Error("Isolated restart changed runtime config");
      configHash = nextConfigHash;
      await stop();
    }
    return { executable, cleanInstallDb: "PASS", isolatedRestart: "PASS", userDataOverride: "MODELING_AI_USER_DATA_DIR", temporaryCleanup: "PASS" };
  } finally {
    await stop();
    if (safeToRemove) fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { cleanInstallSmoke };
if (require.main === module) cleanInstallSmoke(process.argv[2]).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
