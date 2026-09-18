import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The implementation is CommonJS because it is loaded directly by Electron's
// main process. These tests cover the safe, side-effect-free parts of the
// external browser boundary.
const edge = require("./edge-gemini-cdp.cjs") as {
  DEFAULT_PROFILE: string;
  DEFAULT_PORT: number;
  discoverEdgeExecutable: () => string | null;
  hasProfileInCommandLine: (commandLine: string, profile: string) => boolean;
  isGeminiUrl: (url: string) => boolean;
  isFlowUrl: (url: string) => boolean;
  selectManagedPageTarget: (targets: Array<Record<string, unknown>>, matcher: (url: string) => boolean) => Record<string, unknown> | null;
};

describe("external Edge Gemini runtime", () => {
  it("discovers an installed Edge executable from supported Windows locations", () => {
    expect(edge.discoverEdgeExecutable()).toBeTruthy();
  });

  it("uses a dedicated profile path", () => {
    expect(edge.DEFAULT_PROFILE.toLowerCase()).toContain("modelingai");
    expect(edge.DEFAULT_PROFILE.toLowerCase()).not.toContain("microsoft\\edge\\user data");
  });

  it("matches only the configured Edge profile process", () => {
    const profile = "C:\\Users\\Admin\\AppData\\Local\\ModelingAI\\EdgeGeminiProfile";
    expect(edge.hasProfileInCommandLine(`msedge.exe --user-data-dir="${profile}" --remote-debugging-port=9333`, profile)).toBe(true);
    expect(edge.hasProfileInCommandLine("msedge.exe --user-data-dir=C:\\Users\\Admin\\AppData\\Local\\Microsoft\\Edge\\User Data --remote-debugging-port=9333", profile)).toBe(false);
  });

  it("accepts only Gemini page URLs", () => {
    expect(edge.isGeminiUrl("https://gemini.google.com/app")).toBe(true);
    expect(edge.isGeminiUrl("https://accounts.google.com/signin")).toBe(false);
    expect(edge.isGeminiUrl("http://gemini.google.com/app")).toBe(false);
  });

  it("accepts only Flow page URLs for the Flow target matcher", () => {
    expect(edge.isFlowUrl("https://flow.google.com/?pli=1")).toBe(true);
    expect(edge.isFlowUrl("https://flow.google.com/project/demo")).toBe(true);
    expect(edge.isFlowUrl("https://gemini.google.com/app")).toBe(false);
  });

  it("selects a Flow page and rejects a wrong target", () => {
    const targets = [
      { type: "page", url: "https://gemini.google.com/app", webSocketDebuggerUrl: "ws://gemini" },
      { type: "page", url: "https://flow.google.com/project/demo", webSocketDebuggerUrl: "ws://flow" },
      { type: "worker", url: "https://flow.google.com/project/demo", webSocketDebuggerUrl: "ws://worker" },
    ];
    expect(edge.selectManagedPageTarget(targets, edge.isFlowUrl)).toMatchObject({ url: "https://flow.google.com/project/demo" });
    expect(edge.selectManagedPageTarget(targets, (url) => url.includes("accounts.google.com"))).toBeNull();
  });

  it("keeps the production Flow creator on Edge/CDP instead of BrowserWindow", () => {
    const source = readFileSync("electron/main.cjs", "utf8");
    const creatorStart = source.indexOf("async function createFlowWindow()");
    const creatorEnd = source.indexOf("async function closeFlowWindow", creatorStart);
    expect(creatorStart).toBeGreaterThanOrEqual(0);
    expect(source.slice(creatorStart, creatorEnd)).not.toContain("new BrowserWindow");
    expect(source.slice(creatorStart, creatorEnd)).toContain("new EdgeGeminiRuntime");
    expect(source).toContain("if (window?.edgeRuntime) return null;");
    expect(source).toContain("let window = await createFlowWindow();");
  });

  it("tracks the current managed Edge PID after compat-layer reparenting", () => {
    const source = readFileSync("electron/edge-gemini-cdp.cjs", "utf8");
    expect(source).toContain('this.launchedByModelingAi = marker?.owner === "Modeling AI";');
    expect(source).toContain("this.process = { pid: matchingProcess.pid };");
  });

  it("tracks SPA route changes used by Google Flow", () => {
    const source = readFileSync("electron/edge-gemini-cdp.cjs", "utf8");
    expect(source).toContain('method === "Page.navigatedWithinDocument"');
    expect(source).toContain("this.currentUrl = params.url;");
  });

  it("keeps the CDP port in the local deterministic range", () => {
    expect(edge.DEFAULT_PORT).toBeGreaterThanOrEqual(1024);
    expect(edge.DEFAULT_PORT).toBeLessThanOrEqual(65535);
  });
});
