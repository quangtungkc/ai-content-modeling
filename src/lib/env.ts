import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  AUTH_SECRET: z.string().min(32),
  CREDENTIAL_ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/, "CREDENTIAL_ENCRYPTION_KEY phải là 64 ký tự hex."),
  AI_PROVIDER: z.string().default("unconfigured"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export function getEnv() {
  return envSchema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    REDIS_URL: process.env.REDIS_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AI_PROVIDER: process.env.AI_PROVIDER,
    NODE_ENV: process.env.NODE_ENV,
  });
}
