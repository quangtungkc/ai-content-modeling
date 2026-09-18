import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { preparePromptForGeneration } from "@/modules/prompt-fidelity/service";

const schema = z.object({
  sceneNumber: z.number().int().positive().optional(),
  promptType: z.enum(["IMAGE", "VIDEO"]),
  draftPrompt: z.string().trim().min(1).max(30_000),
  textPolicy: z.object({ mode: z.enum(["NO_READABLE_TEXT", "REQUIRED_TEXT", "FORBIDDEN_TEXT"]), requiredText: z.string().optional(), forbiddenText: z.array(z.string()).optional() }).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const input = schema.parse(await request.json());
    const prepared = await preparePromptForGeneration({ projectId: id, userId: session.userId, ...input });
    return Response.json({ data: { promptId: prepared.promptId, promptType: prepared.promptType, compiledPromptHash: prepared.compiledPromptHash, validatedPrompt: prepared.validatedPrompt, promptHash: prepared.promptHash, validationResults: prepared.validationResults }, requestId });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error;
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Dữ liệu Prompt Fidelity không hợp lệ.", 400, error.flatten()) : normalized, requestId);
  }
}
