import { z } from "zod";

export const competitorInputSchema = z.object({ url: z.string().trim().min(1).max(500) });
export const competitorStatusSchema = z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) });
