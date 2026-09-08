import { randomUUID } from "node:crypto";

import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { analyzeCompetitorVideo } from "@/modules/videos/analysis-service";

type Context = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    return Response.json({ data: await analyzeCompetitorVideo(id, session.userId), requestId }, { status: 201 });
  } catch (error) {
    const normalized = error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
      ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
      : error;
    return toErrorResponse(normalized, requestId);
  }
}
