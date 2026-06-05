import { notFound } from "next/navigation";

import { OverviewView } from "@/components/pages/OverviewView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { buildOverviewData } from "@/lib/data/overview-data";
import type { SampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserEmail } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// WIP: gateado a estos owners (prefijo de email) hasta que esté listo para
// el equipo. Mantener en sync con el item del Sidebar (ownerPrefixes).
const OVERVIEW_ALLOWED_PREFIXES = ["salvador.castrobay"];

function emailAllowed(email: string | null): boolean {
  if (!email) return false;
  const prefix = email.split("@")[0]?.toLowerCase() ?? "";
  return OVERVIEW_ALLOWED_PREFIXES.includes(prefix);
}

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const email = await getServerUserEmail();
  if (!emailAllowed(email)) {
    // Para cualquiera que no esté en el allowlist, la ruta no existe.
    notFound();
  }

  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);

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
      <OverviewView data={data} coveragePct={coveragePct} />
      <DataQualityFooter stats={stats} pageLabel="Overview" />
    </>
  );
}
