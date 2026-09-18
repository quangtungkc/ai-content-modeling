import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { markPromptSent, verifyPersistedPromptByScene } from "@/modules/prompt-fidelity/service";

const schema = z.object({ projectId: z.string().min(1), sceneNumber: z.number().int().positive().optional(), promptType: z.enum(["IMAGE", "VIDEO"]), promptId: z.string().uuid(), prompt: z.string().min(1).max(30_000), promptHash: z.string().regex(/^[a-f0-9]{64}$/i) });

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const input = schema.parse(await request.json());
    await verifyPersistedPromptByScene({ ...input, userId: session.userId });
    await markPromptSent(input.promptId, input.prompt);
    return Response.json({ data: { verified: true, promptId: input.promptId, promptHash: input.promptHash }, requestId });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Dữ liệu prompt verify không hợp lệ.", 400, error.flatten()) : normalized, requestId);
  }
}
