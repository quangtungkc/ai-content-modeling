import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { deleteVideosForChannel, getViralDashboard } from "@/modules/dashboard/service";

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

export async function DELETE(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const channelId = new URL(request.url).searchParams.get("channelId");
    if (!channelId) throw new AppError("INVALID_CHANNEL", "Chưa chọn Channel để xoá dữ liệu.", 400);
    return Response.json({ data: await deleteVideosForChannel(channelId, session.userId), requestId });
  } catch (error) {
    return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId);
  }
}
