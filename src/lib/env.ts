import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  AUTH_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "CREDENTIAL_ENCRYPTION_KEY phải là 64 ký tự hex."),
  AI_PROVIDER: z.string().default("unconfigured"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_GRAPH_VERSION: z.string().default("v24.0"),
});

export function getEnv() {
  return envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL || undefined,
    AUTH_SECRET: process.env.AUTH_SECRET,
    CREDENTIAL_ENCRYPTION_KEY: process.env.CREDENTIAL_ENCRYPTION_KEY,
    AI_PROVIDER: process.env.AI_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
    META_APP_ID: process.env.META_APP_ID,
    META_APP_SECRET: process.env.META_APP_SECRET,
    META_GRAPH_VERSION: process.env.META_GRAPH_VERSION,
  });
}

export function getRequiredRedisUrl() {
  const redisUrl = getEnv().REDIS_URL;
  if (!redisUrl) throw new Error("REDIS_URL chưa được cấu hình cho worker nền.");
  return redisUrl;
}
