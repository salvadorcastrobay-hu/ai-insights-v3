import { MONITORED_COMPETITORS } from "@/lib/competitor-ads/config";
import { fetchCompanyAds } from "@/lib/competitor-ads/scrapecreators";
import { upsertAds, saveAdInsight } from "@/lib/competitor-ads/store";
import { analyzeCompetitor, adsModel } from "@/lib/competitor-ads/analyze";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Result = {
  competitor: string;
  source: string;
  fetched: number;
  upserted: number;
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

export async function POST(): Promise<Response> {
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

  const results: Result[] = [];
  await pooled(MONITORED_COMPETITORS, 3, async (c) => {
    const r: Result = { competitor: c.name, source: c.source, fetched: 0, upserted: 0, analyzed: false };
    try {
      // Por ahora solo meta_ads tiene conector.
      if (c.source === "meta_ads") {
        const ads = await fetchCompanyAds(c.name, {
          companyName: c.query,
          pageId: c.pageId,
          country: "ALL",
          status: "ACTIVE",
          sortBy: "relevancy_monthly_grouped",
          maxPages: 1,
          // DCO/multi-version vienen sin creativo en el listado → completar
          // vía detalle por aviso (1 crédito extra c/u, solo los vacíos).
          enrichMissingMedia: true,
        });
        r.fetched = ads.length;
        r.upserted = await upsertAds(ads);
      }
      // Análisis IA (no rompe el refresh si falla, pero el error se reporta).
      try {
        const synthesis = await analyzeCompetitor(c.name, c.source);
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
