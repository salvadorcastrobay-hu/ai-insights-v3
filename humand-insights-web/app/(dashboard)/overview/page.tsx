import { OverviewView } from "@/components/pages/OverviewView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { buildOverviewData } from "@/lib/data/overview-data";
import type { SampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadTotalTranscriptsCount } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  // `validated` es scoped al Overview (no pasa por parseFiltersFromSearchParams
  // → las otras páginas lo ignoran). Toggle "Solo demos validadas".
  // Default: ENCENDIDO (Pedro/Laura piensan en demos validadas). Se apaga con
  // ?validated=false.
  const validated = params.validated !== "false" && params.validated !== "0";
  const filters = { ...parseFiltersFromSearchParams(params), validated };

  const [data, totalTranscripts] = await Promise.all([
    buildOverviewData(filters),
    loadTotalTranscriptsCount(),
  ]);

  const coveragePct =
    totalTranscripts > 0 ? Math.round((data.kpis.uniqueCalls / totalTranscripts) * 1000) / 10 : 0;

  // 100% RPC-native: el footer se arma desde los stats que ya trajo el builder
  // (rpcSampleStats), sin cargar las ~150K filas a Node.
  const stats: SampleStats = {
    uniqueCalls: data.kpis.uniqueCalls,
    uniqueDeals: data.kpis.uniqueDeals,
    insightsCount: data.kpis.insightsCount,
    totalCalls: totalTranscripts,
    coveragePct,
    periodStart: data.kpis.periodStart,
    periodEnd: data.kpis.periodEnd,
    avgConfidence: data.kpis.avgConfidence,
    highConfidencePct: data.kpis.highConfidencePct,
    generatedAt: new Date().toISOString(),
  };

  return (
    <>
      <OverviewView data={data} coveragePct={coveragePct} validated={validated} />
      <DataQualityFooter stats={stats} pageLabel="Overview" />
    </>
  );
}
