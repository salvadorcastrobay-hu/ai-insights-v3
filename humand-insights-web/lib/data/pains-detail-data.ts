import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  filterByType,
  groupDistinctTranscripts,
} from "@/lib/data/dashboard-aggregations";
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

export type PainsDetailData = {
  kpis: {
    total: number;
    generales: number;
    vinculados: number;
  };
  byModule: NameValue[];
  themeStatusHeat: HeatMapData;
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

  return {
    kpis: {
      total: pains.length,
      generales: pains.filter((row) => !row.module_display).length,
      vinculados: pains.filter((row) => row.module_display).length,
    },
    byModule: groupDistinctTranscripts(pains, "module_display", 12),
    themeStatusHeat: buildHeatMap(pains, "pain_theme", "module_status", 12, 4),
    themes,
    modules,
    painTableRows,
  };
}
