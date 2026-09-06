import { describe, expect, it } from "vitest";
import { metricSnapshotSchema } from "./schema";

describe("video metric snapshots", () => {
  it("accepts timestamped metrics", () => expect(metricSnapshotSchema.parse({ views: 10000, likes: 100, comments: 10, capturedAt: "2026-09-06T08:00:00.000Z" })).toMatchObject({ views: 10000, shares: 0 }));
  it("rejects negative metrics", () => expect(() => metricSnapshotSchema.parse({ views: -1, likes: 0, comments: 0, capturedAt: new Date() })).toThrow());
});
