import { applyFilters, type Filters } from "@/lib/data/filters";
import type { InsightRow } from "@/lib/supabase/types";

export const COMPARE_BY_OPTIONS = [
  { label: "Períodos", key: "periods" },
  { label: "Regiones", key: "region" },
  { label: "Países", key: "country" },
  { label: "Segmentos", key: "segment" },
  { label: "Industrias", key: "industry" },
  { label: "Canales", key: "acquisition_channel" },
] as const;

export type CompareByKey = (typeof COMPARE_BY_OPTIONS)[number]["key"];
export const METRICS = ["Menciones", "Deals", "Calls", "Revenue", "Avg Confidence"] as const;
export type MetricName = (typeof METRICS)[number];

export type FacetMetrics = {
  Menciones: number;
  Deals: number;
  Calls: number;
  Revenue: number;
  "Avg Confidence": number;
};

export type PeriodFacet = { month: string } & FacetMetrics;
export type CategoryFacet = { name: string } & FacetMetrics;

export type ComparativeAnalysisData = {
  periods: PeriodFacet[];
  byFacet: Record<Exclude<CompareByKey, "periods">, CategoryFacet[]>;
};

function facetMetrics(rows: InsightRow[]): FacetMetrics {
  const dealMap = new Map<string, number>();
  for (const row of rows) {
    if (row.deal_id && row.amount != null) dealMap.set(row.deal_id, row.amount);
  }
  const revenue = [...dealMap.values()].reduce((acc, value) => acc + value, 0);

  const conf = rows.map((row) => Number(row.confidence ?? 0)).filter((v) => Number.isFinite(v));
  const avgConfidence = conf.length > 0 ? conf.reduce((acc, value) => acc + value, 0) / conf.length : 0;

  return {
    Menciones: rows.length,
    Deals: new Set(rows.map((row) => row.deal_id).filter(Boolean)).size,
    Calls: new Set(rows.map((row) => row.transcript_id).filter(Boolean)).size,
    Revenue: revenue,
    "Avg Confidence": avgConfidence,
  };
}

function bucketByKey(rows: InsightRow[], key: keyof InsightRow): CategoryFacet[] {
  const groups = new Map<string, InsightRow[]>();
  for (const row of rows) {
    const value = String(row[key] ?? "").trim();
    if (!value) continue;
    groups.set(value, [...(groups.get(value) ?? []), row]);
  }
  return [...groups.entries()]
    .map(([name, entries]) => ({ name, ...facetMetrics(entries) }))
    .sort((a, b) => b.Menciones - a.Menciones);
}

export function buildComparativeAnalysisData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): ComparativeAnalysisData {
  const filteredRows = applyFilters(rows, filters);

  const byMonth = new Map<string, InsightRow[]>();
  for (const row of filteredRows) {
    if (!row.call_date) continue;
    const month = row.call_date.slice(0, 7);
    byMonth.set(month, [...(byMonth.get(month) ?? []), row]);
  }

  const periods: PeriodFacet[] = [...byMonth.entries()]
    .map(([month, entries]) => ({ month, ...facetMetrics(entries) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    periods,
    byFacet: {
      region: bucketByKey(filteredRows, "region"),
      country: bucketByKey(filteredRows, "country"),
      segment: bucketByKey(filteredRows, "segment"),
      industry: bucketByKey(filteredRows, "industry"),
      acquisition_channel: bucketByKey(filteredRows, "acquisition_channel"),
    },
  };
}
