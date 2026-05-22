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
  };
  byModule: NameValue[];
  themeStatusHeat: HeatMapData;
  phaseSummary: PhaseSummary;
  topPainsByPhase: PainByPhaseRow[];
  themes: string[];
  modules: string[];
  painTableRows: PainTableRow[];
};

// Acepta rows YA FILTRADOS (page route llama applyFilters una sola vez y
// pasa el resultado acá + a filteredRows del cliente). Evita duplicar memoria.
export function buildPainsDetailData(
  filteredRows: InsightRow[],
  _totalTranscripts: number,
): PainsDetailData {
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

  // Funnel phase: deals únicos por phase + por (pain, phase). O(n) pass.
  const phasePreSale = new Set<string>();
  const phaseClosed = new Set<string>();
  const phasePostSale = new Set<string>();
  const painPhaseDeals = new Map<string, { pre: Set<string>; cl: Set<string>; po: Set<string> }>();

  for (const row of pains) {
    const phase = getFunnelPhase(row.deal_stage);
    if (!phase) continue;
    const dealKey = row.deal_id || row.transcript_id;
    if (!dealKey) continue;

    if (phase === "pre_sale") phasePreSale.add(dealKey);
    else if (phase === "closed") phaseClosed.add(dealKey);
    else phasePostSale.add(dealKey);

    const painName = row.insight_subtype_display;
    if (!painName) continue;
    let bucket = painPhaseDeals.get(painName);
    if (!bucket) {
      bucket = { pre: new Set<string>(), cl: new Set<string>(), po: new Set<string>() };
      painPhaseDeals.set(painName, bucket);
    }
    if (phase === "pre_sale") bucket.pre.add(dealKey);
    else if (phase === "closed") bucket.cl.add(dealKey);
    else bucket.po.add(dealKey);
  }

  const phaseSummary: PhaseSummary = {
    pre_sale: phasePreSale.size,
    closed: phaseClosed.size,
    post_sale: phasePostSale.size,
  };

  const topPainsByPhase: PainByPhaseRow[] = Array.from(painPhaseDeals.entries())
    .map(([pain, b]) => {
      const pre_sale = b.pre.size;
      const closed = b.cl.size;
      const post_sale = b.po.size;
      return { pain, pre_sale, closed, post_sale, total: pre_sale + closed + post_sale };
    })
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 12);

  return {
    kpis: {
      total: pains.length,
      generales: pains.filter((row) => !row.module_display).length,
      vinculados: pains.filter((row) => row.module_display).length,
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
