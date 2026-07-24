import { isAdSourceWipEnabled } from "@/lib/competitor-ads/config";
import { startPaidRefreshJob } from "@/lib/competitor-ads/paid-refresh-job";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles, getServerUserEmail } from "@/lib/supabase/server";
import type { AdSource } from "@/lib/competitor-ads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const VALID_SOURCES: AdSource[] = ["meta_ads", "linkedin_ads", "google_ads"];

export async function POST(req: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) {
    return new Response(JSON.stringify({ error: "Solo admin puede refrescar (consume créditos)." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  if (!process.env.SCRAPECREATORS_API_KEY) {
    return new Response(JSON.stringify({ error: "Falta SCRAPECREATORS_API_KEY en el entorno." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const url = new URL(req.url);
  // Acepta `sources` (lista separada por coma, para refrescar todo en un solo
  // job) o `source` (uno solo, botones por fuente). Default: meta_ads.
  const raw = url.searchParams.get("sources") ?? url.searchParams.get("source") ?? "meta_ads";
  const requested = raw.split(",").map((s) => s.trim()).filter(Boolean);
  const invalid = requested.filter((s) => !VALID_SOURCES.includes(s as AdSource));
  if (invalid.length) {
    return new Response(JSON.stringify({ error: `source inválido: ${invalid.join(", ")}` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const sources = requested as AdSource[];

  // Las fuentes distintas de meta están gated por usuario (WIP).
  if (sources.some((s) => s !== "meta_ads")) {
    const email = await getServerUserEmail();
    if (!isAdSourceWipEnabled(email)) {
      return new Response(JSON.stringify({ error: "linkedin/google todavía no están disponibles para tu usuario." }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
  }

  // Filtro opcional para reintentar solo algunos competidores (ej. después de
  // un timeout parcial) sin repetir toda la corrida ni gastar créditos de más.
  const competitorsParam = url.searchParams.get("competitors");
  const competitorFilter = competitorsParam
    ? new Set(competitorsParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;

  const job = startPaidRefreshJob({ sources, competitorFilter });
  return new Response(JSON.stringify({ job }), {
    status: 202,
    headers: { "content-type": "application/json" },
  });
}
