import type { InsightRow } from "@/lib/supabase/types";
import { OFFICIAL_REGION_OPTIONS } from "./constants";
import { getDealOutcome } from "./normalizers";

export type Filters = {
  types: string[];
  regions: string[];
  segments: string[];
  countries: string[];
  industries: string[];
  owners: string[];
  modules: string[];
  categories: string[];
  channels: string[];
  sources: string[];
  date_start: string | null;
  date_end: string | null;
  /**
   * Filtro de confianza mínima del LLM (campo `confidence` en cada insight).
   * Rango [0, 1]. Cuando está seteado, excluye filas con confidence < threshold.
   * Filas sin confidence (null) se mantienen — no penalizar data legacy.
   * Default toggle UI: 0.7.
   */
  min_confidence: number | null;
  /**
   * Solo demos validadas (first_meeting_status='Validated'). Scoped al Overview
   * por ahora — solo las RPCs (MV) lo respetan; el path JS (loadInsights) lo
   * ignora porque no trae first_meeting_status.
   */
  validated: boolean | null;
  /** Solo clientes = deals en Closed Won (el meeting se convirtió en cliente). */
  clients: boolean | null;
};

export type FilterOptions = {
  types: string[];
  regions: string[];
  segments: string[];
  countries: string[];
  industries: string[];
  owners: string[];
  modules: string[];
  categories: string[];
  channels: string[];
  sources: string[];
  date_min: string | null;
  date_max: string | null;
  /** país (normalizado) → región (normalizada), para cascada de filtros. */
  countryRegions: Record<string, string>;
};

export const EMPTY_FILTERS: Filters = {
  types: [],
  regions: [],
  segments: [],
  countries: [],
  industries: [],
  owners: [],
  modules: [],
  categories: [],
  channels: [],
  sources: [],
  date_start: null,
  date_end: null,
  min_confidence: null,
  validated: null,
  clients: null,
};

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function min(values: string[]): string | null {
  if (!values.length) return null;
  return [...values].sort()[0] ?? null;
}

function max(values: string[]): string | null {
  if (!values.length) return null;
  return [...values].sort().at(-1) ?? null;
}

export function computeFilterOptions(rows: InsightRow[]): FilterOptions {
  const regionsInRows = new Set(unique(rows.map((row) => row.region)));
  const dateValues = unique(rows.map((row) => row.call_date));

  // país → región (la región normalizada que más aparece para ese país).
  const countryRegions: Record<string, string> = {};
  for (const row of rows) {
    const c = row.country?.trim();
    const r = row.region?.trim();
    if (c && r && !countryRegions[c]) countryRegions[c] = r;
  }

  return {
    countryRegions,
    types: unique(rows.map((row) => row.insight_type_display)).sort(),
    regions: OFFICIAL_REGION_OPTIONS.filter((region) => regionsInRows.has(region)),
    segments: unique(rows.map((row) => row.segment)).sort(),
    countries: unique(rows.map((row) => row.country)).sort(),
    industries: unique(rows.map((row) => row.industry)).sort(),
    owners: unique(rows.map((row) => row.deal_owner)).sort(),
    modules: unique(rows.map((row) => row.module_display)).sort(),
    categories: unique(rows.map((row) => row.hr_category_display)).sort(),
    channels: unique(rows.map((row) => row.acquisition_channel ?? null)).sort(),
    sources: unique(rows.map((row) => row.deal_source ?? null)).sort(),
    date_min: min(dateValues),
    date_max: max(dateValues),
  };
}

export function applyFilters(rows: InsightRow[], filters: Filters): InsightRow[] {
  return rows.filter((row) => matchesFilters(row, filters));
}

/** Single-row predicate. Reusable para hacer filter + type-check en una pasada. */
export function matchesFilters(row: InsightRow, filters: Filters): boolean {
  if (filters.types.length && !filters.types.includes(row.insight_type_display)) return false;
  if (filters.regions.length && !filters.regions.includes(row.region ?? "")) return false;
  if (filters.segments.length && !filters.segments.includes(row.segment ?? "")) return false;
  if (filters.countries.length && !filters.countries.includes(row.country ?? "")) return false;
  if (filters.industries.length && !filters.industries.includes(row.industry ?? "")) return false;
  if (filters.owners.length && !filters.owners.includes(row.deal_owner ?? "")) return false;
  if (filters.modules.length && !filters.modules.includes(row.module_display ?? "")) return false;
  if (filters.categories.length && !filters.categories.includes(row.hr_category_display ?? "")) return false;
  if (filters.channels.length && !filters.channels.includes(row.acquisition_channel ?? "")) return false;
  if (filters.sources.length && !filters.sources.includes(row.deal_source ?? "")) return false;
  if (filters.date_start && row.call_date && row.call_date < filters.date_start) return false;
  if (filters.date_end && row.call_date && row.call_date > filters.date_end) return false;
  if (
    filters.min_confidence != null &&
    typeof row.confidence === "number" &&
    Number.isFinite(row.confidence) &&
    row.confidence < filters.min_confidence
  ) {
    return false;
  }
  // Solo clientes = deals que cerraron ganados (se volvieron cliente).
  if (filters.clients && getDealOutcome(row.deal_stage) !== "won") return false;
  return true;
}
