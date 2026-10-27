import { FaqDetailView } from "@/components/pages/FaqDetailView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { applyFilters } from "@/lib/data/filters";
import { buildCsvLinks } from "@/lib/data/csv-export-links";
import { buildFaqDetailData } from "@/lib/data/faq-detail-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import { firstParam } from "@/lib/data/table-page";
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
  // Los charts agregan sobre todas las FAQs; la tabla de detalle viaja
  // filtrada y paginada (params ft_*, ver usePagedTableParams).
  const data = buildFaqDetailData(rows, 0, filters, {
    topic: firstParam(params.ft_topic),
    search: firstParam(params.ft_q),
    limit: Number(firstParam(params.ft_limit)),
  });
  // Si el user no es admin, dropear verbatim_quote antes del RSC boundary.
  if (!canSeeRawQuotes(userRoles as AppRole[])) {
    data.faqTableRows = data.faqTableRows.map((row) => ({ ...row, verbatim_quote: null }));
  }
  const filteredRows = applyFilters(rows, filters);
  const stats = computeSampleStats(filteredRows, totalTranscripts);
  return (
    <>
      <FaqDetailView data={data} csv={buildCsvLinks(params, filteredRows)} />
      <DataQualityFooter stats={stats} pageLabel="FAQs — Detalle" />
    </>
  );
}
