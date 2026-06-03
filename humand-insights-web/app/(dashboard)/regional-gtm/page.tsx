import { RegionalGtmView } from "@/components/pages/RegionalGtmView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildRegionalGtmData } from "@/lib/data/regional-gtm-data";
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
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0"),
    loadTotalTranscriptsCount(),
  ]);
  const data = buildRegionalGtmData(rows, 0, filters);
  const stats = computeSampleStats(applyFilters(rows, filters), totalTranscripts);
  return (
    <>
      <RegionalGtmView data={data} />
      <DataQualityFooter stats={stats} pageLabel="Regional / GTM" />
    </>
  );
}
