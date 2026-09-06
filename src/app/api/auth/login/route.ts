import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
export async function POST(request: Request) { const requestId = randomUUID(); try { const input = schema.parse(await request.json()); const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } }); if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw new AppError("INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.", 401); const session = await createSession(user.id); const response = Response.json({ data: { id: user.id, email: user.email }, requestId }); response.headers.append("Set-Cookie", `ai_content_modeling_session=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`); return response; } catch (error) { return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Thông tin đăng nhập không hợp lệ.", 400) : error, requestId); } }
