import { SalesEnablementView } from "@/components/pages/SalesEnablementView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildCsvLinks } from "@/lib/data/csv-export-links";
import { buildSalesEnablementData } from "@/lib/data/sales-enablement-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);
  const [rows, totalTranscripts] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2"),
    loadTotalTranscriptsCount(),
  ]);
  const data = buildSalesEnablementData(rows, 0, filters);
  const filteredRows = applyFilters(rows, filters);
  const stats = computeSampleStats(filteredRows, totalTranscripts);
  return (
    <>
      <SalesEnablementView data={data} csv={buildCsvLinks(params, filteredRows)} />
      <DataQualityFooter stats={stats} pageLabel="Sales Enablement" />
    </>
  );
}
