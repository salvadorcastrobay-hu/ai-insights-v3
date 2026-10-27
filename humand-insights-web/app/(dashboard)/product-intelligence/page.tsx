import { ProductIntelligenceView } from "@/components/pages/ProductIntelligenceView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildCsvLinks } from "@/lib/data/csv-export-links";
import { buildProductIntelligenceData } from "@/lib/data/product-intelligence-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
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
  const data = buildProductIntelligenceData(rows, 0, filters);
  const filteredRows = applyFilters(rows, filters);
  // Si el user no es admin, dropear las citas de las tablas de detalle antes
  // del RSC boundary.
  if (!canSeeRawQuotes(userRoles as AppRole[])) {
    for (const detail of [data.painDetailByPain, data.gapDetailByFeature]) {
      for (const key of Object.keys(detail)) {
        detail[key] = detail[key].map((row) => ({ ...row, quote: null }));
      }
    }
  }
  const stats = computeSampleStats(filteredRows, totalTranscripts);
  return (
    <>
      <ProductIntelligenceView data={data} csv={buildCsvLinks(params, filteredRows)} />
      <DataQualityFooter stats={stats} pageLabel="Product Intelligence" />
    </>
  );
}
