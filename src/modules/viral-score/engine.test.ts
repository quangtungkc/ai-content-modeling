import { describe, expect, it } from "vitest";
import { calculateBaselineViews, calculateMedian, calculateViralScore } from "./engine";

const now = new Date("2026-09-06T20:00:00.000Z");

describe("ViralScoreEngine", () => {
  it("calculates a median without mutating input", () => {
    const values = [22_000, 10_000, 30_000, 18_000, 15_000];
    expect(calculateMedian(values)).toBe(18_000);
    expect(values).toEqual([22_000, 10_000, 30_000, 18_000, 15_000]);
    expect(calculateBaselineViews([10_000, 20_000, 30_000, -1])).toBe(20_000);
  });

  it("recognizes a strong relative outperformer", () => {
    const result = calculateViralScore({ currentViews: 180_000, baselineViews: 22_000, publishedAt: new Date("2026-09-06T13:00:00.000Z"), now, likes: 12_000, comments: 1_500, shares: 2_500, snapshots: [
      { views: 10_000, likes: 500, comments: 20, shares: 10, capturedAt: new Date("2026-09-06T14:00:00.000Z") },
      { views: 45_000, likes: 2_000, comments: 300, shares: 500, capturedAt: new Date("2026-09-06T16:00:00.000Z") },
      { views: 180_000, likes: 12_000, comments: 1_500, shares: 2_500, capturedAt: now },
    ] });
    expect(result.relativePerformance).toBeCloseTo(8.1818, 3);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.confidence).toBe("high");
  });

  it("does not reward a video with no baseline or engagement", () => {
    const result = calculateViralScore({ currentViews: 100, baselineViews: 0, publishedAt: new Date("2026-09-01T00:00:00.000Z"), now, likes: 0, comments: 0, shares: 0 });
    expect(result.score).toBe(0);
    expect(result.confidence).toBe("low");
  });

  it("uses the first snapshot to calculate gained views", () => {
    const result = calculateViralScore({ currentViews: 160_000, baselineViews: 20_000, publishedAt: new Date("2026-09-06T12:00:00.000Z"), now, likes: 1_600, comments: 160, shares: 80, snapshots: [{ views: 10_000, likes: 0, comments: 0, shares: 0, capturedAt: new Date("2026-09-06T13:00:00.000Z") }] });
    expect(result.viewsGained).toBe(150_000);
    expect(result.viewVelocity).toBeCloseTo(18_750, 0);
  });
});
