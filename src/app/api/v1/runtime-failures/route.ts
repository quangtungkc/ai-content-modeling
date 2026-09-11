import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { reportRuntimeFailure } from "@/modules/codex-orchestrator/runtime-failure";

const schema = z.object({
  source: z.string().trim().min(1).max(120),
  code: z.string().trim().max(120).optional(),
  message: z.string().trim().min(1).max(4_000),
  stack: z.string().max(12_000).optional(),
  stage: z.enum(["ANALYSIS", "MODELING", "PROJECT", "ASSETS", "SCENES", "FINAL_ASSEMBLY", "FINAL_AUDIT", "POST_RUN_REVIEW"]).optional(),
  codexJobId: z.string().max(120).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const input = schema.parse(await request.json());
    const failure = await reportRuntimeFailure({
      userId: session.userId,
      codexJobId: input.codexJobId,
      source: input.source,
      stage: input.stage,
      code: input.code,
      error: new Error(input.message),
      context: { ...input.context, clientStack: input.stack, requestId },
    });
    return Response.json({ data: { id: failure.id, status: failure.status }, requestId }, { status: 202 });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Dữ liệu lỗi runtime không hợp lệ.", 400, error.flatten()) : normalized, requestId);
  }
}
