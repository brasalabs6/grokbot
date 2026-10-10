import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";
import { isInternalEmailAllowed } from "./lib/auth/access-policy";
import { isDevelopmentEnvironment } from "./lib/constants";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname === "/ping") {
    return new Response("pong", { status: 200 });
  }

  // Auth endpoints authenticate themselves; never create a guest user before
  // rendering the sign-in form, especially on an unprovisioned preview.
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  });

  const authorizedRegular =
    token?.type === "regular" && isInternalEmailAllowed(token.email ?? "");

  if (pathname === "/login" || pathname === "/register") {
    if (authorizedRegular) {
      return NextResponse.redirect(new URL("/agent-sessions", request.url));
    }
    return NextResponse.next();
  }

  if (!authorizedRegular) {
    // APIs must return their own JSON 401/403, not a guest sign-in redirect.
    if (pathname.startsWith("/api/")) {
      return NextResponse.next();
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",
    "/login",
    "/register",
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
