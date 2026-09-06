import { db } from "@/lib/db";

export async function getHealth() {
  const startedAt = Date.now();
  await db.$queryRaw`SELECT 1`;
  return { status: "ok", database: "ok", latencyMs: Date.now() - startedAt } as const;
}
