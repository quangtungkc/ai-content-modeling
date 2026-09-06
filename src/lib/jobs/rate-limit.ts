import Redis from "ioredis";

export class RedisRateLimiter {
  constructor(private readonly redis: Redis) {}

  async take(key: string, limit: number, windowSeconds: number): Promise<boolean> {
    const bucket = `rate-limit:${key}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
    const count = await this.redis.incr(bucket);
    if (count === 1) await this.redis.expire(bucket, windowSeconds);
    return count <= limit;
  }
}
