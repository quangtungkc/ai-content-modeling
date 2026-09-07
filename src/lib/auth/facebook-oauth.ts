import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const stateCookie = "ai_content_modeling_facebook_state";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET chưa được cấu hình.");
  return value;
}

export function createFacebookState(userId: string) {
  const payload = `${userId}.${randomBytes(18).toString("base64url")}`;
  const signature = createHmac("sha256", secret()).update(payload).digest("base64url");
  return { value: `${payload}.${signature}`, cookie: stateCookie };
}

export function verifyFacebookState(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [userId, nonce, signature] = parts;
  const payload = `${userId}.${nonce}`;
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  return userId;
}

export function facebookStateCookie(value: string) {
  return `${stateCookie}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=600`;
}

export function facebookRedirectUri(request: Request) {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = forwardedHost ?? request.headers.get("host");
  if (host) return `${forwardedProto ?? new URL(request.url).protocol.replace(":", "")}://${host}/api/auth/facebook/callback`;
  return new URL("/api/auth/facebook/callback", request.url).toString();
}

export { stateCookie as FACEBOOK_STATE_COOKIE };
