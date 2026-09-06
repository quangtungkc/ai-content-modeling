import { z } from "zod";

export const metricSnapshotSchema = z.object({
  views: z.number().int().nonnegative(),
  likes: z.number().int().nonnegative(),
  comments: z.number().int().nonnegative(),
  shares: z.number().int().nonnegative().default(0),
  capturedAt: z.coerce.date(),
});
