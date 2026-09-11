import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getCodexJob } from "@/modules/codex-orchestrator/service";

const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
  ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
  : error;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    return Response.json({ data: await getCodexJob(session.userId, id), requestId });
  } catch (error) {
    return toErrorResponse(normalize(error), requestId);
  }
}
