import { randomUUID } from "node:crypto";
import { logger } from "@/lib/logger";
import { toErrorResponse } from "@/lib/errors";
import { getHealth } from "@/modules/health/service";

export async function GET() {
  const requestId = randomUUID();
  try {
    const health = await getHealth();
    return Response.json({ ...health, requestId });
  } catch (error) {
    logger.error("Health check failed", { requestId, error: error instanceof Error ? error.message : "unknown" });
    return toErrorResponse(error, requestId);
  }
}
