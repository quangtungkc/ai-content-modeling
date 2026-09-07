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

export { stateCookie as FACEBOOK_STATE_COOKIE };
