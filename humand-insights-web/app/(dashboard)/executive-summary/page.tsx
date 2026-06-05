import { ExecutiveSummaryView } from "@/components/pages/ExecutiveSummaryView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { buildExecutiveSummaryDataRpc } from "@/lib/data/executive-summary-data";
import type { SampleStats } from "@/lib/data/sample-stats";
import { rpcSampleStats } from "@/lib/data/rpc";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import type { InsightRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// RPC-native: arma todo desde la MV (sin loadInsights). Validado vs JS.
export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);

  const [totalTranscripts, s] = await Promise.all([
    loadTotalTranscriptsCount(),
    rpcSampleStats(filters),
  ]);
  const data = await buildExecutiveSummaryDataRpc(filters, totalTranscripts);

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
      <ExecutiveSummaryView data={data} filteredRows={[] as InsightRow[]} />
      <DataQualityFooter stats={stats} pageLabel="Executive Summary" />
    </>
  );
}
