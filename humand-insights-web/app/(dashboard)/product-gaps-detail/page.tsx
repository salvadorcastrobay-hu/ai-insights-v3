import { ProductGapsDetailView } from "@/components/pages/ProductGapsDetailView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildCsvLinks } from "@/lib/data/csv-export-links";
import { buildProductGapsDetailData } from "@/lib/data/product-gaps-detail-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import { firstParam } from "@/lib/data/table-page";
import { canSeeRawQuotes, type AppRole } from "@/lib/auth/roles";

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
  // Los charts agregan sobre todos los gaps; la tabla de detalle viaja
  // filtrada y paginada (params gt_*, ver usePagedTableParams).
  const data = buildProductGapsDetailData(rows, 0, filters, {
    priority: firstParam(params.gt_priority),
    module: firstParam(params.gt_module),
    search: firstParam(params.gt_q),
    limit: Number(firstParam(params.gt_limit)),
  });
  // Si el user no es admin, dropear gap_description antes del RSC boundary.
  if (!canSeeRawQuotes(userRoles as AppRole[])) {
    data.gapTableRows = data.gapTableRows.map((row) => ({ ...row, gap_description: null }));
  }
  const filteredRows = applyFilters(rows, filters);
  const stats = computeSampleStats(filteredRows, totalTranscripts);
  return (
    <>
      <ProductGapsDetailView data={data} csv={buildCsvLinks(params, filteredRows)} />
      <DataQualityFooter stats={stats} pageLabel="Product Gaps — Detalle" />
    </>
  );
}
