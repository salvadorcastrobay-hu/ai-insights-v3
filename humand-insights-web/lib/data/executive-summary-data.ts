import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  distinctCount,
  filterByType,
  groupDistinctTranscripts,
  monthlyInsightTrend,
  stackBy,
} from "@/lib/data/dashboard-aggregations";
import { painsWithPct, uniqueDealsRevenue } from "@/lib/data/computations";
import {
  rpcFaqModuleBreakdown,
  rpcFaqModuleHeat,
  rpcGroupDistinct,
  rpcHeatmap,
  rpcKpisNorm,
  rpcModuleDemand,
  rpcMonthlyTrend,
  rpcPainThemeSiblings,
  rpcRevenueBy,
  rpcSampleStats,
  rpcStack,
  rpcTopBreakdowns,
} from "@/lib/data/rpc";
import type { InsightRow } from "@/lib/supabase/types";

export type GroupPoint = { name: string; value: number };
export type PctPoint = { name: string; value: number; pct: number };
export type BreakdownGroup = { name: string; data: GroupPoint[] };
export type HeatMapData = {
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
};
export type StackData = {
  data: Array<Record<string, string | number>>;
  stackKeys: string[];
};

export type ExecutiveSummaryData = {
  kpis: {
    insightsPerCall: string;
    totalCalls: number;
    dealsMatched: number;
    revenue: number;
    callsWithInsights: string;
  };
  composition: {
    byIndustry: GroupPoint[];
    bySegment: GroupPoint[];
    byCountry: GroupPoint[];
  };
  insightTypes: GroupPoint[];
  pains: {
    topPains: PctPoint[];
    painThemeSiblings: BreakdownGroup[];
    painByModuleBreakdown: BreakdownGroup[];
    painSegmentHeat: HeatMapData;
  };
  moduleDemand: PctPoint[];
  gaps: {
    byFreq: PctPoint[];
    byRevenue: GroupPoint[];
  };
  competitors: StackData;
  frictions: {
    top: GroupPoint[];
    breakdown: BreakdownGroup[];
    byRevenue: GroupPoint[];
  };
  faqs: {
    top: GroupPoint[];
    moduleHeat: HeatMapData;
    topicModuleBreakdown: BreakdownGroup[];
  };
  trend: {
    data: Array<Record<string, string | number>>;
    keys: string[];
  };
};

/** Group-by with % of a provided total. */
function groupWithPct(
  rows: InsightRow[],
  key: keyof InsightRow,
  total: number,
  topN: number,
): PctPoint[] {
  const points = groupDistinctTranscripts(rows, key, topN);
  return points.map((p) => ({
    ...p,
    pct: total > 0 ? (p.value / total) * 100 : 0,
  }));
}

/** For each top-N primary value, also return breakdowns by a secondary dim within the subset. */
function siblingsByMostCommonTheme(
  painRows: InsightRow[],
  topN: number,
): BreakdownGroup[] {
  const topPainsOrder = groupDistinctTranscripts(
    painRows,
    "insight_subtype_display",
    topN,
  ).map((p) => p.name);

  const result: BreakdownGroup[] = [];
  for (const painName of topPainsOrder) {
    const subset = painRows.filter((r) => r.insight_subtype_display === painName);
    // Find most common pain_theme in subset.
    const themeCounts = new Map<string, number>();
    for (const row of subset) {
      const t = (row.pain_theme ?? "").toString().trim();
      if (!t) continue;
      themeCounts.set(t, (themeCounts.get(t) ?? 0) + 1);
    }
    if (themeCounts.size === 0) {
      result.push({ name: painName, data: [] });
      continue;
    }
    const theme = [...themeCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    const siblings = painRows.filter(
      (r) => r.pain_theme === theme && r.insight_subtype_display !== painName,
    );
    const siblingData = groupDistinctTranscripts(siblings, "insight_subtype_display", 6);
    result.push({ name: `${painName} · tema: ${theme}`, data: siblingData });
  }
  return result;
}

function moduleBreakdownForTopPains(painRows: InsightRow[], topN: number): BreakdownGroup[] {
  const topPainNames = groupDistinctTranscripts(painRows, "insight_subtype_display", topN).map(
    (p) => p.name,
  );
  return topPainNames.map((name) => {
    const subset = painRows.filter(
      (r) => r.insight_subtype_display === name && r.module_display,
    );
    return { name, data: groupDistinctTranscripts(subset, "module_display", 6) };
  });
}

function revenueByFeature(gaps: InsightRow[], topN: number): GroupPoint[] {
  // Sum of amount per unique (deal_id, feature_display) pair; group by feature.
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  for (const row of gaps) {
    const feat = (row.feature_display ?? "").toString().trim();
    const deal = row.deal_id;
    if (!feat || !deal) continue;
    const key = `${deal}::${feat}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
      totals.set(feat, (totals.get(feat) ?? 0) + row.amount);
    }
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

function revenueByFriction(frictions: InsightRow[], topN: number): GroupPoint[] {
  const seen = new Set<string>();
  const totals = new Map<string, number>();
  for (const row of frictions) {
    const sub = row.insight_subtype_display;
    const deal = row.deal_id;
    if (!sub || !deal) continue;
    const key = `${deal}::${sub}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (typeof row.amount === "number" && Number.isFinite(row.amount)) {
      totals.set(sub, (totals.get(sub) ?? 0) + row.amount);
    }
  }
  return [...totals.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, topN);
}

/** FAQ co-occurrence: for each topic, the top modules in transcripts that mention it. */
function faqTopicByModule(
  faqs: InsightRow[],
  allRows: InsightRow[],
  topN: number,
): BreakdownGroup[] {
  const topicNames = groupDistinctTranscripts(faqs, "insight_subtype_display", topN).map(
    (p) => p.name,
  );
  const transcriptModules = new Map<string, Set<string>>();
  for (const row of allRows) {
    const mod = row.module_display;
    if (!mod) continue;
    const set = transcriptModules.get(row.transcript_id) ?? new Set<string>();
    set.add(mod);
    transcriptModules.set(row.transcript_id, set);
  }
  return topicNames.map((topic) => {
    const topicTranscripts = new Set(
      faqs.filter((r) => r.insight_subtype_display === topic).map((r) => r.transcript_id),
    );
    const moduleCounts = new Map<string, number>();
    for (const tid of topicTranscripts) {
      const mods = transcriptModules.get(tid);
      if (!mods) continue;
      for (const m of mods) {
        moduleCounts.set(m, (moduleCounts.get(m) ?? 0) + 1);
      }
    }
    return {
      name: topic,
      data: [...moduleCounts.entries()]
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 6),
    };
  });
}

/** FAQ topic × module co-occurrence matrix (module rows × topic columns). */
function faqTopicModuleHeat(
  faqs: InsightRow[],
  allRows: InsightRow[],
  topModules: number,
  topTopics: number,
): HeatMapData {
  const transcriptModules = new Map<string, Set<string>>();
  for (const row of allRows) {
    if (!row.module_display) continue;
    const set = transcriptModules.get(row.transcript_id) ?? new Set<string>();
    set.add(row.module_display);
    transcriptModules.set(row.transcript_id, set);
  }

  const topicOrder = groupDistinctTranscripts(faqs, "insight_subtype_display", topTopics).map(
    (p) => p.name,
  );

  const moduleFaqCounts = new Map<string, number>();
  for (const row of faqs) {
    const mods = transcriptModules.get(row.transcript_id);
    if (!mods) continue;
    for (const m of mods) {
      moduleFaqCounts.set(m, (moduleFaqCounts.get(m) ?? 0) + 1);
    }
  }
  const moduleOrder = [...moduleFaqCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topModules)
    .map(([name]) => name);

  const values = moduleOrder.map((mod) =>
    topicOrder.map((topic) => {
      let count = 0;
      const topicTranscripts = new Set(
        faqs.filter((r) => r.insight_subtype_display === topic).map((r) => r.transcript_id),
      );
      for (const tid of topicTranscripts) {
        const mods = transcriptModules.get(tid);
        if (mods && mods.has(mod)) count += 1;
      }
      return count;
    }),
  );

  return { rowLabels: moduleOrder, colLabels: topicOrder, values };
}

export function buildExecutiveSummaryData(
  rows: InsightRow[],
  totalTranscripts: number,
  filters: Filters,
): ExecutiveSummaryData {
  const filteredRows = applyFilters(rows, filters);

  const totalCalls = distinctCount(filteredRows, "transcript_id");
  const insightsPerCall = totalCalls > 0 ? (filteredRows.length / totalCalls).toFixed(1) : "0.0";
  const dealsMatched = distinctCount(filteredRows, "deal_id");
  const revenue = uniqueDealsRevenue(filteredRows);
  const callsWithInsights =
    totalTranscripts > 0 ? ((totalCalls / totalTranscripts) * 100).toFixed(1) : "0.0";

  const painRows = filterByType(filteredRows, "pain");
  const gaps = filterByType(filteredRows, "product_gap");
  // "Competidores mencionados": cuenta menciones de competidores en TODOS los
  // tipos de insight (no solo competitive_signal), para que un incumbente
  // nombrado dentro de un pain / friction / gap también sume. Las filas sin
  // relación competitiva explícita (las que no son competitive_signal) se
  // muestran bajo el bucket "Mencionado".
  const comp = filteredRows
    .filter(
      (r) =>
        r.competitor_name &&
        r.competitor_name !== "Humand" &&
        !r.is_own_brand_competitor,
    )
    .map((r) => ({
      ...r,
      competitor_relationship_display:
        r.competitor_relationship_display ?? "Mencionado",
    }));
  const frictions = filterByType(filteredRows, "deal_friction");
  const faqs = filterByType(filteredRows, "faq");

  const trendData = monthlyInsightTrend(filteredRows);
  const trendKeys = [...new Set(filteredRows.map((r) => r.insight_type_display))].filter(Boolean);

  const moduleFocus = filteredRows.filter(
    (r) => (r.insight_type === "pain" || r.insight_type === "product_gap") && r.module_display,
  );

  return {
    kpis: {
      insightsPerCall,
      totalCalls,
      dealsMatched,
      revenue,
      callsWithInsights,
    },
    composition: {
      byIndustry: groupDistinctTranscripts(filteredRows, "industry", 15),
      bySegment: groupDistinctTranscripts(filteredRows, "segment", 8),
      byCountry: groupDistinctTranscripts(filteredRows, "country", 15),
    },
    insightTypes: groupDistinctTranscripts(filteredRows, "insight_type_display", 20),
    pains: {
      topPains: painsWithPct(painRows, 10, totalTranscripts),
      painThemeSiblings: siblingsByMostCommonTheme(painRows, 2),
      painByModuleBreakdown: moduleBreakdownForTopPains(painRows, 2),
      painSegmentHeat: buildHeatMap(painRows, "insight_subtype_display", "segment", 15, 8),
    },
    moduleDemand: groupWithPct(moduleFocus, "module_display", totalTranscripts, 12),
    gaps: {
      byFreq: groupWithPct(gaps, "feature_display", distinctCount(gaps, "deal_id"), 20),
      byRevenue: revenueByFeature(gaps, 20),
    },
    competitors: stackBy(comp, "competitor_name", "competitor_relationship_display", 12),
    frictions: {
      top: groupDistinctTranscripts(frictions, "insight_subtype_display", 10),
      breakdown: ((): BreakdownGroup[] => {
        const topNames = groupDistinctTranscripts(
          frictions,
          "insight_subtype_display",
          2,
        ).map((p) => p.name);
        return topNames.map((name) => {
          const subset = frictions.filter((r) => r.insight_subtype_display === name);
          const hasStage = subset.some((r) => r.deal_stage);
          return {
            name,
            data: groupDistinctTranscripts(
              subset,
              hasStage ? "deal_stage" : "segment",
              8,
            ),
          };
        });
      })(),
      byRevenue: revenueByFriction(frictions, 10),
    },
    faqs: {
      top: groupDistinctTranscripts(faqs, "insight_subtype_display", 10),
      moduleHeat: faqTopicModuleHeat(faqs, filteredRows, 10, 6),
      topicModuleBreakdown: faqTopicByModule(faqs, filteredRows, 2),
    },
    trend: {
      data: trendData,
      keys: trendKeys,
    },
  };
}

/**
 * Versión RPC-native de buildExecutiveSummaryData: misma ExecutiveSummaryData
 * desde la MV (sin loadInsights). Validar lado a lado antes de promover.
 */
export async function buildExecutiveSummaryDataRpc(
  filters: Filters,
  totalTranscripts: number,
): Promise<ExecutiveSummaryData> {
  // distinct deals entre product_gap (para el % de gaps.byFreq)
  const gapFilters: Filters = { ...filters, types: ["Feature Faltante"] };

  const [
    kpis,
    byIndustry,
    bySegment,
    byCountry,
    insightTypes,
    topPainsRaw,
    painThemeSiblings,
    painByModuleBreakdown,
    painSegmentHeat,
    moduleDemandRaw,
    gapsByFreqRaw,
    gapsByRevenue,
    gapStats,
    competitors,
    fricTop,
    fricBreakdown,
    fricByRevenue,
    faqTop,
    faqModuleHeat,
    faqTopicModuleBreakdown,
    trendData,
  ] = await Promise.all([
    rpcKpisNorm(filters),
    rpcGroupDistinct(filters, "industry", { n: 15 }),
    rpcGroupDistinct(filters, "segment", { n: 8 }),
    rpcGroupDistinct(filters, "country", { n: 15 }),
    rpcGroupDistinct(filters, "insight_type_display", { n: 20 }),
    rpcGroupDistinct(filters, "insight_subtype_display", { scope: "pain", n: 10 }),
    rpcPainThemeSiblings(filters, 2),
    rpcTopBreakdowns(filters, "insight_subtype_display", "module_display", {
      scope: "pain",
      topPrimary: 2,
      topBreakdown: 6,
    }),
    rpcHeatmap(filters, "insight_subtype_display", "segment", {
      scope: "pain",
      nRows: 15,
      nCols: 8,
    }),
    rpcModuleDemand(filters, 12),
    rpcGroupDistinct(filters, "feature_display", { scope: "product_gap", n: 20 }),
    rpcRevenueBy(filters, "feature_display", { scope: "product_gap", n: 20 }),
    rpcSampleStats(gapFilters),
    rpcStack(filters, "competitor_name", "competitor_relationship_display", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 12,
    }),
    rpcGroupDistinct(filters, "insight_subtype_display", { scope: "deal_friction", n: 10 }),
    rpcTopBreakdowns(filters, "insight_subtype_display", "deal_stage", {
      scope: "deal_friction",
      topPrimary: 2,
      topBreakdown: 8,
    }),
    rpcRevenueBy(filters, "insight_subtype_display", { scope: "deal_friction", n: 10 }),
    rpcGroupDistinct(filters, "insight_subtype_display", { scope: "faq", n: 10 }),
    rpcFaqModuleHeat(filters, 10, 6),
    rpcFaqModuleBreakdown(filters, 2),
    rpcMonthlyTrend(filters),
  ]);

  const t = totalTranscripts;
  const topPains: PctPoint[] = topPainsRaw.map((p) => ({
    ...p,
    pct: t > 0 ? (p.value / t) * 100 : 0,
  }));
  const moduleDemand: PctPoint[] = moduleDemandRaw.map((p) => ({
    ...p,
    pct: t > 0 ? (p.value / t) * 100 : 0,
  }));
  const gapDeals = gapStats?.unique_deals ?? 0;
  const byFreq: PctPoint[] = gapsByFreqRaw.map((p) => ({
    ...p,
    pct: gapDeals > 0 ? (p.value / gapDeals) * 100 : 0,
  }));
  const trendKeys = [
    ...new Set(trendData.flatMap((d) => Object.keys(d).filter((k) => k !== "month"))),
  ];

  return {
    kpis: {
      insightsPerCall: kpis.insights_per_call.toFixed(1),
      totalCalls: kpis.total_calls,
      dealsMatched: kpis.deals_matched,
      revenue: kpis.revenue,
      callsWithInsights: t > 0 ? ((kpis.total_calls / t) * 100).toFixed(1) : "0.0",
    },
    composition: { byIndustry, bySegment, byCountry },
    insightTypes,
    pains: { topPains, painThemeSiblings, painByModuleBreakdown, painSegmentHeat },
    moduleDemand,
    gaps: { byFreq, byRevenue: gapsByRevenue },
    competitors,
    frictions: { top: fricTop, breakdown: fricBreakdown, byRevenue: fricByRevenue },
    faqs: { top: faqTop, moduleHeat: faqModuleHeat, topicModuleBreakdown: faqTopicModuleBreakdown },
    trend: { data: trendData, keys: trendKeys },
  };
}
