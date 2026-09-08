import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { createSession } from "@/lib/auth/session";

/** Local Electron only: restores the single-machine workspace without asking for a password on every launch. */
export async function POST() {
  const requestId = randomUUID();
  try {
    if (process.env.DESKTOP_MODE !== "1") throw new AppError("NOT_FOUND", "Không tìm thấy tài nguyên.", 404);
    const user = await db.user.findFirst({ where: { passwordHash: { not: null } }, orderBy: { createdAt: "asc" } });
    if (!user) throw new AppError("ACCOUNT_REQUIRED", "Chưa có tài khoản local để mở ứng dụng.", 409);
    const session = await createSession(user.id);
    return Response.json({ data: { token: session.token, expiresAt: session.expiresAt.toISOString() }, requestId });
  } catch (error) {
    return toErrorResponse(error, requestId);
  }
}
