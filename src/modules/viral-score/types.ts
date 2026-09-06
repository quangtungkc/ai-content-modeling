export type MetricPoint = { views: number; likes: number; comments: number; shares: number; capturedAt: Date };

export type ViralScoreInput = {
  currentViews: number;
  baselineViews: number;
  publishedAt: Date;
  now?: Date;
  snapshots?: MetricPoint[];
  likes: number;
  comments: number;
  shares: number;
};

export type ViralScoreResult = {
  score: number;
  currentViews: number;
  baselineViews: number;
  relativePerformance: number;
  hoursSincePublished: number;
  viewsGained: number;
  viewVelocity: number;
  engagementRate: number;
  breakdown: { relative: number; velocity: number; engagement: number; freshness: number };
  confidence: "low" | "medium" | "high";
};
