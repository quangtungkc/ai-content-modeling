import { z } from "zod";

export const metricSnapshotSchema = z.object({
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative().default(0),
  capturedAt: z.coerce.date(),
});

export const manualCompetitorVideoSchema = z.object({
  url: z.string().trim().url().max(1_000),
  publishedAt: z.coerce.date(),
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative().default(0),
  comments: z.number().int().nonnegative().default(0),
  shares: z.number().int().nonnegative().default(0),
  caption: z.string().trim().max(1_000).optional(),
});
