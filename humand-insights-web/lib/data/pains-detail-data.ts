import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  filterByType,
  groupDistinctTranscripts,
} from "@/lib/data/dashboard-aggregations";
import {
  FUNNEL_PHASE_DISPLAY,
  FUNNEL_PHASE_ORDER,
  getFunnelPhase,
  type FunnelPhase,
} from "@/lib/data/normalizers";
import type { InsightRow } from "@/lib/supabase/types";

export type NameValue = { name: string; value: number };
export type HeatMapData = {
  rowLabels: string[];
  colLabels: string[];
  values: number[][];
};

export type PainTableRow = {
  id: string;
  insight_subtype_display: string;
  pain_theme: string | null;
  module_display: string | null;
  segment: string | null;
  company_name: string | null;
  summary: string;
  verbatim_quote: string | null;
};

export type PainByPhaseRow = {
  pain: string;
  pre_sale: number;
  closed: number;
  post_sale: number;
  total: number;
};

export type PainsDetailData = {
  kpis: {
    total: number;
    generales: number;
    vinculados: number;
    withPhase: number;
  };
  byModule: NameValue[];
  themeStatusHeat: HeatMapData;
  phaseSummary: NameValue[];
  topPainsByPhase: PainByPhaseRow[];
  themes: string[];
  modules: string[];
  painTableRows: PainTableRow[];
};

export function buildPainsDetailData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): PainsDetailData {
  const filteredRows = applyFilters(rows, filters);
  const pains = filterByType(filteredRows, "pain");

  const themes = [...new Set(pains.map((row) => row.pain_theme).filter(Boolean))] as string[];
  const modules = [...new Set(pains.map((row) => row.module_display).filter(Boolean))] as string[];

  const painTableRows: PainTableRow[] = pains.map((row) => ({
    id: row.id,
    insight_subtype_display: row.insight_subtype_display,
    pain_theme: row.pain_theme,
    module_display: row.module_display,
    segment: row.segment,
    company_name: row.company_name,
    summary: row.summary,
    verbatim_quote: row.verbatim_quote,
  }));

  // ─── Funnel phase aggregations ────────────────────────────────────────
  // Cuenta deals únicos por phase para que un deal con 10 pains no infle el total.
  const phaseDeals: Record<FunnelPhase, Set<string>> = {
    pre_sale: new Set(),
    closed: new Set(),
    post_sale: new Set(),
  };
  // Pain × phase: deals únicos por pain por phase
  const painPhaseDeals = new Map<string, Record<FunnelPhase, Set<string>>>();

  for (const row of pains) {
    const phase = getFunnelPhase(row.deal_stage);
    if (!phase) continue;
    const dealKey = row.deal_id ?? row.transcript_id;
    if (!dealKey) continue;
    phaseDeals[phase].add(dealKey);

    const painName = row.insight_subtype_display;
    if (!painName) continue;
    if (!painPhaseDeals.has(painName)) {
      painPhaseDeals.set(painName, { pre_sale: new Set(), closed: new Set(), post_sale: new Set() });
    }
    painPhaseDeals.get(painName)![phase].add(dealKey);
  }

  const phaseSummary: NameValue[] = FUNNEL_PHASE_ORDER.map((phase) => ({
    name: FUNNEL_PHASE_DISPLAY[phase],
    value: phaseDeals[phase].size,
  }));

  const topPainsByPhase: PainByPhaseRow[] = [...painPhaseDeals.entries()]
    .map(([pain, byPhase]) => {
      const pre_sale = byPhase.pre_sale.size;
      const closed = byPhase.closed.size;
      const post_sale = byPhase.post_sale.size;
      return { pain, pre_sale, closed, post_sale, total: pre_sale + closed + post_sale };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  const withPhase =
    phaseDeals.pre_sale.size + phaseDeals.closed.size + phaseDeals.post_sale.size;

  return {
    kpis: {
      total: pains.length,
      generales: pains.filter((row) => !row.module_display).length,
      vinculados: pains.filter((row) => row.module_display).length,
      withPhase,
    },
    byModule: groupDistinctTranscripts(pains, "module_display", 12),
    themeStatusHeat: buildHeatMap(pains, "pain_theme", "module_status", 12, 4),
    phaseSummary,
    topPainsByPhase,
    themes,
    modules,
    painTableRows,
  };
}
