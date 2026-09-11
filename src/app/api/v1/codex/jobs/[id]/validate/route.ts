import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { validateCodexStage } from "@/modules/codex-orchestrator/service";

const schema = z.object({ stage: z.enum(["ASSETS", "SCENES", "FINAL_AUDIT"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const { stage } = schema.parse(await request.json());
    return Response.json({ data: await validateCodexStage(session.userId, id, stage), requestId });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Stage kiểm tra không hợp lệ.", 400, error.flatten()) : normalized, requestId);
  }
}
