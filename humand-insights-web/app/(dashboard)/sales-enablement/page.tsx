import { SalesEnablementView } from "@/components/pages/SalesEnablementView";
import { buildSalesEnablementData } from "@/lib/data/sales-enablement-data";
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
  const data = buildSalesEnablementData(rows, 0, filters);
  return <SalesEnablementView data={data} />;
}
