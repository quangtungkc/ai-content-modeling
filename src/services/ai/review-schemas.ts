import { z } from "zod";

export const finalReviewSchema = z.object({ schemaVersion: z.literal("1.0"), overallSummary: z.string(), issues: z.array(z.object({ id: z.string(), category: z.enum(["missing_detail", "continuity", "ambiguity", "prompt_improvement", "safety"]), severity: z.enum(["low", "medium", "high"]), location: z.string(), issue: z.string(), suggestion: z.string(), confidence: z.number().min(0).max(1) })) });
