import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { reportCodexEvent } from "@/modules/codex-orchestrator/service";
import { CODEX_STAGES } from "@/modules/codex-orchestrator/types";

const schema = z.object({
  type: z.enum(["STAGE_STARTED", "STAGE_COMPLETED", "STAGE_FAILED", "PROVIDER_FALLBACK"]),
  stage: z.enum(CODEX_STAGES),
  actualState: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(4000).optional(),
  provider: z.string().max(80).optional(),
  fallbackProvider: z.string().max(80).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    return Response.json({ data: await reportCodexEvent(session.userId, id, schema.parse(await request.json())), requestId });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Codex event không hợp lệ.", 400, error.flatten()) : normalized, requestId);
  }
}
