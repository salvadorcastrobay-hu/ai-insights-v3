import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  distinctCount,
  filterByType,
  groupDistinctTranscripts,
  stackBy,
} from "@/lib/data/dashboard-aggregations";
import { formatCurrency, uniqueDealsRevenue } from "@/lib/data/computations";
import {
  rpcCompetitiveKpis,
  rpcGroupDistinct,
  rpcHeatmap,
  rpcMigrationRows,
  rpcStack,
} from "@/lib/data/rpc";
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
  // Cuenta competidores nombrados en TODOS los tipos de insight (no solo
  // competitive_signal): un incumbente citado en un pain / friction / gap
  // también suma. Las filas sin relación competitiva explícita se muestran
  // bajo "Mencionado"; el filtro de relaciones fuertes (relevantRows) las
  // excluye naturalmente.
  const comp = filteredRows
    .filter(
      (row) =>
        row.competitor_name &&
        row.competitor_name !== "Humand" &&
        !row.is_own_brand_competitor,
    )
    .map((row) => ({
      ...row,
      competitor_relationship_display:
        row.competitor_relationship_display ?? "Mencionado",
    }));

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

/**
 * Versión RPC-native: arma CompetitiveIntelligenceData desde la MV (sin
 * loadInsights). Mismo shape que buildCompetitiveIntelligenceData.
 */
export async function buildCompetitiveIntelligenceDataRpc(
  filters: Filters,
): Promise<CompetitiveIntelligenceData> {
  const [
    competitorCounts,
    relationStack,
    countryHeat,
    segmentStack,
    industryStack,
    stageStack,
    kpis,
    migRows,
  ] = await Promise.all([
    rpcGroupDistinct(filters, "competitor_name", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 15,
    }),
    rpcStack(filters, "competitor_name", "competitor_relationship_display", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 10,
      topStackN: 6,
    }),
    rpcHeatmap(filters, "competitor_name", "country", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      nRows: 10,
      nCols: 12,
    }),
    rpcStack(filters, "competitor_name", "segment", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 10,
      topStackN: 6,
    }),
    rpcStack(filters, "competitor_name", "industry", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 10,
      topStackN: 5,
    }),
    rpcStack(filters, "competitor_name", "deal_stage", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 10,
      topStackN: 6,
    }),
    rpcCompetitiveKpis(filters),
    rpcMigrationRows(filters),
  ]);

  const migrationRows: MigrationRow[] = migRows.map((r) => ({
    id: r.id,
    company: r.company,
    competitor: r.competitor,
    relationship: r.relationship,
    industry: r.industry,
    country: r.country,
    segment: r.segment,
    revenue: r.revenue,
    revenueDisplay: r.revenue ? formatCurrency(r.revenue) : "—",
    stage: r.stage,
    owner: r.owner,
    deal: r.deal,
  }));

  return {
    isEmpty: competitorCounts.length === 0,
    kpis: {
      relevantCompetitors: kpis.relevant_competitors,
      dealsWithSignal: kpis.deals_with_signal,
      dealsPct:
        kpis.total_deals > 0
          ? ((kpis.deals_with_signal / kpis.total_deals) * 100).toFixed(1)
          : "0.0",
      compRevenue: kpis.comp_revenue,
    },
    competitorCounts,
    relationStack,
    countryHeat,
    segmentStack,
    industryStack,
    stageStack,
    migrationRows,
  };
}
