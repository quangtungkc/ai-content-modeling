import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import vm from "node:vm";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeUserData } from "./user-data.cjs";
import { ensureSqliteReleaseSchema, AUTOMATION_RUN_COLUMNS } from "./sqlite-release-schema.cjs";
import { applicationDataDirectory } from "../src/lib/app-data";
import { resolveDesktopDatabaseUrl } from "../src/lib/env";

afterEach(() => vi.unstubAllEnvs());
const appFor = (appData: string) => {
  const paths: Record<string, string> = { appData };
  return { isPackaged: false, getPath: (name: string) => paths[name], setPath: vi.fn((name: string, value: string) => { paths[name] = value; }) };
};

describe("isolated release userData", () => {
  it("real Electron applies the override before ready without opening production runtime", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ModelingAI-electron-userdata-"));
    const directory = path.join(root, "isolated");
    const entry = path.join(root, "fixture.cjs");
    fs.writeFileSync(entry, `const {app}=require('electron'); const {initializeUserData}=require(${JSON.stringify(path.resolve("electron/user-data.cjs"))}); initializeUserData(app); app.whenReady().then(()=>{console.log('USERDATA_TEST='+app.getPath('userData'));app.quit();});`);
    const env = { ...process.env, MODELING_AI_USER_DATA_DIR: directory };
    delete env.ELECTRON_RUN_AS_NODE;
    try {
      const result = await promisify(execFile)(path.resolve("node_modules/electron/dist/electron.exe"), [entry], { env, windowsHide: true, timeout: 10000 });
      expect(result.stdout).toContain(`USERDATA_TEST=${fs.realpathSync(directory)}`);
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  }, 15000);
  it("keeps canonical default calculation without accessing production data", () => {
    const app = appFor(path.join(os.tmpdir(), "default-appdata-fixture"));
    initializeUserData(app, {});
    expect(app.getPath("userData")).toBe(path.join(app.getPath("appData"), "ai-content-modeling"));
    vi.stubEnv("MODELING_AI_USER_DATA_DIR", undefined);
    expect(applicationDataDirectory(app.getPath("appData"))).toBe(app.getPath("userData"));
  });

  it.each(["", "   ", "relative/path", "bad\0path"])("rejects invalid override %j before setPath/default access", value => {
    const app = appFor("must-not-be-used");
    expect(() => initializeUserData(app, { MODELING_AI_USER_DATA_DIR: value })).toThrow("MODELING_AI_USER_DATA_DIR_INVALID");
    expect(app.setPath).not.toHaveBeenCalled();
  });

  it("rejects unusable file path without production fallback", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "userdata-invalid-"));
    try {
      const file = path.join(root, "file"); fs.writeFileSync(file, "fixture");
      const app = appFor(root);
      expect(() => initializeUserData(app, { MODELING_AI_USER_DATA_DIR: file })).toThrow("MODELING_AI_USER_DATA_DIR_INVALID");
      expect(app.setPath).not.toHaveBeenCalled();
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  it("initializes empty isolated DB using production ensureRuntime/bootstrap and safely restarts", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ModelingAI-clean-install-"));
    const template = path.resolve("electron/assets/modeling-ai-template.db");
    expect(crypto.createHash("sha256").update(fs.readFileSync(template)).digest("hex").toUpperCase()).toBe("539F4DE0B3D4F6C010F0E19D6373D18A71E5A9306EC6036075DD34FCEC59E0FE");
    const app = appFor(path.join(root, "production-sentinel"));
    const env: Record<string, string> = { MODELING_AI_USER_DATA_DIR: path.join(root, "isolated") };
    initializeUserData(app, env);
    const userData = app.getPath("userData");
    vi.stubEnv("MODELING_AI_USER_DATA_DIR", userData);
    vi.stubEnv("DESKTOP_MODE", "1");
    // Execute the actual startup functions, not a test reimplementation.
    const main = fs.readFileSync("electron/main.cjs", "utf8");
    const startup = main.slice(main.indexOf("function ensureRuntime()"), main.indexOf("function runtimeConfigPath()"));
    const context = vm.createContext({ app, fs, path, crypto, PORT: 3210, process: { env }, runtimeRoot: () => path.dirname(template), ensureSqliteReleaseSchema, require: () => ({ PrismaClient }) });
    vm.runInContext(startup, context);
    const runtime = context.ensureRuntime();
    expect(runtime.DATABASE_URL).toBe(`file:${path.join(userData, "modeling-ai.db").replace(/\\/g, "/")}`);
    expect(runtime.DESKTOP_DATABASE_URL).toBe(runtime.DATABASE_URL);
    expect(runtime.DESKTOP_CONFIG_PATH).toBe(path.join(userData, "desktop-config.json"));
    expect(resolveDesktopDatabaseUrl("file:must-not-be-used")).toBe(runtime.DATABASE_URL);
    expect(applicationDataDirectory("must-not-be-used", "Modeling AI")).toBe(userData);
    let client: PrismaClient | undefined;
    try {
      await context.ensureLocalDatabaseSchema(runtime.DATABASE_URL);
      client = new PrismaClient({ datasources: { db: { url: runtime.DATABASE_URL } } });
      const cols = (table: string) => client!.$queryRawUnsafe<Array<{ name: string; type: string }>>(`PRAGMA table_info("${table}")`);
      const run = await cols("AutomationRun");
      for (const [name] of AUTOMATION_RUN_COLUMNS) expect(run.some(c => c.name === name)).toBe(true);
      expect((await cols("CompetitorVideo")).find(c => c.name === "duration")?.type).toBe("REAL");
      expect((await cols("ContentProject")).find(c => c.name === "sourceDuration")?.type).toBe("REAL");
      for (const table of ["PostAssemblyQaRun", "PostAssemblyOutputVersion", "PromptFidelityTrace", "CharacterIdentityPack", "TroubleshootingRule"]) expect((await cols(table)).length).toBeGreaterThan(0);
      const before = await client.$queryRawUnsafe("SELECT name, sql FROM sqlite_master ORDER BY name");
      await client.$disconnect(); client = undefined;
      const configBefore = fs.readFileSync(runtime.DESKTOP_CONFIG_PATH, "utf8");
      initializeUserData(app, env);
      const restarted = context.ensureRuntime();
      expect(restarted.DATABASE_URL).toBe(runtime.DATABASE_URL);
      expect(fs.readFileSync(runtime.DESKTOP_CONFIG_PATH, "utf8")).toBe(configBefore);
      await context.ensureLocalDatabaseSchema(restarted.DATABASE_URL);
      client = new PrismaClient({ datasources: { db: { url: runtime.DATABASE_URL } } });
      expect(await client.$queryRawUnsafe("SELECT name, sql FROM sqlite_master ORDER BY name")).toEqual(before);
      expect(fs.existsSync(app.getPath("appData"))).toBe(false);
      expect(main.indexOf("initializeUserData(app)")).toBeLessThan(main.indexOf("app.whenReady()"));
    } finally {
      await client?.$disconnect(); fs.rmSync(root, { recursive: true, force: true });
    }
    expect(fs.existsSync(root)).toBe(false);
  });
});
