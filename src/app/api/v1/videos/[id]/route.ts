import { randomUUID } from "node:crypto";
import { getRequiredSession } from "@/lib/auth/provider";
import { AppError, toErrorResponse } from "@/lib/errors";
import { deleteSourceVideoWithModeling } from "@/modules/projects/deletion-service";

type Context = { params: Promise<{ id: string }> };
const normalize = (error: unknown) => error instanceof Error && error.message === "AUTHENTICATION_REQUIRED"
  ? new AppError("AUTHENTICATION_REQUIRED", "Yêu cầu đăng nhập.", 401)
  : error;

export async function DELETE(_request: Request, context: Context) {
  const requestId = randomUUID();
  try {
    const session = await getRequiredSession();
    const { id } = await context.params;
    return Response.json({ data: await deleteSourceVideoWithModeling(id, session.userId), requestId });
  } catch (error) {
    return toErrorResponse(normalize(error), requestId);
  }
}
