import { ProductGapsDetailView } from "@/components/pages/ProductGapsDetailView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildProductGapsDetailData } from "@/lib/data/product-gaps-detail-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import { prepareRowsForClient } from "@/lib/data/redact-quotes";
import type { AppRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);
  const [rows, userRoles, totalTranscripts] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1"),
    getServerUserRoles(),
    loadTotalTranscriptsCount(),
  ]);
  const data = buildProductGapsDetailData(rows, 0, filters);
  const filteredRows = applyFilters(rows, filters);
  const filteredRowsSafe = prepareRowsForClient(filteredRows, userRoles as AppRole[]);
  const stats = computeSampleStats(filteredRows, totalTranscripts);
  return (
    <>
      <ProductGapsDetailView data={data} filteredRows={filteredRowsSafe} />
      <DataQualityFooter stats={stats} pageLabel="Product Gaps — Detalle" />
    </>
  );
}
