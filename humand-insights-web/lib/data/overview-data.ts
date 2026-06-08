import { EMPTY_FILTERS, type Filters } from "@/lib/data/filters";
import {
  rpcGroupDistinct,
  rpcGroupWithPct,
  rpcSampleStats,
  rpcValidatedDeals,
  rpcWonLostPains,
  type NameValue,
  type NameValuePct,
} from "@/lib/data/rpc";

/** Win-rate de un pain: de los deals cerrados donde apareció, % que ganamos. */
export type WonLostPain = {
  name: string;
  winRate: number; // won / (won + lost) * 100
  closed: number; // deals cerrados (won + lost) donde apareció el pain
  won: number;
  lost: number;
};

/** Cambio en % de demos (share) de esta semana vs. el promedio del baseline. */
export type ShareMover = {
  name: string;
  thisWeekPct: number;
  baselinePct: number;
  deltaPts: number; // thisWeekPct - baselinePct (puntos porcentuales)
};

export type Activity = {
  demosThisWeek: number;
  avgWeeklyDemos: number;
  /** % vs. promedio semanal. null si no hay baseline. */
  deltaPct: number | null;
  dealsThisWeek: number;
  avgWeeklyDeals: number;
  inboundDealsThisWeek: number;
  validatedDealsThisWeek: number;
};

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
    baselineWeeks: number;
    activity: Activity;
    gained: ShareMover[]; // pains que ganaron relevancia (share ↑)
    lost: ShareMover[]; // pains que perdieron relevancia (share ↓)
    snapshotPains: NameValuePct[]; // top pains de ESTA semana, en %
    topQuestions: NameValue[]; // top preguntas de esta semana
    competitorTop: NameValue[]; // competidores más mencionados esta semana
    competitorRisers: ShareMover[]; // competidores cuyo share de menciones creció
  };
  topPains: NameValuePct[];
  topFaqs: NameValue[];
  topIndustries: NameValue[];
  topSegments: NameValue[];
  wonLostPains: WonLostPain[];
  /** win-rate general (deals cerrados ganados / total cerrados) como baseline. */
  winRateBaseline: number;
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

function withWindow(filters: Filters, start: string, end: string): Filters {
  return { ...filters, date_start: start, date_end: end };
}

/**
 * Share movers: compara el % de demos de cada label esta semana vs. su %
 * promedio en el baseline. Normalizado → no lo afecta que el volumen total
 * suba o baje. minThisWeek filtra ruido de cola larga (+1/+2 sin sentido).
 */
function shareMovers(
  current: NameValue[],
  baseline: NameValue[],
  curTotal: number,
  baseTotal: number,
  minThisWeek: number,
): { gained: ShareMover[]; lost: ShareMover[] } {
  const baseMap = new Map(baseline.map((b) => [b.name, b.value]));
  const movers: ShareMover[] = current
    .filter((c) => c.value >= minThisWeek)
    .map((c) => {
      const thisWeekPct = curTotal > 0 ? (c.value / curTotal) * 100 : 0;
      const baselinePct = baseTotal > 0 ? ((baseMap.get(c.name) ?? 0) / baseTotal) * 100 : 0;
      return {
        name: c.name,
        thisWeekPct: Math.round(thisWeekPct * 10) / 10,
        baselinePct: Math.round(baselinePct * 10) / 10,
        deltaPts: Math.round((thisWeekPct - baselinePct) * 10) / 10,
      };
    });
  const gained = movers
    .filter((m) => m.deltaPts > 0)
    .sort((a, b) => b.deltaPts - a.deltaPts)
    .slice(0, 3);
  const lost = movers
    .filter((m) => m.deltaPts < 0)
    .sort((a, b) => a.deltaPts - b.deltaPts)
    .slice(0, 3);
  return { gained, lost };
}

export async function buildOverviewData(filters: Filters): Promise<OverviewData> {
  const WINDOW = 7;
  const BASELINE_WEEKS = 8;
  const today = isoDaysAgo(0);
  const curStart = isoDaysAgo(WINDOW - 1); // últimos 7 días (incluye hoy)
  // Baseline = las 8 semanas inmediatamente previas a esta semana.
  const baseEnd = isoDaysAgo(WINDOW);
  const baseStart = isoDaysAgo(WINDOW + WINDOW * BASELINE_WEEKS - 1);

  const curWin = withWindow(filters, curStart, today);
  const baseWin = withWindow(filters, baseStart, baseEnd);

  const [
    stats,
    topPains,
    topFaqs,
    topIndustries,
    topSegments,
    curStats,
    baseStats,
    curInboundStats,
    curValidated,
    curPains,
    basePains,
    curQuestions,
    curComp,
    baseComp,
    wonLostRaw,
  ] = await Promise.all([
    rpcSampleStats(filters),
    rpcGroupWithPct(filters, "insight_subtype_display", 0, { scope: "pain", n: 5 }),
    rpcGroupDistinct(filters, "insight_subtype_display", { scope: "faq", n: 5 }),
    rpcGroupDistinct(filters, "industry", { n: 5 }),
    rpcGroupDistinct(filters, "segment", { n: 5 }),
    rpcSampleStats(curWin),
    rpcSampleStats(baseWin),
    rpcSampleStats({ ...curWin, channels: ["Inbound"] }),
    rpcValidatedDeals(curWin),
    rpcGroupDistinct(curWin, "insight_subtype_display", { scope: "pain", n: 60 }),
    rpcGroupDistinct(baseWin, "insight_subtype_display", { scope: "pain", n: 200 }),
    rpcGroupDistinct(curWin, "insight_subtype_display", { scope: "faq", n: 5 }),
    rpcGroupDistinct(curWin, "competitor_name", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 60,
    }),
    rpcGroupDistinct(baseWin, "competitor_name", {
      scope: "competitive_signal",
      excludeOwnBrand: true,
      n: 200,
    }),
    rpcWonLostPains(filters, 15),
  ]);

  // Win-rate por pain: de los deals cerrados (won+lost) donde apareció el pain,
  // qué % ganamos. Se compara contra el win-rate general (baseline).
  const wlWonTotal = wonLostRaw[0]?.won_total ?? 0;
  const wlLostTotal = wonLostRaw[0]?.lost_total ?? 0;
  const winRateBaseline =
    wlWonTotal + wlLostTotal > 0
      ? Math.round((wlWonTotal / (wlWonTotal + wlLostTotal)) * 1000) / 10
      : 0;
  const wonLostPains: WonLostPain[] = wonLostRaw
    .map((r) => {
      const closed = r.won_demos + r.lost_demos;
      return {
        name: r.pain,
        won: r.won_demos,
        lost: r.lost_demos,
        closed,
        winRate: closed > 0 ? Math.round((r.won_demos / closed) * 1000) / 10 : 0,
      };
    })
    .filter((p) => p.closed >= 10) // evita ruido de pains con pocos deals cerrados
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 8);

  // top pains all-time con pct sobre demos del set
  const callsBasis = stats?.unique_calls ?? 0;
  const topPainsPct: NameValuePct[] = topPains.map((p) => ({
    name: p.name,
    value: p.value,
    pct: callsBasis > 0 ? Math.round((p.value / callsBasis) * 1000) / 10 : 0,
  }));

  const curTotal = curStats?.unique_calls ?? 0;
  const baseTotal = baseStats?.unique_calls ?? 0;

  const { gained, lost } = shareMovers(curPains, basePains, curTotal, baseTotal, 3);

  // snapshot: top pains de esta semana en % de demos de la semana
  const snapshotPains: NameValuePct[] = curPains
    .slice(0, 5)
    .map((p) => ({
      name: p.name,
      value: p.value,
      pct: curTotal > 0 ? Math.round((p.value / curTotal) * 1000) / 10 : 0,
    }));

  // competidores en alza: share de menciones esta semana vs baseline.
  const NON_COMPETITORS = new Set(["fathom", "prode", "humand"]);
  const compClean = (rows: NameValue[]) =>
    rows.filter((c) => !NON_COMPETITORS.has(c.name.toLowerCase().trim()));
  const { gained: competitorRisers } = shareMovers(
    compClean(curComp),
    compClean(baseComp),
    curTotal,
    baseTotal,
    2,
  );
  const competitorTop = compClean(curComp).slice(0, 5);

  const avgWeeklyDemos = baseTotal / BASELINE_WEEKS;
  const avgWeeklyDeals = (baseStats?.unique_deals ?? 0) / BASELINE_WEEKS;

  return {
    kpis: {
      uniqueCalls: stats?.unique_calls ?? 0,
      uniqueDeals: stats?.unique_deals ?? 0,
      insightsCount: stats?.insights_count ?? 0,
      coveragePct: 0,
      avgConfidence: stats?.avg_confidence ?? null,
      highConfidencePct: stats?.high_confidence_pct ?? null,
      periodStart: stats?.period_start ?? null,
      periodEnd: stats?.period_end ?? null,
    },
    recap: {
      windowDays: WINDOW,
      baselineWeeks: BASELINE_WEEKS,
      activity: {
        demosThisWeek: curTotal,
        avgWeeklyDemos: Math.round(avgWeeklyDemos),
        deltaPct:
          avgWeeklyDemos > 0
            ? Math.round(((curTotal - avgWeeklyDemos) / avgWeeklyDemos) * 100)
            : null,
        dealsThisWeek: curStats?.unique_deals ?? 0,
        avgWeeklyDeals: Math.round(avgWeeklyDeals),
        inboundDealsThisWeek: curInboundStats?.unique_deals ?? 0,
        validatedDealsThisWeek: curValidated ?? 0,
      },
      gained,
      lost,
      snapshotPains,
      topQuestions: curQuestions,
      competitorTop,
      competitorRisers,
    },
    topPains: topPainsPct,
    topFaqs,
    topIndustries,
    topSegments,
    wonLostPains,
    winRateBaseline,
  };
}

export { EMPTY_FILTERS };
