import { MONITORED_COMPETITORS } from "@/lib/competitor-ads/config";
import { analyzeCompetitor, adsModel } from "@/lib/competitor-ads/analyze";
import { saveAdInsight } from "@/lib/competitor-ads/store";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Re-analiza los avisos YA guardados en la DB SIN pegarle a ScrapeCreators
// (sin fetch/upsert/DCO → sin rate limit ni créditos). Solo corre el análisis
// (transcripción/OCR/clasificación/síntesis) y guarda el insight.
//   ?force=1 → re-analiza TODO ignorando el cache por aviso (para aplicar
//              cambios nuevos del pipeline). Sin force, solo los avisos sin
//              análisis cacheado.
// Admin-only.
export async function GET(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) return new Response("Forbidden", { status: 403 });

  const force = new URL(request.url).searchParams.get("force") === "1";

  const results: Array<{ competitor: string; ok: boolean; analyzed?: number; error?: string }> = [];
  for (const c of MONITORED_COMPETITORS.filter((item) => !item.ownBrand)) {
    try {
      const synthesis = await analyzeCompetitor(c.name, c.source, { force });
      if (synthesis) {
        await saveAdInsight(c.name, c.source, synthesis, adsModel());
        results.push({ competitor: c.name, ok: true, analyzed: synthesis.ads_analyzed });
      } else {
        results.push({ competitor: c.name, ok: false, error: "sin avisos en la DB" });
      }
    } catch (e) {
      results.push({ competitor: c.name, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  return Response.json({ force, results });
}
