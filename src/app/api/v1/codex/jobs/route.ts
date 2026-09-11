import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { createCodexJob, listCodexJobs } from "@/modules/codex-orchestrator/service";

const createSchema = z.object({
  sourceVideoId: z.string().min(1),
  idempotencyKey: z.string().min(8).max(200),
  settings: z.object({
    artStyle: z.string().trim().min(1).max(100),
    aspectRatio: z.enum(["9:16", "16:9", "1:1", "4:5"]),
    postText: z.string().max(500).optional(),
    hashtags: z.string().max(500).optional(),
    language: z.string().max(80).optional(),
    targetCountry: z.string().max(120).optional(),
  }),
});

const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
  ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
  : error;

export async function GET() {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    return Response.json({ data: await listCodexJobs(session.userId), requestId });
  } catch (error) {
    return toErrorResponse(normalize(error), requestId);
  }
}

export async function POST(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const input = createSchema.parse(await request.json());
    return Response.json({ data: await createCodexJob(session.userId, input), requestId }, { status: 201 });
  } catch (error) {
    return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Cấu hình Codex job không hợp lệ.", 400, error.flatten()) : normalize(error), requestId);
  }
}
