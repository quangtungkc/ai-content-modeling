import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = readFileSync(path.resolve(process.cwd(), "src/app/api/v1/projects/[id]/videos/route.ts"), "utf8");
const workerSource = readFileSync(path.resolve(process.cwd(), "src/workers/job-handler.ts"), "utf8");
const preloadSource = readFileSync(path.resolve(process.cwd(), "electron/preload.cjs"), "utf8");
const mainSource = readFileSync(path.resolve(process.cwd(), "electron/main.cjs"), "utf8");
const dashboardSource = readFileSync(path.resolve(process.cwd(), "src/components/viral-dashboard.tsx"), "utf8");

describe("video provider routing", () => {
  it("accepts an explicit Gemini provider without changing the Flow default", () => {
    expect(routeSource).toContain('provider?: "flow" | "gemini"');
    expect(routeSource).toContain('if (body.provider === "gemini")');
    expect(routeSource).toContain('enqueueBrowserFlowJob("desktop.gemini.videos"');
    expect(routeSource).toContain('provider: "gemini-cdp"');
    expect(routeSource).toContain('provider: "gemini-browser-cdp"');
    expect(routeSource).not.toContain("enqueueProjectVideosWithVeoApi");
    expect(routeSource).toContain('provider: "flow-browser"');
  });

  it("reports the provider from the persisted queue payload", () => {
    expect(routeSource).toContain('payload?.provider === "gemini-cdp" ? "gemini-browser-cdp" : payload?.provider === "veo-api" ? "veo-api" : "flow-browser"');
  });

  it("keeps the legacy Veo API worker separate while Gemini selection uses the CDP bridge", () => {
    expect(routeSource).not.toContain('provider: "veo-api"');
    expect(workerSource).toContain('if (payload.provider === "veo-api") return generateProjectVideosWithVeoApi');
    expect(workerSource).toContain("generateProjectVideosWithFlowBrowser");
  });

  it("persists the selected CDP provider on the browser bridge payload", () => {
    const bridgeSource = readFileSync(path.resolve(process.cwd(), "src/modules/generation/browser-flow-bridge.ts"), "utf8");
    expect(bridgeSource).toContain('provider?: "flow-cdp" | "gemini-cdp"');
    expect(bridgeSource).toContain("if (input.provider) payload.provider = input.provider");
    expect(bridgeSource).toContain('throw new Error("VIDEO_PROVIDER_EXECUTOR_MISMATCH")');
  });

  it("keeps the direct Gemini browser video IPC contract channel-aware", () => {
    expect(preloadSource).toContain("runVideoJob: (projectId, channelId, slots, onProgress)");
    expect(preloadSource).toContain('invokeStructured("gemini-browser:run-video-job", { projectId, channelId, slots })');
    expect(preloadSource).toContain('invokeStructured("flow-browser:run-video-job", { projectId, channelId, slots })');
  });

  it("dispatches Gemini video jobs only to the Gemini CDP executor", () => {
    const bridgeDispatch = mainSource.slice(mainSource.indexOf("async function processDesktopFlowBridgeJob"), mainSource.indexOf("async function pollDesktopFlowBridge"));
    expect(bridgeDispatch).toMatch(/claimed\.name === "desktop\.gemini\.videos"[\s\S]*?runGeminiVideoJob\(/);
    expect(bridgeDispatch).toMatch(/claimed\.name === "desktop\.flow\.videos"[\s\S]*?runFlowVideoJob\(/);
    expect(bridgeDispatch).toContain('if (payload.provider === "gemini-cdp") throw new Error("VIDEO_PROVIDER_EXECUTOR_MISMATCH")');
    const geminiIpc = mainSource.slice(mainSource.indexOf('ipcMain.handle("gemini-browser:run-video-job"'), mainSource.indexOf('ipcMain.handle("flow-browser:run-video-job"'));
    expect(geminiIpc).toContain("runGeminiVideoJob(");
    expect(geminiIpc).not.toContain("runFlowVideoJob(");
  });

  it("makes the requested video aspect ratio explicit before prompt-fidelity sealing", () => {
    expect(dashboardSource).toContain("const videoAspectRatioDirective = aspectRatio === \"16:9\"");
    expect(dashboardSource).toContain("OUTPUT REQUIREMENT: Create the video in a vertical 9:16 aspect ratio.");
    expect(dashboardSource).toContain("videoAspectRatioDirective");
  });

  it("does not reference an unbound conversation variable in the Gemini video submit path", () => {
    const start = mainSource.indexOf("async function runGeminiVideoJobUnlocked");
    const end = mainSource.indexOf("async function runGeminiVideoJob(event", start);
    const geminiJob = mainSource.slice(start, end);
    expect(geminiJob).toContain("const baselineConversationId = conversationIdFromUrl(baseline.conversationUrl);");
    expect(geminiJob).toContain("expectedConversationId: baselineConversationId");
    expect(geminiJob).not.toContain("expectedConversationId: conversationId");
  });

  it("starts every Gemini Stage-4 scene in its own conversation and reloads before upload", () => {
    const start = mainSource.indexOf("async function runGeminiVideoJobUnlocked");
    const end = mainSource.indexOf("async function runGeminiVideoJob(event", start);
    const geminiJob = mainSource.slice(start, end);
    expect(geminiJob).toContain('await window.webContents.loadURL("https://gemini.google.com/videos");');
    expect(geminiJob).toContain('action: "gemini-video-independent-conversation-open"');
    expect(geminiJob).toContain('conversationMode: "PER_SCENE"');
    expect(geminiJob).toContain("reloadGeminiVideoBeforeUpload(window, sceneNumber)");
    expect(geminiJob).toContain("ensureGeminiVideoProPortrait(window, sceneNumber, { allowModelSelection: false })");
    expect(geminiJob).toContain("normalizeGeminiVideoBuffer(rawBuffer, projectId, sceneNumber, rawDuration, 0, slot.targetDuration)");
    expect(geminiJob).not.toContain("GEMINI_VIDEO_SHARED_CONVERSATION_CHANGED");
    expect(geminiJob).not.toContain("gemini-conversation.json");
  });
});
