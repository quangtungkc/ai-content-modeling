import { NextResponse, type NextRequest } from "next/server";
// Middleware runs in the Edge runtime. Keep this value local so it does not
// import the database/session implementation, which depends on Node.js APIs.
const SESSION_COOKIE = "ai_content_modeling_session";

export function middleware(request: NextRequest) {
  if (process.env.NODE_ENV === "development") return NextResponse.next();
  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: ["/", "/channels/:path*", "/settings/:path*"] };
