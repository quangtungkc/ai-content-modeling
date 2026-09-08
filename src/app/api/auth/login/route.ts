import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { verifyPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";

const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
export async function POST(request: Request) { const requestId = randomUUID(); try { const input = schema.parse(await request.json()); const user = await db.user.findUnique({ where: { email: input.email.toLowerCase() } }); if (!user?.passwordHash || !(await verifyPassword(input.password, user.passwordHash))) throw new AppError("INVALID_CREDENTIALS", "Email hoặc mật khẩu không đúng.", 401); const session = await createSession(user.id); const cookie = sessionCookie(session.token, session.expiresAt); const response = Response.json({ data: { id: user.id, email: user.email }, requestId }); response.headers.append("Set-Cookie", `${cookie.name}=${cookie.value}; Path=${cookie.path}; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${cookie.secure ? "; Secure" : ""}`); return response; } catch (error) { return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Thông tin đăng nhập không hợp lệ.", 400) : error, requestId); } }
