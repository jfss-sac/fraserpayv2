import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy } from "@/lib/security-headers";
import { SESSION_COOKIE_NAME } from "@/lib/shared/constants";

function mintNonce(): string {
  return btoa(crypto.randomUUID());
}

function isLoginPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/login/");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = mintNonce();
  const csp = buildContentSecurityPolicy(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const pathname = request.nextUrl.pathname;
  const authed = request.cookies.has(SESSION_COOKIE_NAME);

  let response: NextResponse;
  if (authed || isLoginPath(pathname)) {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else {
    const loginUrl = new URL("/login", request.nextUrl);
    loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
    response = NextResponse.redirect(loginUrl);
  }

  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: ["/((?!api|sw\\.js|manifest\\.webmanifest|_next/|favicon\\.ico).*)"],
};
