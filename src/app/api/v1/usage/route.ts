import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { getUsageSummary } from "@/modules/usage/service";

export async function GET(request: Request) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const params = new URL(request.url).searchParams;
    const from = params.get("from");
    const to = params.get("to");
    const fromDate = from ? new Date(from) : undefined;
    const toDate = to ? new Date(to) : undefined;
    if ((fromDate && Number.isNaN(fromDate.getTime())) || (toDate && Number.isNaN(toDate.getTime()))) throw new AppError("VALIDATION_ERROR", "Khoảng ngày usage không hợp lệ.", 400);
    return Response.json({ data: await getUsageSummary(session.userId, fromDate, toDate), requestId });
  } catch (error) { return toErrorResponse(error instanceof Error && error.message === "AUTHENTICATION_REQUIRED" ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401) : error, requestId); }
}
