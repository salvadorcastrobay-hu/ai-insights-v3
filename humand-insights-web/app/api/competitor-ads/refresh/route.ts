import { MONITORED_COMPETITORS, isAdSourceWipEnabled } from "@/lib/competitor-ads/config";
import { fetchCompanyAds } from "@/lib/competitor-ads/scrapecreators";
import { fetchLinkedInAds } from "@/lib/competitor-ads/linkedin";
import { fetchGoogleAds } from "@/lib/competitor-ads/googleads";
import { upsertAds, markInactiveAds, saveAdInsight } from "@/lib/competitor-ads/store";
import { analyzeCompetitor, adsModel } from "@/lib/competitor-ads/analyze";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles, getServerUserEmail } from "@/lib/supabase/server";
import type { AdSource } from "@/lib/competitor-ads/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Result = {
  competitor: string;
  source: string;
  fetched: number;
  upserted: number;
  deactivated: number;
  analyzed: boolean;
  error?: string;
  analyzeError?: string;
};

// Corre tasks con un cap de concurrencia (gentil con la API externa).
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

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

  const requestedSource = new URL(req.url).searchParams.get("source") ?? "meta_ads";
  if (!VALID_SOURCES.includes(requestedSource as AdSource)) {
    return new Response(JSON.stringify({ error: `source inválido: ${requestedSource}` }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const source = requestedSource as AdSource;

  // Filtro opcional para reintentar solo algunos competidores (ej. después de
  // un timeout parcial) sin repetir toda la corrida ni gastar créditos de más.
  const competitorsParam = new URL(req.url).searchParams.get("competitors");
  const competitorFilter = competitorsParam
    ? new Set(competitorsParam.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))
    : null;

  if (source !== "meta_ads") {
    const email = await getServerUserEmail();
    if (!isAdSourceWipEnabled(email)) {
      return new Response(JSON.stringify({ error: `${source} todavía no está disponible para tu usuario.` }), {
        status: 403,
        headers: { "content-type": "application/json" },
      });
    }
  }

  const results: Result[] = [];
  const targets = MONITORED_COMPETITORS.filter(
    (c) => !c.ownBrand && c.source === source && (!competitorFilter || competitorFilter.has(c.name.toLowerCase())),
  );
  await pooled(targets, 3, async (c) => {
    const r: Result = { competitor: c.name, source: c.source, fetched: 0, upserted: 0, deactivated: 0, analyzed: false };
    try {
      if (c.source === "meta_ads") {
        const ads = await fetchCompanyAds(c.name, {
          companyName: c.query,
          pageId: c.pageId,
          country: "ALL",
          status: "ACTIVE",
          sortBy: "relevancy_monthly_grouped",
          maxPages: c.maxPages ?? 1,
          // DCO/multi-version vienen sin creativo en el listado → completar
          // vía detalle por aviso (1 crédito extra c/u, solo los vacíos).
          enrichMissingMedia: true,
        });
        r.fetched = ads.length;
        r.upserted = await upsertAds(ads);
        r.deactivated = await markInactiveAds(c.name, c.source, new Set(ads.map((a) => a.ad_archive_id)));
      } else if (c.source === "linkedin_ads") {
        const ads = await fetchLinkedInAds(c.name, {
          company: c.query,
          maxPages: c.maxPages ?? 2,
          matchName: c.linkedinAdvertiserName,
        });
        r.fetched = ads.length;
        r.upserted = await upsertAds(ads);
        r.deactivated = await markInactiveAds(c.name, c.source, new Set(ads.map((a) => a.ad_archive_id)));
      } else if (c.source === "google_ads") {
        if (!c.googleDomain) throw new Error("Falta googleDomain en la config del competidor");
        const ads = await fetchGoogleAds(c.name, { domain: c.googleDomain });
        r.fetched = ads.length;
        r.upserted = await upsertAds(ads);
        r.deactivated = await markInactiveAds(c.name, c.source, new Set(ads.map((a) => a.ad_archive_id)));
      }
      // Análisis IA (no rompe el refresh si falla, pero el error se reporta).
      try {
        const synthesis = await analyzeCompetitor(c.name, c.source, { language: c.language });
        if (synthesis) {
          await saveAdInsight(c.name, c.source, synthesis, adsModel());
          r.analyzed = true;
        } else {
          r.analyzeError = "analyzeCompetitor devolvió null (sin avisos)";
        }
      } catch (e) {
        r.analyzeError = e instanceof Error ? e.message : String(e);
        console.error(`[competitor-ads] analyze ${c.name} falló:`, e);
      }
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
    }
    results.push(r);
  });

  const totalUpserted = results.reduce((a, x) => a + x.upserted, 0);
  return new Response(JSON.stringify({ totalUpserted, results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
