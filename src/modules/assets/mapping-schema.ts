import { z } from "zod";

export const sceneAssetMappingSchema = z.object({ assetIds: z.array(z.string().trim().min(1)).max(100) });
