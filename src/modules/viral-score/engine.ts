import type { MetricPoint, ViralScoreInput, ViralScoreResult } from "./types";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const MAX_REFERENCE_MULTIPLIER = 10;
const BASELINE_WINDOW_HOURS = 24;
const ENGAGEMENT_REFERENCE = 0.1;

function clamp(value: number, min = 0, max = 100) { return Math.min(max, Math.max(min, value)); }
function logScale(value: number) { return clamp((Math.log1p(Math.max(0, value)) / Math.log1p(MAX_REFERENCE_MULTIPLIER)) * 100); }

export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/** Baseline của một competitor là median views của các video trước đó. */
export function calculateBaselineViews(previousVideoViews: number[]): number {
  return calculateMedian(previousVideoViews.filter((views) => Number.isFinite(views) && views >= 0));
}

function calculateViewsGained(currentViews: number, snapshots: MetricPoint[] = []) {
  const sorted = [...snapshots].sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  const firstViews = sorted[0]?.views ?? 0;
  return Math.max(0, currentViews - firstViews);
}

export function calculateViralScore(input: ViralScoreInput): ViralScoreResult {
  const now = input.now ?? new Date();
  const currentViews = Math.max(0, input.currentViews);
  const baselineViews = Math.max(0, input.baselineViews);
  const hoursSincePublished = Math.max(1 / 60, (now.getTime() - input.publishedAt.getTime()) / HOUR_MS);
  const relativePerformance = baselineViews > 0 ? currentViews / baselineViews : 0;
  const viewsGained = calculateViewsGained(currentViews, input.snapshots);
  const viewVelocity = viewsGained / hoursSincePublished;
  const baselineVelocity = baselineViews / BASELINE_WINDOW_HOURS;
  const velocityRatio = baselineVelocity > 0 ? viewVelocity / baselineVelocity : 0;
  const totalEngagements = Math.max(0, input.likes) + Math.max(0, input.comments) + Math.max(0, input.shares);
  const engagementRate = currentViews > 0 ? totalEngagements / currentViews : 0;
  const freshness = clamp((1 - hoursSincePublished / 72) * 100);
  const breakdown = {
    relative: logScale(relativePerformance),
    velocity: logScale(velocityRatio),
    engagement: clamp((engagementRate / ENGAGEMENT_REFERENCE) * 100),
    freshness,
  };
  const score = Math.round(clamp(breakdown.relative * 0.4 + breakdown.velocity * 0.3 + breakdown.engagement * 0.2 + breakdown.freshness * 0.1));
  return { score, currentViews, baselineViews, relativePerformance, hoursSincePublished, viewsGained, viewVelocity, engagementRate, breakdown, confidence: baselineViews > 0 && input.snapshots && input.snapshots.length >= 3 ? "high" : baselineViews > 0 ? "medium" : "low" };
}
