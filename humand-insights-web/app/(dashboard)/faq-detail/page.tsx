import { FaqDetailView } from "@/components/pages/FaqDetailView";
import { applyFilters } from "@/lib/data/filters";
import { buildFaqDetailData } from "@/lib/data/faq-detail-data";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights } from "@/lib/supabase/queries";
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
  const [rows, userRoles] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0"),
    getServerUserRoles(),
  ]);
  const data = buildFaqDetailData(rows, 0, filters);
  const filteredRows = applyFilters(rows, filters);
  const filteredRowsSafe = prepareRowsForClient(filteredRows, userRoles as AppRole[]);
  return <FaqDetailView data={data} filteredRows={filteredRowsSafe} />;
}
