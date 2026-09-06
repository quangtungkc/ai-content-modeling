import { describe, expect, it } from "vitest";
import { VeoProvider } from "./veo";
import { compileVeoPrompt } from "./prompt-compiler";

describe("VeoProvider", () => {
  it("requires server-side credentials", async () => {
    await expect(new VeoProvider(undefined).generateScene(compileVeoPrompt({ sceneId: "scene-1", scene: {}, characterData: {}, assetReferences: [], background: {}, camera: {}, action: {}, audio: {}, duration: 8, constraints: [] }))).rejects.toMatchObject({ code: "VIDEO_PROVIDER_NOT_CONFIGURED" });
  });
  it("rejects invalid reference/frame combinations before network calls", async () => {
    await expect(Promise.resolve().then(() => compileVeoPrompt({ sceneId: "scene-1", scene: {}, characterData: {}, assetReferences: [], background: {}, camera: {}, action: {}, audio: {}, duration: 8, constraints: [], lastFrame: { uri: "gs://last", mimeType: "image/png" } }))).rejects.toMatchObject({ code: "VIDEO_PROVIDER_ERROR" });
    await expect(Promise.resolve().then(() => compileVeoPrompt({ sceneId: "scene-1", scene: {}, characterData: {}, assetReferences: Array.from({ length: 4 }, () => ({ uri: "gs://image", mimeType: "image/png" })), background: {}, camera: {}, action: {}, audio: {}, duration: 8, constraints: [] }))).rejects.toMatchObject({ code: "VIDEO_PROVIDER_ERROR" });
  });

  it("compiles a debuggable Veo request", () => {
    const request = compileVeoPrompt({ sceneId: "scene-1", scene: { number: 1 }, characterData: { name: "Main" }, assetReferences: [{ uri: "gs://main", mimeType: "image/png", role: "character" }], background: { name: "Bedroom" }, camera: { shot: "wide" }, action: { movement: "run" }, audio: { sfx: "impact" }, duration: 8, constraints: ["preserve silhouette"], aspectRatio: "9:16", resolution: "1080p" });
    expect(request).toMatchObject({ sceneId: "scene-1", aspectRatio: "9:16", resolution: "1080p", duration: 8 });
    expect(request.prompt).toContain("CHARACTERS");
    expect(request.prompt).toContain("preserve silhouette");
  });
});
