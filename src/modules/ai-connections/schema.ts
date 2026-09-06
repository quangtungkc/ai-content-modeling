import { z } from "zod";

export const aiConnectionSchema = z.object({
  provider: z.enum(["OPENAI", "GEMINI", "VEO"]),
  kind: z.enum(["AI", "VIDEO_GENERATION"]),
  apiKey: z.string().trim().min(1).max(500),
  label: z.string().trim().max(80).optional(),
});

export type AIConnectionInput = z.infer<typeof aiConnectionSchema>;
