import { ExecutiveSummaryView } from "@/components/pages/ExecutiveSummaryView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import {
  buildExecutiveSummaryData,
  buildExecutiveSummaryDataRpc,
} from "@/lib/data/executive-summary-data";
import { computeSampleStats, type SampleStats } from "@/lib/data/sample-stats";
import { rpcSampleStats } from "@/lib/data/rpc";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { prepareRowsForClient } from "@/lib/data/redact-quotes";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles, getServerUserEmail } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/roles";
import type { InsightRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  if (rpcPreview(email)) {
    const [totalTranscripts, s] = await Promise.all([
      loadTotalTranscriptsCount(),
      rpcSampleStats(filters),
    ]);
    const built = await buildExecutiveSummaryDataRpc(filters, totalTranscripts);
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
        <ExecutiveSummaryView data={built} filteredRows={[] as InsightRow[]} />
        <DataQualityFooter stats={stats} pageLabel="Executive Summary · RPC preview" />
      </>
    );
  }

  const [rows, totalTranscripts, userRoles] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0"),
    loadTotalTranscriptsCount(),
    getServerUserRoles(),
  ]);
  const data = buildExecutiveSummaryData(rows, totalTranscripts, filters);
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
