import { PainsDetailView } from "@/components/pages/PainsDetailView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { matchesFilters } from "@/lib/data/filters";
import { buildPainsDetailData } from "@/lib/data/pains-detail-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { redactQuotesForRoles } from "@/lib/data/redact-quotes";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import type { AppRole } from "@/lib/auth/roles";
import type { InsightRow } from "@/lib/supabase/types";

// Campos que el CSV download exporta para /pains-detail. Cualquier otro
// campo del InsightRow no se usa en el cliente — lo dropeamos antes de
// serializar a RSC para bajar el payload ~30%.
const CSV_FIELDS = [
  "id",
  "transcript_id",
  "call_date",
  "company_name",
  "segment",
  "industry",
  "region",
  "country",
  "deal_id",
  "deal_name",
  "deal_stage",
  "deal_owner",
  "amount",
  "acquisition_channel",
  "insight_type",
  "insight_subtype_display",
  "module_display",
  "feature_display",
  "gap_priority",
  "competitor_name",
  "competitor_relationship_display",
  "summary",
  "verbatim_quote",
  "confidence",
  "pain_theme",
] as const satisfies ReadonlyArray<keyof InsightRow>;

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);
  const [rows, userRoles, totalTranscripts] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1"),
    getServerUserRoles(),
    loadTotalTranscriptsCount(),
  ]);
  const roles = userRoles as AppRole[];

  // Memory optimization (Hobby plan 1024MB cap):
  // Single-pass filter: type-check + matchesFilters en una sola iteración.
  // Evita el array intermedio de applyFilters().filter() — el builder y
  // el cliente comparten esta misma referencia.
  const painsOnly: InsightRow[] = [];
  for (const row of rows) {
    if (row.insight_type !== "pain") continue;
    if (!matchesFilters(row, filters)) continue;
    painsOnly.push(row);
  }

  const data = buildPainsDetailData(painsOnly, 0);

  // Slim version para serializar a RSC: solo los campos que el cliente usa
  // (CSV export + display). Drop ~10 campos no usados → -30% payload.
  const filteredRowsSlim = painsOnly.map((row) => {
    const slim: Partial<InsightRow> = {};
    for (const field of CSV_FIELDS) {
      (slim as Record<string, unknown>)[field] = row[field];
    }
    return slim as InsightRow;
  });

  // Si el user no es admin, dropear verbatim_quote y gap_description antes
  // del RSC boundary. Tables/CSV muestran "—" en su lugar.
  const filteredRowsSafe = redactQuotesForRoles(filteredRowsSlim, roles);
  const stats = computeSampleStats(painsOnly, totalTranscripts);

  return (
    <>
      <PainsDetailView data={data} filteredRows={filteredRowsSafe} />
      <DataQualityFooter stats={stats} pageLabel="Pains — Detalle" />
    </>
  );
}
