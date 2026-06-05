import { ExecutiveSummaryView } from "@/components/pages/ExecutiveSummaryView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildExecutiveSummaryData } from "@/lib/data/executive-summary-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { prepareRowsForClient } from "@/lib/data/redact-quotes";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

// NOTA: revertido a JS (loadInsights). La versión RPC (buildExecutiveSummaryDataRpc)
// disparaba ~20 RPCs en paralelo, varias con self-joins de co-ocurrencia sobre
// la MV (189K) → saturaba la DB y timeouteaban TODAS las RPCs en cascada.
// Pendiente: optimizar esas RPCs (menos paralelismo + co-ocurrencia indexada)
// antes de re-habilitar el camino RPC en la landing.
export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);

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
