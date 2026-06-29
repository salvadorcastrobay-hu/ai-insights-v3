import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  distinctCount,
  filterByType,
  groupDistinctTranscripts,
  stackBy,
} from "@/lib/data/dashboard-aggregations";
import { uniqueDealsRevenue } from "@/lib/data/computations";
import type { InsightRow } from "@/lib/supabase/types";

export type NameValue = { name: string; value: number };
export type PctPoint = { name: string; value: number; pct: number };
export type HeatMapData = {
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
};
export type StackData = {
  data: Array<Record<string, string | number>>;
  stackKeys: string[];
};
export type ThemeBreakdown = {
  theme: string;
  demos: number;
  pct: number;
  subtypes: Array<{ name: string; value: number; pctOfTheme: number }>;
};
export type PrioritySummary = {
  priority: string;
  description: string;
  features: number;
  revenue: number;
  avgDeal: number;
};

export type PainDetailRow = {
  id: string;
  company: string | null;
  industry: string | null;
  segment: string | null;
  country: string | null;
  module: string | null;
  summary: string;
  quote: string | null;
  confidence: number;
};

export type GapDetailRow = {
  id: string;
  company: string | null;
  industry: string | null;
  segment: string | null;
  country: string | null;
  owner: string | null;
  module: string | null;
  priority: string | null;
  amount: number | null;
  summary: string;
  quote: string | null;
  confidence: number;
};

export type ProductIntelligenceData = {
  topPains: PctPoint[];
  painThemeBreakdown: ThemeBreakdown[];
  painSegmentHeat: HeatMapData;
  painIndustryStack: StackData;
  moduleSegmentStack: StackData;
  featureFreq: NameValue[];
  featureRevenue: NameValue[];
  featureSegmentStack: StackData;
  priorities: PrioritySummary[];
  gapsCount: number;
  painDetailByPain: Record<string, PainDetailRow[]>;
  gapDetailByFeature: Record<string, GapDetailRow[]>;
};

const PRIORITY_DESC: Record<string, string> = {
  must_have: "El prospect no avanza sin esto",
  nice_to_have: "Lo pide pero no es bloqueante",
  dealbreaker: "Perdimos deals por esto",
};

const PRIORITY_LABEL: Record<string, string> = {
  must_have: "Must Have",
  nice_to_have: "Nice to Have",
  dealbreaker: "Dealbreaker",
};

export function buildProductIntelligenceData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): ProductIntelligenceData {
  const filteredRows = applyFilters(rows, filters);
  const pains = filterByType(filteredRows, "pain");
  const gaps = filterByType(filteredRows, "product_gap");

  const totalDemos = distinctCount(filteredRows, "transcript_id");

  const topPainsRaw = groupDistinctTranscripts(pains, "insight_subtype_display", 15);
  const topPains: PctPoint[] = topPainsRaw.map((p) => ({
    ...p,
    pct: totalDemos > 0 ? (p.value / totalDemos) * 100 : 0,
  }));

  // Top 2 pain themes with subtype breakdown.
  const themeCounts = groupDistinctTranscripts(pains, "pain_theme", 2);
  const totalPainDemos = distinctCount(pains, "transcript_id");
  const painThemeBreakdown: ThemeBreakdown[] = themeCounts.map((themeRow) => {
    const subset = pains.filter((r) => r.pain_theme === themeRow.name);
    const subs = groupDistinctTranscripts(subset, "insight_subtype_display", 6);
    const subTotal = subs.reduce((acc, s) => acc + s.value, 0);
    return {
      theme: themeRow.name,
      demos: themeRow.value,
      pct: totalPainDemos > 0 ? (themeRow.value / totalPainDemos) * 100 : 0,
      subtypes: subs.map((s) => ({
        ...s,
        pctOfTheme: subTotal > 0 ? (s.value / subTotal) * 100 : 0,
      })),
    };
  });

  // pain × industry: stack rows=industry, colored by pain_theme
  const painIndustryStack = stackBy(
    pains.filter((r) => r.industry && r.pain_theme),
    "industry",
    "pain_theme",
    10,
    8,
  );

  const moduleSegmentStack = stackBy(
    filteredRows.filter(
      (r) =>
        (r.insight_type === "pain" || r.insight_type === "product_gap") &&
        r.module_display &&
        r.segment,
    ),
    "module_display",
    "segment",
    12,
    6,
  );

  // Feature gaps
  const featureFreq = groupDistinctTranscripts(gaps, "feature_display", 20);
  const featureRevenue = (() => {
    const seen = new Set<string>();
    const totals = new Map<string, number>();
    for (const row of gaps) {
      const f = row.feature_display;
      const d = row.deal_id;
      if (!f || !d) continue;
      const key = `${d}::${f}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
        totals.set(f, (totals.get(f) ?? 0) + row.amount);
      }
    }
    return [...totals.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 20);
  })();

  const featureSegmentStack = stackBy(
    gaps.filter((r) => r.feature_display && r.segment),
    "feature_display",
    "segment",
    15,
    6,
  );

  // Priority summary
  const priorities: PrioritySummary[] = (["dealbreaker", "must_have", "nice_to_have"] as const).map(
    (priority) => {
      const subset = gaps.filter((row) => row.gap_priority === priority);
      const revenue = uniqueDealsRevenue(subset);
      const distinctDeals = distinctCount(subset, "deal_id");
      return {
        priority: PRIORITY_LABEL[priority] ?? priority,
        description: PRIORITY_DESC[priority] ?? "",
        features: new Set(subset.map((r) => r.feature_display).filter(Boolean)).size,
        revenue,
        avgDeal: distinctDeals > 0 ? revenue / distinctDeals : 0,
      };
    },
  );

  // Precompute drill-down maps (capped to avoid bloat).
  const painDetailByPain: Record<string, PainDetailRow[]> = {};
  for (const painName of topPainsRaw.map((p) => p.name)) {
    painDetailByPain[painName] = pains
      .filter((r) => r.insight_subtype_display === painName)
      .sort((a, b) => Number(b.confidence ?? 0) - Number(a.confidence ?? 0))
      .slice(0, 50)
      .map((r) => ({
        id: r.id,
        company: r.company_name,
        industry: r.industry,
        segment: r.segment,
        country: r.country,
        module: r.module_display,
        summary: r.summary,
        quote: r.verbatim_quote,
        confidence: Number(r.confidence ?? 0),
      }));
  }

  const gapDetailByFeature: Record<string, GapDetailRow[]> = {};
  for (const feat of featureFreq.map((f) => f.name)) {
    gapDetailByFeature[feat] = gaps
      .filter((r) => r.feature_display === feat)
      .sort(
        (a, b) =>
          (typeof b.amount === "number" ? b.amount : 0) -
          (typeof a.amount === "number" ? a.amount : 0),
      )
      .slice(0, 50)
      .map((r) => ({
        id: r.id,
        company: r.company_name,
        industry: r.industry,
        segment: r.segment,
        country: r.country,
        owner: r.deal_owner,
        module: r.module_display,
        priority: r.gap_priority ? PRIORITY_LABEL[r.gap_priority] ?? r.gap_priority : null,
        amount: typeof r.amount === "number" ? r.amount : null,
        summary: r.summary,
        quote: r.verbatim_quote,
        confidence: Number(r.confidence ?? 0),
      }));
  }

  return {
    topPains,
    painThemeBreakdown,
    painSegmentHeat: buildHeatMap(pains, "insight_subtype_display", "segment", 15, 8),
    painIndustryStack,
    moduleSegmentStack,
    featureFreq,
    featureRevenue,
    featureSegmentStack,
    priorities,
    gapsCount: gaps.length,
    painDetailByPain,
    gapDetailByFeature,
  };
}
