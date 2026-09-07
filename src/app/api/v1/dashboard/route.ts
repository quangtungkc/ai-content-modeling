import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getViralDashboard } from "@/modules/dashboard/service";

export async function GET(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const params = new URL(request.url).searchParams;
    const channelId = params.get("channelId") ?? undefined;
    const periodHours = Number(params.get("periodHours") ?? "24");
    return Response.json({ data: await getViralDashboard(session.userId, channelId, periodHours), requestId });
  }
  catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); }
}
