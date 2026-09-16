import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { CONTENT_ROLES, getSessionRoles, hasAnyRole } from "@/lib/auth/roles";
import { applySupabaseCookies, createMiddlewareSupabaseClient } from "@/lib/supabase/server";

const LOGIN_PATH = "/login";
const DEFAULT_REDIRECT = "/discovery";

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const { supabase, getResponse } = createMiddlewareSupabaseClient(request);

  const {
    data: { user },
  } = await supabase.auth.getUser();
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

  // Toda la app es para el equipo de Content: el gate va acá y no por página.
  if (user && !isLogin) {
    const roles = getSessionRoles({ user });
    if (!hasAnyRole(roles, CONTENT_ROLES)) {
      return applySupabaseCookies(response, NextResponse.redirect(new URL("/sin-acceso", request.url)));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sin-acceso).*)"],
};
