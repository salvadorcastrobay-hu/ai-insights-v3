import { applyFilters, type Filters } from "@/lib/data/filters";
import type { InsightRow } from "@/lib/supabase/types";

// -------- Config constants shared with the view --------

export const COMPARISON_OPTIONS = [
  { label: "Períodos", key: "periods" as const, mode: "time" as const },
  { label: "Regiones", key: "region" as const, mode: "category" as const, column: "region" as const },
  { label: "Países", key: "country" as const, mode: "category" as const, column: "country" as const },
  { label: "Segmentos", key: "segment" as const, mode: "category" as const, column: "segment" as const },
  { label: "Industrias", key: "industry" as const, mode: "category" as const, column: "industry" as const },
  { label: "Canales de adquisición", key: "acquisition_channel" as const, mode: "category" as const, column: "acquisition_channel" as const },
];
export type CompareByKey = (typeof COMPARISON_OPTIONS)[number]["key"];

export const FACET_OPTIONS: Record<string, keyof SlimRow> = {
  "Tipo de insight": "insight_type_display",
  "Subtipo de insight": "insight_subtype_display",
  "Tema de pain": "pain_theme",
  "Módulo": "module_display",
  "Estado del módulo": "module_status",
  "Categoría HR": "hr_category_display",
  "Feature gap": "feature_display",
  "Competidor": "competitor_name",
  "Relación competitiva": "competitor_relationship_display",
  "Deal stage": "deal_stage",
  "Deal owner": "deal_owner",
  "País": "country",
  "Región": "region",
  "Segmento": "segment",
  "Industria": "industry",
  "Canal de adquisición": "acquisition_channel",
  "Fuente del deal": "deal_source",
};

export const METRIC_OPTIONS = {
  Menciones: "mentions",
  "Deals únicos": "unique_deals",
  "Calls únicas": "unique_calls",
  Revenue: "revenue",
  "Confianza promedio": "avg_confidence",
} as const;
export type MetricKey = (typeof METRIC_OPTIONS)[keyof typeof METRIC_OPTIONS];
export type MetricLabel = keyof typeof METRIC_OPTIONS;

export const DISPLAY_OPTIONS = [
  "Volumen absoluto",
  "Participación porcentual",
  "Delta absoluto",
  "Delta porcentual",
] as const;
export type DisplayMode = (typeof DISPLAY_OPTIONS)[number];

// -------- Server-side slim projection --------

// Keep only fields needed for A/B math. Cuts row payload ~5x.
export type SlimRow = {
  transcript_id: string | null;
  deal_id: string | null;
  amount: number | null;
  call_date: string | null;
  confidence: number | null;
  region: string | null;
  country: string | null;
  segment: string | null;
  industry: string | null;
  acquisition_channel: string | null;
  deal_source: string | null;
  deal_stage: string | null;
  deal_owner: string | null;
  insight_type_display: string | null;
  insight_subtype_display: string | null;
  pain_theme: string | null;
  module_display: string | null;
  module_status: string | null;
  hr_category_display: string | null;
  feature_display: string | null;
  competitor_name: string | null;
  competitor_relationship_display: string | null;
  is_own_brand_competitor: boolean | null;
};

export type ComparativePayload = {
  rows: SlimRow[];
  dateMin: string | null;
  dateMax: string | null;
};

export function buildComparativePayload(
  rows: InsightRow[],
  filters: Filters,
): ComparativePayload {
  const filtered = applyFilters(rows, filters);
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  const slim: SlimRow[] = new Array(filtered.length);
  for (let i = 0; i < filtered.length; i++) {
    const r = filtered[i];
    if (r.call_date) {
      if (!dateMin || r.call_date < dateMin) dateMin = r.call_date;
      if (!dateMax || r.call_date > dateMax) dateMax = r.call_date;
    }
    slim[i] = {
      transcript_id: r.transcript_id ?? null,
      deal_id: r.deal_id ?? null,
      amount: r.amount ?? null,
      call_date: r.call_date ?? null,
      confidence: (r.confidence as number | null) ?? null,
      region: r.region ?? null,
      country: r.country ?? null,
      segment: r.segment ?? null,
      industry: r.industry ?? null,
      acquisition_channel: r.acquisition_channel ?? null,
      deal_source: r.deal_source ?? null,
      deal_stage: r.deal_stage ?? null,
      deal_owner: r.deal_owner ?? null,
      insight_type_display: r.insight_type_display ?? null,
      insight_subtype_display: r.insight_subtype_display ?? null,
      pain_theme: r.pain_theme ?? null,
      module_display: r.module_display ?? null,
      module_status: r.module_status ?? null,
      hr_category_display: r.hr_category_display ?? null,
      feature_display: r.feature_display ?? null,
      competitor_name: r.competitor_name ?? null,
      competitor_relationship_display: r.competitor_relationship_display ?? null,
      is_own_brand_competitor: r.is_own_brand_competitor ?? null,
    };
  }
  return { rows: slim, dateMin, dateMax };
}

// -------- Client-side math (ported from views/comparative_analysis.py) --------

export function cleanLabel(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/\s+/g, " ");
  return text.length > 0 ? text : null;
}

export function metricTotal(rows: SlimRow[], metric: MetricKey): number {
  if (rows.length === 0) return 0;
  if (metric === "mentions") return rows.length;
  if (metric === "unique_deals") {
    const s = new Set<string>();
    for (const r of rows) if (r.deal_id) s.add(r.deal_id);
    return s.size;
  }
  if (metric === "unique_calls") {
    const s = new Set<string>();
    for (const r of rows) if (r.transcript_id) s.add(r.transcript_id);
    return s.size;
  }
  if (metric === "revenue") {
    // dedup by deal_id then sum amount
    const byDeal = new Map<string, number>();
    for (const r of rows) {
      if (!r.deal_id) continue;
      if (!byDeal.has(r.deal_id)) byDeal.set(r.deal_id, r.amount ?? 0);
    }
    let sum = 0;
    for (const v of byDeal.values()) sum += v;
    return sum;
  }
  if (metric === "avg_confidence") {
    let sum = 0;
    let n = 0;
    for (const r of rows) {
      const v = Number(r.confidence);
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  }
  return 0;
}

export function groupMetric(
  rows: SlimRow[],
  facetCol: keyof SlimRow,
  metric: MetricKey,
): Map<string, number> {
  const out = new Map<string, number>();
  if (rows.length === 0) return out;

  // bucket rows by cleaned facet label
  const buckets = new Map<string, SlimRow[]>();
  for (const r of rows) {
    const label = cleanLabel(r[facetCol]);
    if (!label) continue;
    const list = buckets.get(label);
    if (list) list.push(r);
    else buckets.set(label, [r]);
  }

  for (const [label, subset] of buckets.entries()) {
    out.set(label, metricTotal(subset, metric));
  }
  return out;
}

export type ComparisonRow = {
  arista: string;
  a: number;
  b: number;
  shareA: number;
  shareB: number;
  deltaAbs: number;
  deltaPct: number | null;
};

export function buildComparison(
  dfA: SlimRow[],
  dfB: SlimRow[],
  facetCol: keyof SlimRow,
  metric: MetricKey,
): ComparisonRow[] {
  const mapA = groupMetric(dfA, facetCol, metric);
  const mapB = groupMetric(dfB, facetCol, metric);
  const keys = new Set<string>([...mapA.keys(), ...mapB.keys()]);
  const totalA = [...mapA.values()].reduce((acc, v) => acc + v, 0);
  const totalB = [...mapB.values()].reduce((acc, v) => acc + v, 0);
  const out: ComparisonRow[] = [];
  for (const k of keys) {
    const a = mapA.get(k) ?? 0;
    const b = mapB.get(k) ?? 0;
    out.push({
      arista: k,
      a,
      b,
      shareA: totalA > 0 ? (a / totalA) * 100 : 0,
      shareB: totalB > 0 ? (b / totalB) * 100 : 0,
      deltaAbs: a - b,
      deltaPct: b === 0 ? null : ((a - b) / b) * 100,
    });
  }
  return out;
}

export function applyDateWindow(rows: SlimRow[], startISO: string, endISO: string): SlimRow[] {
  // inclusive range on YYYY-MM-DD comparison
  return rows.filter((r) => r.call_date && r.call_date >= startISO && r.call_date <= endISO);
}

export function windowPresets(dateMax: string, days: number): {
  startA: string; endA: string; startB: string; endB: string;
} {
  const max = new Date(`${dateMax}T00:00:00Z`);
  const endA = max;
  const startA = new Date(endA);
  startA.setUTCDate(startA.getUTCDate() - (days - 1));
  const endB = new Date(startA);
  endB.setUTCDate(endB.getUTCDate() - 1);
  const startB = new Date(endB);
  startB.setUTCDate(startB.getUTCDate() - (days - 1));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { startA: fmt(startA), endA: fmt(endA), startB: fmt(startB), endB: fmt(endB) };
}

export function formatMetricValue(
  value: number | null,
  metric: MetricKey,
  percentage = false,
): string {
  if (value === null || !Number.isFinite(value)) return "n/a";
  if (percentage) return `${value.toFixed(1)}%`;
  if (metric === "revenue") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(value);
  }
  if (metric === "avg_confidence") return value.toFixed(2);
  return Math.round(value).toLocaleString("en-US");
}
