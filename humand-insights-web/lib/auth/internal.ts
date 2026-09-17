/**
 * Auth service-to-service para las rutas /api/internal/*.
 *
 * Las rutas del dashboard se autentican con la sesión Supabase del usuario.
 * Eso no sirve cuando el que llama es otra app (humand-content disparando un
 * job en el motor), así que estas rutas usan un secreto compartido.
 *
 * El secreto NO es la autorización del usuario final: la app que llama es la
 * que valida el rol contra su propia sesión Supabase antes de llegar acá. Este
 * token solo prueba que quien llama es un servicio nuestro. Por eso el header
 * X-Acting-User es informativo (auditoría) y jamás una credencial.
 *
 * IMPORTANTE: middleware.ts tiene que listar /api/internal en PUBLIC_PATHS. Si
 * no, estas rutas devuelven un 307 al login y el caller ve un HTML donde
 * esperaba JSON.
 */
import { timingSafeEqual } from "crypto";

export type InternalCaller = { actingUser: string | null };

function tokensMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual explota si difieren en largo, y el largo ya es público.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Devuelve el caller si el token es válido, o una Response de error para
 * cortar la request.
 */
export function requireInternalToken(request: Request): InternalCaller | Response {
  const expected = process.env.CONTENT_ENGINE_TOKEN;
  if (!expected) {
    return Response.json(
      { error: "CONTENT_ENGINE_TOKEN no configurado en el motor." },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!provided || !tokensMatch(provided, expected)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return { actingUser: request.headers.get("x-acting-user") };
}
