import { ExecutiveSummaryView } from "@/components/pages/ExecutiveSummaryView";
import { applyFilters } from "@/lib/data/filters";
import { buildExecutiveSummaryData } from "@/lib/data/executive-summary-data";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { redactQuotesForRoles } from "@/lib/data/redact-quotes";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";
// Worst-case cold call (~10s insights + 2s deal_props). Warm cache: <100ms.
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);

  const [rows, totalTranscripts, userRoles] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0"),
    loadTotalTranscriptsCount(),
    getServerUserRoles(),
  ]);

  const data = buildExecutiveSummaryData(rows, totalTranscripts, filters);
  const filteredRows = applyFilters(rows, filters);
  const filteredRowsSafe = redactQuotesForRoles(filteredRows, userRoles as AppRole[]);
  return <ExecutiveSummaryView data={data} filteredRows={filteredRowsSafe} />;
}
