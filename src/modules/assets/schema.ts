import { z } from "zod";

export const assetInputSchema = z.object({
  type: z.enum(["character", "background", "prop"]),
  name: z.string().trim().min(1).max(160),
  storageKey: z.string().trim().min(1).max(500),
  characterId: z.string().trim().max(120).optional(),
  backgroundId: z.string().trim().max(120).optional(),
  sceneIds: z.array(z.string().trim().min(1).max(120)).default([]),
  mimeType: z.string().regex(/^(image|video)\/[a-z0-9.+-]+$/i),
  checksum: z.string().trim().min(1).max(128),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const assetStatusSchema = z.object({ status: z.enum(["APPROVED", "NEEDS_REVISION", "APPROVED_ANYWAY"]) });
