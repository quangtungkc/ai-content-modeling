import { z } from "zod";

export const assetValidationSchema = z.object({ schemaVersion: z.literal("1.0"), result: z.enum(["APPROVED", "NEEDS_REVISION"]), scores: z.object({ characterMatch: z.number().min(0).max(100).optional(), styleMatch: z.number().min(0).max(100), composition: z.number().min(0).max(100) }), issues: z.array(z.object({ code: z.string(), severity: z.enum(["low", "medium", "high"]), message: z.string(), suggestion: z.string() })) });
