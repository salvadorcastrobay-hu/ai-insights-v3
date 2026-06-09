import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CAMPAIGN_ADVISOR_ROLES, getSessionRoles, hasAnyRole } from "@/lib/auth/roles";
import { applySupabaseCookies, createMiddlewareSupabaseClient } from "@/lib/supabase/server";

const LOGIN_PATH = "/login";
const DEFAULT_REDIRECT = "/overview";
// Routes that must be reachable without a session (cache warmup, health, etc).
const PUBLIC_PATHS = ["/api/prefetch-insights"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Short-circuit public endpoints before touching Supabase.
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return NextResponse.next();
  }

  const { supabase, getResponse } = createMiddlewareSupabaseClient(request);

  const { data: { user } } = await supabase.auth.getUser();
  const response = getResponse();

  const isLogin = pathname.startsWith(LOGIN_PATH);

  if (!user && !isLogin) {
    const loginUrl = new URL(LOGIN_PATH, request.url);
    loginUrl.searchParams.set("next", pathname);
    return applySupabaseCookies(response, NextResponse.redirect(loginUrl));
  }

  if (user && isLogin) {
    return applySupabaseCookies(response, NextResponse.redirect(new URL(DEFAULT_REDIRECT, request.url)));
  }

  if (pathname.startsWith("/campaign-advisor")) {
    const userRoles = getSessionRoles(user ? { user } : null);

    if (!hasAnyRole(userRoles, CAMPAIGN_ADVISOR_ROLES)) {
      return applySupabaseCookies(response, NextResponse.redirect(new URL(DEFAULT_REDIRECT, request.url)));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
