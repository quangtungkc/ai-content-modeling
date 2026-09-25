import { z } from "zod";

export const competitorInputSchema = z.object({ url: z.string().trim().min(1).max(500), source: z.enum(["MANUAL", "FOLLOWING_PAGE"]).optional().default("MANUAL"), displayName: z.string().trim().min(1).max(160).optional() });
export const competitorStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) });
