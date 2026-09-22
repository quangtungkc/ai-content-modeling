import { db } from "@/lib/db";
import { getDiagnostics } from "@/lib/diagnostics";

export async function getHealth() {
  const startedAt = Date.now();
  await db.$queryRaw`SELECT 1`;
  return { status: "ok", database: "ok", latencyMs: Date.now() - startedAt, diagnostics: getDiagnostics() } as const;
}
