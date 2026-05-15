import { CompetitiveIntelligenceView } from "@/components/pages/CompetitiveIntelligenceView";
import { applyFilters } from "@/lib/data/filters";
import { buildCompetitiveIntelligenceData } from "@/lib/data/competitive-intelligence-data";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights } from "@/lib/supabase/queries";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);
  const rows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0");
  const data = buildCompetitiveIntelligenceData(rows, 0, filters);
  const filteredRows = applyFilters(rows, filters);
  return <CompetitiveIntelligenceView data={data} filteredRows={filteredRows} />;
}
