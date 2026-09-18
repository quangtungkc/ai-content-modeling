import { randomUUID } from "node:crypto";

import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { analyzeCompetitorVideo, storeCompetitorVideoAnalysis } from "@/modules/videos/analysis-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    const body = await _request.json().catch(() => ({})) as { provider?: string; analysis?: unknown };
    const data = body.provider === "gemini-browser" && body.analysis
      ? await storeCompetitorVideoAnalysis(id, session.userId, body.analysis, "gemini-browser")
      : await analyzeCompetitorVideo(id, session.userId);
    return Response.json({ data, requestId }, { status: 201 });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
      ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
      : error;
    return toErrorResponse(normalized, requestId);
  }
}
