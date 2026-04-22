import { ExecutiveSummaryView } from "@/components/pages/ExecutiveSummaryView";
import { buildExecutiveSummaryData } from "@/lib/data/executive-summary-data";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
// Worst-case cold call (~10s insights + 2s deal_props). Warm cache: <100ms.
export const maxDuration = 60;

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

  const data = buildExecutiveSummaryData(rows, totalTranscripts, filters);
  return <ExecutiveSummaryView data={data} />;
}
