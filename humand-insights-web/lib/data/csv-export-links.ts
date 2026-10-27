import type { InsightRow, InsightType } from "@/lib/supabase/types";

// insight_type_display tal como lo expone la MV (lo que matchea el filtro
// `types` de rpc_export_insights). Sin tildes: así está en la vista.
const INSIGHT_TYPE_DISPLAY: Record<InsightType, string> = {
  pain: "Dolor / Problema",
  product_gap: "Feature Faltante",
  competitive_signal: "Senal Competitiva",
  deal_friction: "Friccion del Deal",
  faq: "Pregunta Frecuente",
};

// Filtros globales que entiende /api/export/csv (parseFiltersFromSearchParams).
// Cualquier otro param de la page (filtros de tabla, paginación) no viaja.
const GLOBAL_FILTER_KEYS = [
  "regions",
  "segments",
  "countries",
  "industries",
  "owners",
  "categories",
  "channels",
  "sources",
  "date_start",
  "date_end",
  "min_confidence",
  "validated",
  "clients",
] as const;

/** Link a un CSV generado en server + cuántas filas tiene el chart. */
export type CsvLink = { href: string; n: number };

/**
 * URL del export CSV server-side (streaming desde Postgres) con los filtros
 * globales de la page, acotado a `type`. Sin `type` respeta el filtro de
 * tipos global. Reemplaza mandar las filas al cliente para armar el CSV en
 * el browser: con ~150K insights la pestaña se quedaba sin memoria.
 */
export function buildCsvExportHref(
  params: Record<string, string | string[] | undefined>,
  type?: InsightType,
): string {
  const qs = new URLSearchParams();
  for (const key of GLOBAL_FILTER_KEYS) {
    const value = params[key];
    if (value == null) continue;
    qs.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  if (type) {
    qs.set("types", INSIGHT_TYPE_DISPLAY[type]);
  } else if (params.types != null) {
    qs.set("types", Array.isArray(params.types) ? params.types.join(",") : params.types);
  }
  const query = qs.toString();
  return query ? `/api/export/csv?${query}` : "/api/export/csv";
}

export type CsvLinks = Record<InsightType | "all", CsvLink>;

/**
 * Un CsvLink por tipo de insight (+ "all") para las pages que tienen charts
 * de varios tipos. `n` sale de las filas ya filtradas.
 */
export function buildCsvLinks(
  params: Record<string, string | string[] | undefined>,
  filteredRows: readonly InsightRow[],
): CsvLinks {
  const counts: Record<InsightType, number> = {
    pain: 0,
    product_gap: 0,
    competitive_signal: 0,
    deal_friction: 0,
    faq: 0,
  };
  for (const row of filteredRows) {
    if (row.insight_type in counts) counts[row.insight_type]++;
  }
  const links = { all: { href: buildCsvExportHref(params), n: filteredRows.length } } as CsvLinks;
  for (const type of Object.keys(counts) as InsightType[]) {
    links[type] = { href: buildCsvExportHref(params, type), n: counts[type] };
  }
  return links;
}
