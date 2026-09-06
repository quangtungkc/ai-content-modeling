import { z } from "zod";

export const visualBreakdownSchema = z.object({
  schemaVersion: z.literal("1.0"), videoSummary: z.string(), openingHook: z.string(),
  timeline: z.array(z.object({ timestamp: z.string().regex(/^\d{2}:\d{2}$/), event: z.string(), observableEvidence: z.string() })),
  characters: z.array(z.object({ name: z.string(), description: z.string(), role: z.string() })), setting: z.string(), visualGag: z.string(), escalation: z.string(), twist: z.string(), payoff: z.string(), cameraPattern: z.string(), audioPattern: z.string(), whyItLikelyWorks: z.array(z.string()),
});
