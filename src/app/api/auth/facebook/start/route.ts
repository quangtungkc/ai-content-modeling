import { NextResponse } from "next/server";

import { getRequiredSession } from "@/lib/auth/provider";
import { createFacebookState, facebookRedirectUri, facebookStateCookie } from "@/lib/auth/facebook-oauth";

export async function GET(request: Request) {
  try {
    const session = await getRequiredSession();
    const appId = process.env.META_APP_ID;
    if (!appId) return NextResponse.redirect(new URL("/settings?facebook=missing_app_id", request.url));
    const state = createFacebookState(session.userId);
    const redirectUri = facebookRedirectUri(request);
    const authorize = new URL(`https://www.facebook.com/${process.env.META_GRAPH_VERSION ?? "v24.0"}/dialog/oauth`);
    authorize.search = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, state: state.value, scope: "public_profile,pages_show_list,pages_read_engagement,pages_read_user_content" }).toString();
    const response = NextResponse.redirect(authorize);
    response.headers.append("Set-Cookie", facebookStateCookie(state.value));
    return response;
  } catch {
    return NextResponse.redirect(new URL("/settings?facebook=auth_required", request.url));
  }
}
