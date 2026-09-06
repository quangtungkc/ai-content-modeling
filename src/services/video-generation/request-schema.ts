import { z } from "zod";

export const veoRequestSchema = z.object({
  sceneId: z.string().min(1), prompt: z.string().min(1).max(30_000),
  referenceImages: z.array(z.object({ uri: z.string().min(1), mimeType: z.string().min(1), role: z.enum(["character", "background", "prop"]).optional() })).max(3).optional(),
  aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"), resolution: z.enum(["720p", "1080p", "4k"]).default("1080p"), duration: z.union([z.literal(4), z.literal(6), z.literal(8)]).default(8),
  firstFrame: z.object({ uri: z.string().min(1), mimeType: z.string().min(1) }).optional(), lastFrame: z.object({ uri: z.string().min(1), mimeType: z.string().min(1) }).optional(), audioEnabled: z.boolean().default(true),
}).refine((value) => !value.lastFrame || Boolean(value.firstFrame), { message: "lastFrame cần đi cùng firstFrame.", path: ["lastFrame"] });
