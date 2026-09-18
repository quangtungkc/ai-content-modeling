import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { generateIdeasFromVideo, storeModelingIdeasFromBrowser } from "@/modules/ideas/service";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  const requestId = randomUUID();
  try { const session = await getRequiredSession(); const { id } = await context.params; const body = await request.json().catch(() => ({})) as { artStyle?: string; provider?: string; ideas?: unknown; analysisId?: string }; const data = body.provider === "gemini-browser" && body.ideas ? await storeModelingIdeasFromBrowser(id, session.userId, body.ideas, body.analysisId) : await generateIdeasFromVideo(id, session.userId, body.artStyle?.trim() ?? ""); return Response.json({ data, requestId }, { status: 201 }); }
  catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); }
}
