import { describe, expect, it } from "vitest";
import { sceneAssetMappingSchema } from "./mapping-schema";

describe("scene asset mapping", () => {
  it("accepts a list of asset ids", () => expect(sceneAssetMappingSchema.parse({ assetIds: ["main-v3", "bedroom-v2"] })).toEqual({ assetIds: ["main-v3", "bedroom-v2"] }));
  it("rejects too many assets for one scene", () => expect(() => sceneAssetMappingSchema.parse({ assetIds: Array.from({ length: 101 }, (_, index) => String(index)) })).toThrow());
});
