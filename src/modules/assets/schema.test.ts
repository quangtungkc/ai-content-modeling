import { describe, expect, it } from "vitest";
import { assetInputSchema } from "./schema";

describe("asset workspace metadata", () => {
  it("requires an asset type, version context and scene mapping", () => expect(assetInputSchema.parse({ type: "character", name: "Main Character", storageKey: "projects/p1/main-v1.png", sceneIds: ["scene-1"], mimeType: "image/png", checksum: "abc" })).toMatchObject({ type: "character", sceneIds: ["scene-1"] }));
  it("rejects unsupported file types", () => expect(() => assetInputSchema.parse({ type: "background", name: "Bedroom", storageKey: "bedroom.exe", mimeType: "application/octet-stream", checksum: "abc" })).toThrow());
});
