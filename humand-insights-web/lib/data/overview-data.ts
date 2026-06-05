import { EMPTY_FILTERS, type Filters } from "@/lib/data/filters";
import {
  rpcGroupDistinct,
  rpcGroupWithPct,
  rpcSampleStats,
  type NameValue,
  type NameValuePct,
} from "@/lib/data/rpc";

export type WeekDelta = {
  current: number;
  previous: number;
  /** % cambio vs semana previa, redondeado. null si previous=0. */
  deltaPct: number | null;
};

export type RecapMover = { name: string; delta: number };

export type OverviewData = {
  kpis: {
    uniqueCalls: number;
    uniqueDeals: number;
    insightsCount: number;
    coveragePct: number;
    avgConfidence: number | null;
    highConfidencePct: number | null;
    periodStart: string | null;
    periodEnd: string | null;
  };
  recap: {
    windowDays: number;
    demos: WeekDelta;
    deals: WeekDelta;
    risers: RecapMover[]; // pains que más subieron
    fallers: RecapMover[]; // pains que más bajaron
    newCompetitors: string[]; // mencionados esta semana, no la previa
  };
  topPains: NameValuePct[];
  topFaqs: NameValue[];
  topIndustries: NameValue[];
  topSegments: NameValue[];
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function withWindow(filters: Filters, start: string, end: string): Filters {
  // Recap usa su propia ventana de fechas pero hereda el resto de filtros
  // (región, segmento, etc.).
  return { ...filters, date_start: start, date_end: end };
}

function buildMoversAndNew(
  current: NameValue[],
  previous: NameValue[],
): { risers: RecapMover[]; fallers: RecapMover[] } {
  const prevMap = new Map(previous.map((p) => [p.name, p.value]));
  const moves: RecapMover[] = current.map((c) => ({
    name: c.name,
    delta: c.value - (prevMap.get(c.name) ?? 0),
  }));
  const risers = moves
    .filter((m) => m.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  const fallers = moves
    .filter((m) => m.delta < 0)
    .sort((a, b) => a.delta - b.delta)
    .slice(0, 3);
  return { risers, fallers };
}

/**
 * Arma el Overview 100% desde RPCs (sin loadInsights → sin cargar 150K filas
 * a Node). Respeta los filtros globales. El recap semanal usa ventanas de
 * fecha propias (últimos 7 días rodantes vs. los 7 previos) heredando el
 * resto de los filtros.
 */
export async function buildOverviewData(filters: Filters): Promise<OverviewData> {
  const WINDOW = 7;
  const today = isoDaysAgo(0);
  const curStart = isoDaysAgo(WINDOW - 1); // últimos 7 días (incluye hoy)
  const prevEnd = isoDaysAgo(WINDOW);
  const prevStart = isoDaysAgo(WINDOW * 2 - 1);

  const curWin = withWindow(filters, curStart, today);
  const prevWin = withWindow(filters, prevStart, prevEnd);

  const [
    stats,
    topPains,
    topFaqs,
    topIndustries,
    topSegments,
    curStats,
    prevStats,
    curPains,
    prevPains,
    curComp,
    prevComp,
  ] = await Promise.all([
    rpcSampleStats(filters),
    rpcGroupWithPct(filters, "insight_subtype_display", 0, { scope: "pain", n: 5 }),
    rpcGroupDistinct(filters, "insight_subtype_display", { scope: "faq", n: 5 }),
    rpcGroupDistinct(filters, "industry", { n: 5 }),
    rpcGroupDistinct(filters, "segment", { n: 5 }),
    rpcSampleStats(curWin),
    rpcSampleStats(prevWin),
    rpcGroupDistinct(curWin, "insight_subtype_display", { scope: "pain", n: 50 }),
    rpcGroupDistinct(prevWin, "insight_subtype_display", { scope: "pain", n: 50 }),
    rpcGroupDistinct(curWin, "competitor_name", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 50,
    }),
    rpcGroupDistinct(prevWin, "competitor_name", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 50,
    }),
  ]);

  // top pains con pct sobre las demos únicas del set (no totalTranscripts) —
  // matchea la semántica de painsWithPct cuando el % es "de las demos vistas".
  const callsBasis = stats?.unique_calls ?? 0;
  const topPainsPct: NameValuePct[] = topPains.map((p) => ({
    name: p.name,
    value: p.value,
    pct: callsBasis > 0 ? Math.round((p.value / callsBasis) * 1000) / 10 : 0,
  }));

  const { risers, fallers } = buildMoversAndNew(curPains, prevPains);

  const prevCompSet = new Set(prevComp.map((c) => c.name));
  const newCompetitors = curComp
    .filter((c) => !prevCompSet.has(c.name))
    .slice(0, 5)
    .map((c) => c.name);

  function delta(cur: number, prev: number): WeekDelta {
    return {
      current: cur,
      previous: prev,
      deltaPct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null,
    };
  }

  return {
    kpis: {
      uniqueCalls: stats?.unique_calls ?? 0,
      uniqueDeals: stats?.unique_deals ?? 0,
      insightsCount: stats?.insights_count ?? 0,
      coveragePct: 0, // cobertura requiere totalTranscripts; lo setea la page
      avgConfidence: stats?.avg_confidence ?? null,
      highConfidencePct: stats?.high_confidence_pct ?? null,
      periodStart: stats?.period_start ?? null,
      periodEnd: stats?.period_end ?? null,
    },
    recap: {
      windowDays: WINDOW,
      demos: delta(curStats?.unique_calls ?? 0, prevStats?.unique_calls ?? 0),
      deals: delta(curStats?.unique_deals ?? 0, prevStats?.unique_deals ?? 0),
      risers,
      fallers,
      newCompetitors,
    },
    topPains: topPainsPct,
    topFaqs,
    topIndustries,
    topSegments,
  };
}

export { EMPTY_FILTERS };
