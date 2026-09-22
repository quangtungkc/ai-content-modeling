import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const launcher = readFileSync(path.resolve(process.cwd(), "scripts/recovery-desktop-runtime.mjs"), "utf8");
const preload = readFileSync(path.resolve(process.cwd(), "electron/preload.cjs"), "utf8");
const packageJson = JSON.parse(readFileSync(path.resolve(process.cwd(), "package.json"), "utf8")) as { scripts?: Record<string, string> };

describe("ISSUE-005 recovery desktop runtime alignment", () => {
  it("serves and launches the Electron runtime from the same worktree", () => {
    expect(packageJson.scripts?.["dev:local"]).toBe("node scripts/recovery-desktop-runtime.mjs");
    expect(packageJson.scripts?.["recovery:desktop"]).toBe("npm run dev:local");
    expect(launcher).toContain("npm run dev -- --hostname 127.0.0.1 --port");
    expect(launcher).toContain("DESKTOP_APP_URL: rendererUrl");
    expect(launcher).toContain('DESKTOP_MODE: "1"');
    expect(launcher).toContain("DESKTOP_CONFIG_PATH: configPath");
    expect(launcher).toContain("DESKTOP_DATABASE_URL: databaseUrl");
    expect(launcher).toContain("MODELING_AI_GENERATED_MEDIA_ROOT: mediaRoot");
    expect(launcher).toContain("runtimeConfig.authSecret");
    expect(launcher).toContain("runtimeConfig.credentialEncryptionKey");
    expect(launcher).toContain("/api/runtime-identity");
    expect(launcher).toContain("RENDERER_SOURCE_MISMATCH");
    expect(launcher).toContain("DEV_RENDERER_PORT_OCCUPIED_BY_UNEXPECTED_RUNTIME");
    expect(launcher).toContain("cwd: root");
    expect(launcher).toContain('"electron/main.cjs"');
  });

  it("uses the Electron port and verifies identity before launch", () => {
    expect(launcher).toContain("process.env.RECOVERY_APP_PORT || 3210");
    expect(launcher).toContain("await waitForServer(rendererUrl, undefined, identity)");
    expect(launcher).toContain("MODELING_RUNTIME_REVISION");
    expect(launcher).toContain("buildRecoveryEnvironment(rendererUrl, dataDirectory)");
  });

  it("keeps structured-error revival compatible with the sandboxed preload", () => {
    expect(preload).toContain("function reviveStructuredError(payload)");
    expect(preload).not.toContain('require("./gemini-error-transport.cjs")');
  });
});
