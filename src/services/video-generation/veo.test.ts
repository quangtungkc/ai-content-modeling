import { afterEach, describe, expect, it, vi } from "vitest";
import { VeoProvider } from "./veo";
import { compileVeoPrompt } from "./prompt-compiler";

describe("VeoProvider", () => {
  afterEach(() => vi.unstubAllGlobals());
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

  it("uses the image as the primary Start frame and reads the official operation response", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ name: "operations/123" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ done: true, response: { generateVideoResponse: { generatedSamples: [{ video: { uri: "https://example.test/video.mp4" } }] } } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new VeoProvider("test-key");
    const operation = await provider.generateScene({ sceneId: "scene-1", prompt: "animate", aspectRatio: "9:16", resolution: "720p", duration: 4, firstFrame: { uri: "data:image/png;base64,ZmFrZQ==", mimeType: "image/png" }, audioEnabled: true });
    const request = JSON.parse(fetchMock.mock.calls[0][1].body as string) as { instances: Array<{ image?: { bytesBase64Encoded?: string; mimeType?: string } }>; parameters: { aspectRatio: string; durationSeconds: number } };
    expect(request.instances[0].image?.bytesBase64Encoded).toBe("ZmFrZQ==");
    expect(request.parameters).toMatchObject({ aspectRatio: "9:16", durationSeconds: 4 });
    await expect(provider.getOperation(operation.operationId)).resolves.toMatchObject({ status: "succeeded", previewUrl: "https://example.test/video.mp4" });
  });

  it("preserves provider error details for diagnosis", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { message: "durationSeconds must be a number" } }), { status: 400 })));
    await expect(new VeoProvider("test-key").generateScene({ sceneId: "scene-1", prompt: "animate", aspectRatio: "9:16", resolution: "720p", duration: 4, audioEnabled: true })).rejects.toThrow("durationSeconds must be a number");
  });
});
