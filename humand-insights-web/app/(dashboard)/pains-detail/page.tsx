import { PainsDetailView } from "@/components/pages/PainsDetailView";
import { applyFilters } from "@/lib/data/filters";
import { buildPainsDetailData } from "@/lib/data/pains-detail-data";
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
  // Memory optimization (Hobby plan 1024MB):
  // 1. applyFilters una sola vez + filter por "pain" en la misma chain.
  // 2. buildPainsDetailData ya no hace applyFilters internamente —
  //    elimina duplicate work.
  // 3. El array de pains se reusa para ambos: el builder y filteredRows
  //    del cliente. Una sola alocación. ~5x menos payload RSC.
  const painsOnly = applyFilters(rows, filters).filter((r) => r.insight_type === "pain");
  const data = buildPainsDetailData(painsOnly, 0);
  return <PainsDetailView data={data} filteredRows={painsOnly} />;
}
