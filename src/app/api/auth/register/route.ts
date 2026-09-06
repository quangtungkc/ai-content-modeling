import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { AppError, toErrorResponse } from "@/lib/errors";
import { hashPassword } from "@/lib/auth/password";
import { createSession, sessionCookie } from "@/lib/auth/session";

const schema = z.object({ email: z.string().email().max(200), password: z.string().min(10).max(200), name: z.string().trim().min(1).max(100).optional() });
export async function POST(request: Request) { const requestId = randomUUID(); try { const input = schema.parse(await request.json()); const email = input.email.toLowerCase(); if (await db.user.findUnique({ where: { email } })) throw new AppError("EMAIL_IN_USE", "Email này đã được sử dụng.", 409); const user = await db.user.create({ data: { email, name: input.name, passwordHash: await hashPassword(input.password) } }); const session = await createSession(user.id); const response = Response.json({ data: { id: user.id, email: user.email }, requestId }, { status: 201 }); response.headers.append("Set-Cookie", `${sessionCookie(session.token, session.expiresAt).name}=${session.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`); return response; } catch (error) { return toErrorResponse(error instanceof z.ZodError ? new AppError("VALIDATION_ERROR", "Email hoặc mật khẩu không hợp lệ.", 400) : error, requestId); } }
