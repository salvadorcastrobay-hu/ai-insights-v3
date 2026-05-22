import {
  buildHeatMap,
  filterByType,
  groupDistinctTranscripts,
} from "@/lib/data/dashboard-aggregations";
import { getDealOutcome, getFunnelPhase } from "@/lib/data/normalizers";
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

export type PainByOutcomeRow = {
  pain: string;
  won: number;
  lost: number;
  closed_total: number;
  win_rate: number; // 0-1
  lost_rate: number; // 0-1
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
  painsByOutcome: PainByOutcomeRow[];
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

  // Funnel phase + outcome: deals únicos por (pain, phase) y (pain, won/lost).
  // Una sola pasada O(n) sobre pains.
  const phasePreSale = new Set<string>();
  const phaseClosed = new Set<string>();
  const phasePostSale = new Set<string>();
  const painPhaseDeals = new Map<string, { pre: Set<string>; cl: Set<string>; po: Set<string> }>();
  const painOutcomeDeals = new Map<string, { won: Set<string>; lost: Set<string> }>();

  for (const row of pains) {
    const dealKey = row.deal_id || row.transcript_id;
    if (!dealKey) continue;
    const painName = row.insight_subtype_display;

    // Phase bucket
    const phase = getFunnelPhase(row.deal_stage);
    if (phase) {
      if (phase === "pre_sale") phasePreSale.add(dealKey);
      else if (phase === "closed") phaseClosed.add(dealKey);
      else phasePostSale.add(dealKey);

      if (painName) {
        let bucket = painPhaseDeals.get(painName);
        if (!bucket) {
          bucket = { pre: new Set<string>(), cl: new Set<string>(), po: new Set<string>() };
          painPhaseDeals.set(painName, bucket);
        }
        if (phase === "pre_sale") bucket.pre.add(dealKey);
        else if (phase === "closed") bucket.cl.add(dealKey);
        else bucket.po.add(dealKey);
      }
    }

    // Outcome bucket (won/lost) — independiente de phase porque incluye post-sale churned
    const outcome = getDealOutcome(row.deal_stage);
    if (outcome && painName) {
      let bucket = painOutcomeDeals.get(painName);
      if (!bucket) {
        bucket = { won: new Set<string>(), lost: new Set<string>() };
        painOutcomeDeals.set(painName, bucket);
      }
      bucket[outcome].add(dealKey);
    }
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

  // Min sample size para que las rates no sean ruido (≥5 deals cerrados).
  const MIN_CLOSED = 5;
  const painsByOutcome: PainByOutcomeRow[] = Array.from(painOutcomeDeals.entries())
    .map(([pain, b]) => {
      const won = b.won.size;
      const lost = b.lost.size;
      const closed_total = won + lost;
      const win_rate = closed_total > 0 ? won / closed_total : 0;
      const lost_rate = closed_total > 0 ? lost / closed_total : 0;
      return { pain, won, lost, closed_total, win_rate, lost_rate };
    })
    .filter((r) => r.closed_total >= MIN_CLOSED)
    .sort((a, b) => b.closed_total - a.closed_total)
    .slice(0, 15);

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
    painsByOutcome,
    themes,
    modules,
    painTableRows,
  };
}
