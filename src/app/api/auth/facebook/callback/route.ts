import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/secrets";
import { FACEBOOK_STATE_COOKIE, facebookRedirectUri, verifyFacebookState } from "@/lib/auth/facebook-oauth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const storedState = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${FACEBOOK_STATE_COOKIE}=`))?.split("=")[1];
  const userId = state && storedState === state ? verifyFacebookState(state) : null;
  const redirect = (status: string) => NextResponse.redirect(new URL(`/settings?facebook=${status}`, request.url));
  if (!userId || !code) return redirect("invalid_state");
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) return redirect("missing_credentials");
  try {
    const version = process.env.META_GRAPH_VERSION ?? "v24.0";
    const redirectUri = facebookRedirectUri(request);
    const tokenUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({ client_id: appId, client_secret: appSecret, redirect_uri: redirectUri, code }).toString();
    const tokenResponse = await fetch(tokenUrl);
    const tokenBody = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) return redirect("token_failed");
    const pagesUrl = new URL(`https://graph.facebook.com/${version}/me/accounts`);
    pagesUrl.search = new URLSearchParams({ fields: "id,name,access_token", access_token: tokenBody.access_token }).toString();
    const pagesResponse = await fetch(pagesUrl);
    const pagesBody = await pagesResponse.json() as { data?: Array<{ id: string; name: string; access_token?: string }> };
    const selectedToken = pagesBody.data?.[0]?.access_token ?? tokenBody.access_token;
    const label = pagesBody.data?.[0] ? `Facebook Page: ${pagesBody.data[0].name}` : "Facebook account";
    await db.aIConnection.upsert({ where: { userId_provider_kind: { userId, provider: "FACEBOOK", kind: "PLATFORM" } }, create: { userId, provider: "FACEBOOK", kind: "PLATFORM", label, encryptedKey: encryptSecret(selectedToken), keyLast4: selectedToken.slice(-4) }, update: { label, encryptedKey: encryptSecret(selectedToken), keyLast4: selectedToken.slice(-4), revokedAt: null } });
    const response = redirect("connected");
    response.headers.append("Set-Cookie", `${FACEBOOK_STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    return response;
  } catch {
    return redirect("failed");
  }
}
