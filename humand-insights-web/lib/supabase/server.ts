import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

type CookieToSet = {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
};

function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  }

  return { url, anonKey };
}

export async function createServerSupabaseClient(): Promise<SupabaseClient> {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseConfig();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot always write cookies during render.
        }
      },
    },
  });
}

type MiddlewareClient = {
  getResponse: () => NextResponse;
  supabase: SupabaseClient;
};

export function createMiddlewareSupabaseClient(request: NextRequest): MiddlewareClient {
  const { url, anonKey } = getSupabaseConfig();

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookieToSet[]) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));

        response = NextResponse.next({
          request: {
            headers: request.headers,
          },
        });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  return {
    getResponse: () => response,
    supabase,
  };
}

export function applySupabaseCookies(source: NextResponse, target: NextResponse): NextResponse {
  source.cookies.getAll().forEach((cookie) => {
    target.cookies.set(cookie.name, cookie.value);
  });

  return target;
}

export const createClient = createServerSupabaseClient;

/**
 * Devuelve la sesión autenticada (con access_token usable para forward a
 * Railway) DESPUÉS de validar el user con el Auth server.
 *
 * Reemplaza el patrón `supabase.auth.getSession()` que disparaba el
 * warning de seguridad: `getSession()` lee cookies (spoofables);
 * `getUser()` valida con el servidor. Llamamos `getUser()` primero
 * para autenticar y después leemos la session local para tomar el
 * access_token (ya seguro porque user fue validado).
 *
 * Devuelve null si el user no está autenticado.
 */
export async function getAuthenticatedSession() {
  const supabase = await createServerSupabaseClient();
  const { data: { user }, error: userError } = await supabase.auth.getUser();
  if (userError || !user) return null;
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return session;
}

/**
 * Convenience helper para Server Components / API routes: devuelve los
 * roles del user autenticado (vacío si no hay sesión).
 *
 * Importante: vive acá (no en lib/auth/roles.ts) porque depende de
 * next/headers via createClient — y roles.ts es usado por middleware
 * que corre en edge context donde cookies() no aplica.
 */
export async function getServerUserRoles(): Promise<string[]> {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  const raw = user?.app_metadata?.roles;
  return Array.isArray(raw) ? raw.filter((r): r is string => typeof r === "string") : [];
}
