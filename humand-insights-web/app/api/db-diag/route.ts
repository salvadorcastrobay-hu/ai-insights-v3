import { lookup } from "node:dns/promises";
import postgres from "postgres";

import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Diagnóstico de la conexión Postgres directa (SUPABASE_DB_URL) DESDE el
// runtime del web service. No expone credenciales: solo host/puerto/usuario,
// resolución DNS (A vs AAAA) y el error real de conexión.
export async function GET(): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) return new Response("Forbidden", { status: 403 });

  const raw = process.env.SUPABASE_DB_URL;
  if (!raw) {
    return Response.json({ ok: false, error: "SUPABASE_DB_URL no está seteada" });
  }

  let host = "";
  let port = "";
  let user = "";
  try {
    const u = new URL(raw);
    host = u.hostname;
    port = u.port || "5432";
    user = u.username;
  } catch {
    return Response.json({ ok: false, error: "SUPABASE_DB_URL no parsea como URL" });
  }

  // DNS: si solo resuelve AAAA (IPv6) y el runtime no tiene salida IPv6,
  // la conexión muere en timeout — ese es el caso clásico con la conexión
  // directa db.<ref>.supabase.co de Supabase desde Railway.
  let dns: { address: string; family: number }[] = [];
  let dnsError: string | null = null;
  try {
    dns = await lookup(host, { all: true });
  } catch (e) {
    dnsError = e instanceof Error ? e.message : String(e);
  }

  // Intento de conexión real con timeout corto.
  let connect: { ok: boolean; ms: number; error?: string; code?: string };
  const t0 = Date.now();
  const sql = postgres(raw, {
    ssl: "require",
    max: 1,
    connect_timeout: 8,
    prepare: false,
  });
  try {
    const r = await sql`SELECT 1 AS one`;
    connect = { ok: r[0]?.one === 1, ms: Date.now() - t0 };
  } catch (e) {
    connect = {
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
      code: (e as { code?: string })?.code,
    };
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }

  // Mismo SELECT pero a través del SINGLETON getPg (el pool cacheado que usa
  // la app). Si la conexión fresca anda y este timeoutea → el pool quedó
  // zombie / la query inicial de fetch_types lo cuelga.
  let singleton: { ok: boolean; ms: number; error?: string };
  const t1 = Date.now();
  try {
    const { getPg } = await import("@/lib/supabase/pg");
    const r = await Promise.race([
      getPg()`SELECT 1 AS one`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("singleton timeout 8s")), 8_000),
      ),
    ]);
    singleton = { ok: (r as unknown as { one: number }[])[0]?.one === 1, ms: Date.now() - t1 };
  } catch (e) {
    singleton = {
      ok: false,
      ms: Date.now() - t1,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return Response.json({
    target: { host, port, user },
    dns: { records: dns, error: dnsError },
    connect,
    singleton,
    hint:
      !connect.ok && dns.length > 0 && dns.every((d) => d.family === 6)
        ? "El host solo resuelve IPv6 y este runtime no tiene salida IPv6. Cambiar SUPABASE_DB_URL al Transaction Pooler de Supavisor (aws-0-<region>.pooler.supabase.com:6543, user postgres.<project_ref>) que es IPv4."
        : connect.ok && !singleton.ok
          ? "La conexión fresca anda pero el pool singleton (getPg) se cuelga → pool zombie o fetch_types colgado."
          : undefined,
  });
}
