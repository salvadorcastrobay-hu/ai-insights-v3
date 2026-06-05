import { RegionalGtmView } from "@/components/pages/RegionalGtmView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildRegionalGtmData, buildRegionalGtmDataRpc } from "@/lib/data/regional-gtm-data";
import { computeSampleStats, type SampleStats } from "@/lib/data/sample-stats";
import { rpcSampleStats } from "@/lib/data/rpc";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserEmail } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// WIP: la versión RPC-native (sin loadInsights) se sirve SOLO a estos owners
// para validar lado a lado contra la versión JS que ve el equipo. Cuando
// confirmemos que los números cuadran, se saca el gate y queda para todos.
const RPC_PREVIEW_PREFIXES = ["salvador.castrobay"];

function rpcPreview(email: string | null): boolean {
  if (!email) return false;
  return RPC_PREVIEW_PREFIXES.includes(email.split("@")[0]?.toLowerCase() ?? "");
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);
  const email = await getServerUserEmail();

  // ── Camino RPC-native (solo preview) — sin loadInsights ──
  if (rpcPreview(email)) {
    const [data, totalTranscripts, s] = await Promise.all([
      buildRegionalGtmDataRpc(filters),
      loadTotalTranscriptsCount(),
      rpcSampleStats(filters),
    ]);
    const uniqueCalls = s?.unique_calls ?? 0;
    const stats: SampleStats = {
      uniqueCalls,
      uniqueDeals: s?.unique_deals ?? 0,
      insightsCount: s?.insights_count ?? 0,
      totalCalls: totalTranscripts,
      coveragePct:
        totalTranscripts > 0 ? Math.round((uniqueCalls / totalTranscripts) * 1000) / 10 : 0,
      periodStart: s?.period_start ?? null,
      periodEnd: s?.period_end ?? null,
      avgConfidence: s?.avg_confidence ?? null,
      highConfidencePct: s?.high_confidence_pct ?? null,
      generatedAt: new Date().toISOString(),
    };
    return (
      <>
        <RegionalGtmView data={data} />
        <DataQualityFooter stats={stats} pageLabel="Regional / GTM · RPC preview" />
      </>
    );
  }

  // ── Camino JS actual (equipo) — loadInsights ──
  const [rows, totalTranscripts] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0"),
    loadTotalTranscriptsCount(),
  ]);
  const data = buildRegionalGtmData(rows, 0, filters);
  const stats = computeSampleStats(applyFilters(rows, filters), totalTranscripts);
  return (
    <>
      <RegionalGtmView data={data} />
      <DataQualityFooter stats={stats} pageLabel="Regional / GTM" />
    </>
  );
}
