import { RegionalGtmView } from "@/components/pages/RegionalGtmView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { buildRegionalGtmDataRpc } from "@/lib/data/regional-gtm-data";
import type { SampleStats } from "@/lib/data/sample-stats";
import { rpcSampleStats } from "@/lib/data/rpc";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadTotalTranscriptsCount } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// RPC-native: arma toda la página desde la MV normalizada (sin loadInsights →
// no carga las ~150K filas a Node). Validado contra la versión JS anterior.
export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);

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
      <DataQualityFooter stats={stats} pageLabel="Regional / GTM" />
    </>
  );
}
