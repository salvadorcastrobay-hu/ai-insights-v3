import { PainsDetailView } from "@/components/pages/PainsDetailView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { matchesFilters } from "@/lib/data/filters";
import { buildCsvExportHref } from "@/lib/data/csv-export-links";
import { buildPainsDetailData } from "@/lib/data/pains-detail-data";
import { firstParam } from "@/lib/data/table-page";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import { canSeeRawQuotes, type AppRole } from "@/lib/auth/roles";
import type { InsightRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);
  const [rows, userRoles, totalTranscripts] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2"),
    getServerUserRoles(),
    loadTotalTranscriptsCount(),
  ]);
  const roles = userRoles as AppRole[];

  // Memory optimization (Hobby plan 1024MB cap):
  // Single-pass filter: type-check + matchesFilters en una sola iteración.
  // Evita el array intermedio de applyFilters().filter().
  const painsOnly: InsightRow[] = [];
  for (const row of rows) {
    if (row.insight_type !== "pain") continue;
    if (!matchesFilters(row, filters)) continue;
    painsOnly.push(row);
  }

  // Los charts agregan sobre todos los pains; la tabla de detalle viaja
  // filtrada y paginada (params pt_*, ver usePagedTableParams).
  const data = buildPainsDetailData(painsOnly, 0, {
    theme: firstParam(params.pt_theme),
    module: firstParam(params.pt_module),
    search: firstParam(params.pt_q),
    limit: Number(firstParam(params.pt_limit)),
  });

  // Si el user no es admin, dropear verbatim_quote antes del RSC boundary.
  if (!canSeeRawQuotes(roles)) {
    data.painTableRows = data.painTableRows.map((row) => ({ ...row, verbatim_quote: null }));
  }
  const stats = computeSampleStats(painsOnly, totalTranscripts);

  return (
    <>
      <PainsDetailView data={data} csv={{ href: buildCsvExportHref(params, "pain"), n: painsOnly.length }} />
      <DataQualityFooter stats={stats} pageLabel="Pains — Detalle" />
    </>
  );
}
