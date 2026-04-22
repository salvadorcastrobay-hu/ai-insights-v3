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

export type MigrationRow = {
  id: string;
  company: string;
  competitor: string;
  relationship: string;
  industry: string;
  country: string;
  segment: string;
  revenue: number;
  revenueDisplay: string;
  stage: string;
  owner: string;
  deal: string;
};

export type CompetitiveIntelligenceData = {
  isEmpty: boolean;
  kpis: {
    relevantCompetitors: number;
    dealsWithSignal: number;
    dealsPct: string;
    compRevenue: number;
  };
  competitorCounts: NameValue[];
  relationStack: StackData;
  countryHeat: HeatMapData;
  segmentStack: StackData;
  industryStack: StackData;
  stageStack: StackData;
  migrationRows: MigrationRow[];
};

const STRONG_RELATIONSHIPS_RAW = new Set([
  "currently_using",
  "evaluating",
  "migrating_from",
  "migrating_to",
  "replaced",
  "previously_used",
]);

const STRONG_RELATIONSHIPS_DISPLAY = new Set([
  "Usa actualmente",
  "Evaluando",
  "Migrando desde",
  "Uso anterior",
  "Descartado",
]);

export function buildCompetitiveIntelligenceData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): CompetitiveIntelligenceData {
  const filteredRows = applyFilters(rows, filters);
  const comp = filterByType(filteredRows, "competitive_signal").filter(
    (row) => !row.is_own_brand_competitor,
  );

  const relevantRows = comp.filter(
    (row) =>
      STRONG_RELATIONSHIPS_RAW.has(row.competitor_relationship ?? "") ||
      STRONG_RELATIONSHIPS_DISPLAY.has(row.competitor_relationship_display ?? ""),
  );

  const relevantCompetitors = distinctCount(relevantRows, "competitor_name");
  const dealsWithSignal = distinctCount(comp, "deal_id");
  const totalDeals = distinctCount(filteredRows, "deal_id");
  const dealsPct =
    totalDeals > 0 ? ((dealsWithSignal / totalDeals) * 100).toFixed(1) : "0.0";
  const compRevenue = uniqueDealsRevenue(comp);

  // migration rows: currently_using + migrating_from
  const migrating = comp.filter((row) => {
    const rel = row.competitor_relationship ?? "";
    const disp = row.competitor_relationship_display ?? "";
    return (
      rel === "migrating_from" ||
      rel === "currently_using" ||
      disp === "Migrando desde" ||
      disp === "Usa actualmente"
    );
  });
  // dedupe by deal_id + competitor_name and sort by revenue desc
  const migSeen = new Set<string>();
  const migrationRows: MigrationRow[] = [];
  for (const row of migrating) {
    const key = `${row.deal_id ?? ""}::${row.competitor_name ?? ""}`;
    if (migSeen.has(key)) continue;
    migSeen.add(key);
    migrationRows.push({
      id: row.id,
      company: row.company_name ?? "—",
      competitor: row.competitor_name ?? "—",
      relationship: row.competitor_relationship_display ?? row.competitor_relationship ?? "—",
      industry: row.industry ?? "—",
      country: row.country ?? "—",
      segment: row.segment ?? "—",
      revenue: row.amount ?? 0,
      revenueDisplay: row.amount != null ? formatCurrency(row.amount) : "—",
      stage: row.deal_stage ?? "—",
      owner: row.deal_owner ?? "—",
      deal: row.deal_name ?? "—",
    });
  }
  migrationRows.sort((a, b) => b.revenue - a.revenue);

  return {
    isEmpty: comp.length === 0,
    kpis: {
      relevantCompetitors,
      dealsWithSignal,
      dealsPct,
      compRevenue,
    },
    competitorCounts: groupDistinctTranscripts(comp, "competitor_name", 15),
    relationStack: stackBy(comp, "competitor_name", "competitor_relationship_display", 10, 6),
    countryHeat: buildHeatMap(comp, "competitor_name", "country", 10, 12),
    segmentStack: stackBy(comp, "competitor_name", "segment", 10, 6),
    industryStack: stackBy(comp, "competitor_name", "industry", 10, 5),
    stageStack: stackBy(comp, "competitor_name", "deal_stage", 10, 6),
    migrationRows,
  };
}
