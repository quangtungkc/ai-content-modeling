export class LocalRateLimiter {
  private readonly buckets = new Map<string, number>();
  async take(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const bucket = `rate-limit:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
    const count = (this.buckets.get(bucket) ?? 0) + 1;
    this.buckets.set(bucket, count);
    return count <= limit;
  }
}
