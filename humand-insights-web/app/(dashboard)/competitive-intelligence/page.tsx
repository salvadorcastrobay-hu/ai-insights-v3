import { CompetitiveIntelligenceView } from "@/components/pages/CompetitiveIntelligenceView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import {
  buildCompetitiveIntelligenceData,
  buildCompetitiveIntelligenceDataRpc,
} from "@/lib/data/competitive-intelligence-data";
import { computeSampleStats, type SampleStats } from "@/lib/data/sample-stats";
import { rpcSampleStats } from "@/lib/data/rpc";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles, getServerUserEmail } from "@/lib/supabase/server";
import { prepareRowsForClient } from "@/lib/data/redact-quotes";
import type { AppRole } from "@/lib/auth/roles";
import type { InsightRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Preview RPC-native gateado para validar lado a lado vs la versión JS.
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
    const [data, totalTranscripts, s] = await Promise.all([
      buildCompetitiveIntelligenceDataRpc(filters),
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
    // En RPC no pasamos filas crudas (el CSV per-chart se omite; el export
    // global de la filter bar sigue funcionando).
    return (
      <>
        <CompetitiveIntelligenceView data={data} filteredRows={[] as InsightRow[]} />
        <DataQualityFooter stats={stats} pageLabel="Competitive Intelligence · RPC preview" />
      </>
    );
  }

  const [rows, userRoles, totalTranscripts] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0"),
    getServerUserRoles(),
    loadTotalTranscriptsCount(),
  ]);
  const data = buildCompetitiveIntelligenceData(rows, 0, filters);
  const filteredRows = applyFilters(rows, filters);
  const filteredRowsSafe = prepareRowsForClient(filteredRows, userRoles as AppRole[]);
  const stats = computeSampleStats(filteredRows, totalTranscripts);
  return (
    <>
      <CompetitiveIntelligenceView data={data} filteredRows={filteredRowsSafe} />
      <DataQualityFooter stats={stats} pageLabel="Competitive Intelligence" />
    </>
  );
}
