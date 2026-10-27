import { PainsDetailView } from "@/components/pages/PainsDetailView";
import { DataQualityFooter } from "@/components/layout/DataQualityFooter";
import { matchesFilters } from "@/lib/data/filters";
import { buildPainsDetailData } from "@/lib/data/pains-detail-data";
import { computeSampleStats } from "@/lib/data/sample-stats";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights, loadTotalTranscriptsCount } from "@/lib/supabase/queries";
import { getServerUserRoles } from "@/lib/supabase/server";
import { canSeeRawQuotes, type AppRole } from "@/lib/auth/roles";
import type { InsightRow } from "@/lib/supabase/types";

// Params propios de la tabla de detalle. No son filtros globales: no viajan
// al CSV ni afectan los charts.
const TABLE_PARAMS = ["pt_theme", "pt_module", "pt_q", "pt_limit"] as const;

// insight_type_display de los pains (lo que matchea el filtro `types` del RPC).
const PAIN_TYPE_DISPLAY = "Dolor / Problema";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstString(value: string | string[] | undefined): string | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v && v.length > 0 ? v : null;
}

// El CSV se genera en server (/api/export/csv, streaming desde Postgres) con
// los mismos filtros globales + solo pains. Antes se mandaban las ~100K filas
// al cliente para armar el CSV en el browser y la pestaña se quedaba sin memoria.
function buildPainsCsvHref(params: Record<string, string | string[] | undefined>): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || (TABLE_PARAMS as readonly string[]).includes(key) || key === "types") continue;
    qs.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  qs.set("types", PAIN_TYPE_DISPLAY);
  return `/api/export/csv?${qs.toString()}`;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = parseFiltersFromSearchParams(params);
  const [rows, userRoles, totalTranscripts] = await Promise.all([
    loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2"),
    getServerUserRoles(),
    loadTotalTranscriptsCount(),
  ]);
  const roles = userRoles as AppRole[];

  // Memory optimization (Hobby plan 1024MB cap):
  // Single-pass filter: type-check + matchesFilters en una sola iteración.
  // Evita el array intermedio de applyFilters().filter().
  const painsOnly: InsightRow[] = [];
  for (const row of rows) {
    if (row.insight_type !== "pain") continue;
    if (!matchesFilters(row, filters)) continue;
    painsOnly.push(row);
  }

  // Los charts agregan sobre todos los pains; la tabla de detalle viaja
  // filtrada y paginada (pt_limit, de a PAIN_TABLE_PAGE).
  const data = buildPainsDetailData(painsOnly, 0, {
    theme: firstString(params.pt_theme),
    module: firstString(params.pt_module),
    search: firstString(params.pt_q),
    limit: Number(firstString(params.pt_limit)) || undefined,
  });

  // Si el user no es admin, dropear verbatim_quote antes del RSC boundary.
  if (!canSeeRawQuotes(roles)) {
    data.painTableRows = data.painTableRows.map((row) => ({ ...row, verbatim_quote: null }));
  }
  const stats = computeSampleStats(painsOnly, totalTranscripts);

  return (
    <>
      <PainsDetailView data={data} csvHref={buildPainsCsvHref(params)} />
      <DataQualityFooter stats={stats} pageLabel="Pains — Detalle" />
    </>
  );
}
