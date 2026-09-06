import { describe, expect, it } from "vitest";
import { veoRequestSchema } from "./request-schema";

describe("Veo generation request", () => {
  it("validates a scene request", () => expect(veoRequestSchema.parse({ sceneId: "scene-1", prompt: "Animate the approved scene", aspectRatio: "9:16", duration: 8 })).toMatchObject({ resolution: "1080p", audioEnabled: true }));
  it("rejects last frame without first frame at request boundary", () => expect(() => veoRequestSchema.parse({ sceneId: "scene-1", prompt: "test", lastFrame: { uri: "gs://last", mimeType: "image/png" } })).toThrow());
});
