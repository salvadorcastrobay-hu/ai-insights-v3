import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  distinctCount,
  filterByType,
  groupDistinctTranscripts,
  stackBy,
} from "@/lib/data/dashboard-aggregations";
import { formatCurrency, uniqueDealsRevenue } from "@/lib/data/computations";
import type { InsightRow } from "@/lib/supabase/types";

export type NameValue = { name: string; value: number };
export type HeatMapData = {
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
};
export type StackData = {
  data: Array<Record<string, string | number>>;
  stackKeys: string[];
};

export type FrictionBreakdownItem = {
  name: string;
  totalDeals: number;
  pctOfAffected: number;
  topSummaries: Array<{ text: string; count: number; pct: number }>;
};

export type AERow = {
  ae: string;
  deals: number;
  avgAmount: string;
  frictionsPerDeal: string;
  pctDealsWithFriction: string;
  topFriction: string;
  topCompetitor: string;
  frictionsPerDealRaw: number;
};

export type FaqBattleCard = {
  topic: string;
  demos: number;
  questions: Array<{ text: string; count: number; pct: number }>;
};

export type SalesEnablementData = {
  isEmpty: boolean;
  kpis: {
    totalFricciones: number;
    affectedDeals: number;
    revenueAtRisk: number;
    frictionsPerDeal: string;
  };
  topFrictionTypes: NameValue[];
  top2Friction: FrictionBreakdownItem[];
  frictionSegment: StackData;
  stageHeat: HeatMapData;
  industryHeat: HeatMapData;
  aeRows: AERow[];
  aeFrictionStack: StackData;
  faqBattleCards: FaqBattleCard[];
  hasFaqs: boolean;
};

function mostFrequent(values: (string | null)[]): string {
  const counts = new Map<string, number>();
  for (const v of values) {
    if (!v) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  let best = "";
  let bestCount = -1;
  for (const [k, c] of counts) {
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  }
  return best;
}

export function buildSalesEnablementData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): SalesEnablementData {
  const filteredRows = applyFilters(rows, filters);
  const frictions = filterByType(filteredRows, "deal_friction");
  const faqs = filterByType(filteredRows, "faq");

  if (frictions.length === 0 && faqs.length === 0) {
    return {
      isEmpty: true,
      kpis: { totalFricciones: 0, affectedDeals: 0, revenueAtRisk: 0, frictionsPerDeal: "0.0" },
      topFrictionTypes: [],
      top2Friction: [],
      frictionSegment: { data: [], stackKeys: [] },
      stageHeat: { rowLabels: [], colLabels: [], values: [] },
      industryHeat: { rowLabels: [], colLabels: [], values: [] },
      aeRows: [],
      aeFrictionStack: { data: [], stackKeys: [] },
      faqBattleCards: [],
      hasFaqs: false,
    };
  }

  const totalFricciones = frictions.length;
  const affectedDeals = distinctCount(frictions, "deal_id");
  const revenueAtRisk = uniqueDealsRevenue(frictions);
  const frictionsPerDeal = affectedDeals > 0 ? (totalFricciones / affectedDeals).toFixed(1) : "0.0";

  // Top friction types by distinct deals
  const frictionDealsMap = new Map<string, Set<string>>();
  for (const row of frictions) {
    const name = row.insight_subtype_display;
    if (!name) continue;
    const bucket = frictionDealsMap.get(name) ?? new Set<string>();
    if (row.deal_id) bucket.add(row.deal_id);
    frictionDealsMap.set(name, bucket);
  }
  const topFrictionTypes: NameValue[] = [...frictionDealsMap.entries()]
    .map(([name, set]) => ({ name, value: set.size }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 12);

  // Top-2 friction breakdown (summary frequency)
  const top2Names = topFrictionTypes.slice(0, 2).map((item) => item.name);
  const top2Friction: FrictionBreakdownItem[] = top2Names.map((name) => {
    const subset = frictions.filter((row) => row.insight_subtype_display === name);
    const deals = new Set(subset.map((r) => r.deal_id).filter(Boolean)).size;
    const summaryDeals = new Map<string, Set<string>>();
    for (const row of subset) {
      const summary = row.summary;
      if (!summary) continue;
      const bucket = summaryDeals.get(summary) ?? new Set<string>();
      if (row.deal_id) bucket.add(row.deal_id);
      summaryDeals.set(summary, bucket);
    }
    const topSummaries = [...summaryDeals.entries()]
      .map(([text, set]) => ({
        text,
        count: set.size,
        pct: deals > 0 ? Math.round((set.size / deals) * 100) : 0,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return {
      name,
      totalDeals: deals,
      pctOfAffected: affectedDeals > 0 ? Math.round((deals / affectedDeals) * 100) : 0,
      topSummaries,
    };
  });

  // AE table
  const aeRowsByOwner = new Map<string, InsightRow[]>();
  for (const row of filteredRows) {
    if (!row.deal_owner) continue;
    const list = aeRowsByOwner.get(row.deal_owner) ?? [];
    list.push(row);
    aeRowsByOwner.set(row.deal_owner, list);
  }
  const aeRows: AERow[] = [];
  for (const [owner, rs] of aeRowsByOwner) {
    const dealIds = new Set(rs.map((r) => r.deal_id).filter(Boolean));
    const dealsCount = dealIds.size;
    const amountMap = new Map<string, number>();
    for (const r of rs) {
      if (r.deal_id && r.amount != null) amountMap.set(r.deal_id, r.amount);
    }
    const avgAmount = amountMap.size > 0
      ? formatCurrency([...amountMap.values()].reduce((a, b) => a + b, 0) / amountMap.size)
      : "$0";
    const aeFriction = rs.filter((r) => r.insight_type === "deal_friction");
    const aeFricCount = aeFriction.length;
    const dealsWithFric = new Set(aeFriction.map((r) => r.deal_id).filter(Boolean)).size;
    const frictionsPerDealRaw = dealsCount > 0 ? aeFricCount / dealsCount : 0;
    const pctDealsWithFriction = dealsCount > 0
      ? `${Math.round((dealsWithFric / dealsCount) * 100)}%`
      : "0%";
    const topFriction = mostFrequent(aeFriction.map((r) => r.insight_subtype_display));
    const aeComp = rs.filter(
      (r) => r.insight_type === "competitive_signal" && !r.is_own_brand_competitor,
    );
    const topCompetitor = mostFrequent(aeComp.map((r) => r.competitor_name));
    aeRows.push({
      ae: owner,
      deals: dealsCount,
      avgAmount,
      frictionsPerDeal: frictionsPerDealRaw.toFixed(1),
      pctDealsWithFriction,
      topFriction: topFriction || "—",
      topCompetitor: topCompetitor || "—",
      frictionsPerDealRaw,
    });
  }
  aeRows.sort((a, b) => b.frictionsPerDealRaw - a.frictionsPerDealRaw);

  // Top 10 AEs for the AE × friction stacked bar (ranked by total frictions)
  const aeFricCounts = new Map<string, number>();
  for (const r of frictions) {
    if (!r.deal_owner) continue;
    aeFricCounts.set(r.deal_owner, (aeFricCounts.get(r.deal_owner) ?? 0) + 1);
  }
  const topAes = [...aeFricCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name]) => name);
  const frictionsForTopAes = frictions.filter(
    (r) => r.deal_owner && topAes.includes(r.deal_owner),
  );
  const aeFrictionStack = stackBy(frictionsForTopAes, "deal_owner", "insight_subtype_display", 10, 8);

  // FAQ battle cards grouped by topic
  const faqsByTopic = new Map<string, InsightRow[]>();
  for (const row of faqs) {
    const topic = row.insight_subtype_display;
    if (!topic) continue;
    const list = faqsByTopic.get(topic) ?? [];
    list.push(row);
    faqsByTopic.set(topic, list);
  }
  const faqBattleCards: FaqBattleCard[] = [...faqsByTopic.entries()]
    .map(([topic, items]) => {
      const demos = new Set(items.map((r) => r.transcript_id)).size;
      const summaryCounts = new Map<string, number>();
      for (const r of items) {
        if (!r.summary) continue;
        summaryCounts.set(r.summary, (summaryCounts.get(r.summary) ?? 0) + 1);
      }
      const totalQ = [...summaryCounts.values()].reduce((a, b) => a + b, 0);
      const questions = [...summaryCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([text, count]) => ({
          text,
          count,
          pct: totalQ > 0 ? Math.round((count / totalQ) * 100) : 0,
        }));
      return { topic, demos, questions };
    })
    .sort((a, b) => b.demos - a.demos)
    .slice(0, 6);

  return {
    isEmpty: frictions.length === 0,
    kpis: { totalFricciones, affectedDeals, revenueAtRisk, frictionsPerDeal },
    topFrictionTypes,
    top2Friction,
    frictionSegment: stackBy(frictions, "insight_subtype_display", "segment", 12, 6),
    stageHeat: buildHeatMap(frictions, "insight_subtype_display", "deal_stage", 12, 8),
    industryHeat: buildHeatMap(frictions, "insight_subtype_display", "industry", 12, 8),
    aeRows,
    aeFrictionStack,
    faqBattleCards,
    hasFaqs: faqs.length > 0,
  };
}
