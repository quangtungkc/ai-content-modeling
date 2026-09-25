import { z } from "zod";

const facebookPageUrlSchema = z.string().trim().url().max(500).refine((value) => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(parsed.hostname.toLowerCase()) && !/(^|\/)\b(reel|watch|videos|share|groups|events)\b/i.test(parsed.pathname);
  } catch {
    return false;
  }
}, "URL phải là Facebook Page HTTPS, không phải Reel/video/group/event.");

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
  facebookPageUrl: facebookPageUrlSchema.optional().or(z.literal("")),
  facebookPageName: z.string().trim().max(160).optional().default(""),
  facebookPageExternalId: z.string().trim().max(120).optional().default(""),
  timezone: z.string().trim().min(1).max(80),
});

export type ChannelInput = z.infer<typeof channelInputSchema>;
