import { z } from "zod";

export const channelInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(50),
  topic: z.string().trim().min(1).max(120),
  subTopic: z.string().trim().max(120).optional().default(""),
  targetCountry: z.string().trim().min(1).max(120),
  language: z.string().trim().min(1).max(80),
  audience: z.string().trim().min(1).max(240),
  contentStyle: z.string().trim().min(1).max(240),
  visualStyle: z.string().trim().min(1).max(240),
  videoDuration: z.coerce.number().int().positive().max(86400).optional(),
  hasDialogue: z.boolean().default(false),
  creativeInstructions: z.string().trim().max(5000).optional().default(""),
  hashtags: z.string().trim().max(500).optional().default(""),
  timezone: z.string().trim().min(1).max(80),
});

export type ChannelInput = z.infer<typeof channelInputSchema>;
