import { deleteCurrentSession, SESSION_COOKIE } from "@/lib/auth/session";
export async function POST() { await deleteCurrentSession(); const response = Response.json({ data: { loggedOut: true } }); response.headers.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); return response; }
