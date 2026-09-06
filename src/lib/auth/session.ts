import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import type { AuthSession } from "./types";

export const SESSION_COOKIE = "ai_content_modeling_session";
const sessionDays = 30;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function getDatabaseSession(): Promise<AuthSession | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findFirst({ where: { tokenHash: hashToken(token), expiresAt: { gt: new Date() }, user: { passwordHash: { not: null } } }, include: { user: true } });
  return session ? { userId: session.userId, email: session.user.email } : null;
}

export async function deleteCurrentSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: hashToken(token) } });
}

export function sessionCookie(token: string, expiresAt: Date) {
  return { name: SESSION_COOKIE, value: token, httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt };
}
