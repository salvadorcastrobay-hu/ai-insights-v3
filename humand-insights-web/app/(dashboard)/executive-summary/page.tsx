import { ExecutiveSummaryView } from "@/components/pages/ExecutiveSummaryView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildExecutiveSummaryData } from "@/lib/data/executive-summary-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { prepareRowsForClient } from "@/lib/data/redact-quotes";
import { getKpis, rpcEnabled } from "@/lib/data/rpc";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
// Worst-case cold call (~10s insights + 2s deal_props). Warm cache: <100ms.
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);

  // En paralelo: rows + total transcripts + roles + (si RPC enabled) KPIs.
  const [rows, totalTranscripts, userRoles, rpcKpis] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0"),
    loadTotalTranscriptsCount(),
    getServerUserRoles(),
    rpcEnabled() ? getKpis(filters) : Promise.resolve(null),
  ]);

  const data = buildExecutiveSummaryData(rows, totalTranscripts, filters);

  // Si el feature flag está ON y la RPC respondió, sobreescribimos los KPIs
  // de `data` con los de la RPC (Postgres-side aggregation). El resto del
  // dashboard sigue viniendo del builder JS por ahora — esto es el POC.
  // Cuando validemos numbers, expandimos a más RPCs.
  if (rpcKpis && rpcKpis.total_calls > 0) {
    data.kpis = {
      ...data.kpis,
      totalCalls: rpcKpis.total_calls,
      dealsMatched: rpcKpis.deals_matched,
      revenue: rpcKpis.revenue_usd,
      insightsPerCall: rpcKpis.insights_per_call.toFixed(1),
      // callsWithInsights necesita totalTranscripts (no en la RPC todavía)
      callsWithInsights: totalTranscripts > 0
        ? ((rpcKpis.total_calls / totalTranscripts) * 100).toFixed(1)
        : "0.0",
    };
  }

  const filteredRows = applyFilters(rows, filters);
  const filteredRowsSafe = prepareRowsForClient(filteredRows, userRoles as AppRole[]);
  const stats = computeSampleStats(filteredRows, totalTranscripts);
  return (
    <>
      <ExecutiveSummaryView data={data} filteredRows={filteredRowsSafe} />
      <DataQualityFooter stats={stats} pageLabel="Executive Summary" />
    </>
  );
}
