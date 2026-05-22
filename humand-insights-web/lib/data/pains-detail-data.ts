import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  filterByType,
  groupDistinctTranscripts,
} from "@/lib/data/dashboard-aggregations";
import { getFunnelPhase } from "@/lib/data/normalizers";
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

export type PhaseSummary = {
  pre_sale: number;
  closed: number;
  post_sale: number;
};

export type PainsDetailData = {
  kpis: {
    total: number;
    generales: number;
    vinculados: number;
  };
  byModule: NameValue[];
  themeStatusHeat: HeatMapData;
  phaseSummary: PhaseSummary;
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

  // ─── Funnel phase aggregation (deals únicos por phase) ───────────────
  const phasePreSale = new Set<string>();
  const phaseClosed = new Set<string>();
  const phasePostSale = new Set<string>();
  for (const row of pains) {
    const phase = getFunnelPhase(row.deal_stage);
    if (!phase) continue;
    const dealKey = row.deal_id || row.transcript_id;
    if (!dealKey) continue;
    if (phase === "pre_sale") phasePreSale.add(dealKey);
    else if (phase === "closed") phaseClosed.add(dealKey);
    else phasePostSale.add(dealKey);
  }
  const phaseSummary: PhaseSummary = {
    pre_sale: phasePreSale.size,
    closed: phaseClosed.size,
    post_sale: phasePostSale.size,
  };

  return {
    kpis: {
      total: pains.length,
      generales: pains.filter((row) => !row.module_display).length,
      vinculados: pains.filter((row) => row.module_display).length,
    },
    byModule: groupDistinctTranscripts(pains, "module_display", 12),
    themeStatusHeat: buildHeatMap(pains, "pain_theme", "module_status", 12, 4),
    phaseSummary,
    themes,
    modules,
    painTableRows,
  };
}
