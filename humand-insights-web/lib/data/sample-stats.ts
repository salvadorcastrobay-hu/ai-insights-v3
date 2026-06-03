import type { InsightRow } from "@/lib/supabase/types";

/**
 * Métricas de calidad/cobertura de un dataset filtrado. Una sola fuente de
 * verdad que alimenta:
 *   - Captions de MetricCards ("n=245 demos · 12% del período")
 *   - Footer de ChartCards (sample size)
 *   - DataQualityFooter (banner global por page)
 *
 * Se computa una vez por request en cada page Server Component.
 */
export type SampleStats = {
  /** distinct transcript_id en el set filtrado */
  uniqueCalls: number;
  /** distinct deal_id en el set filtrado */
  uniqueDeals: number;
  /** count de insights (filas, no únicos) */
  insightsCount: number;
  /** total de transcripts en la DB para el período del dataset */
  totalCalls: number;
  /** uniqueCalls / totalCalls * 100, 1 decimal */
  coveragePct: number;
  /** min/max call_date en el set filtrado (ISO YYYY-MM-DD) */
  periodStart: string | null;
  periodEnd: string | null;
  /** average confidence (0-1) de las filas con confidence definido */
  avgConfidence: number | null;
  /** % de filas con confidence ≥ 0.7 */
  highConfidencePct: number | null;
  /** ISO timestamp del compute (server-side) */
  generatedAt: string;
};

export function computeSampleStats(
  filteredRows: InsightRow[],
  totalTranscripts: number,
): SampleStats {
  const transcripts = new Set<string>();
  const deals = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;
  let confSum = 0;
  let confCount = 0;
  let highConfCount = 0;

  for (const row of filteredRows) {
    if (row.transcript_id) transcripts.add(row.transcript_id);
    if (row.deal_id) deals.add(row.deal_id);
    if (row.call_date) {
      if (minDate === null || row.call_date < minDate) minDate = row.call_date;
      if (maxDate === null || row.call_date > maxDate) maxDate = row.call_date;
    }
    if (typeof row.confidence === "number" && Number.isFinite(row.confidence)) {
      confSum += row.confidence;
      confCount += 1;
      if (row.confidence >= 0.7) highConfCount += 1;
    }
  }

  const uniqueCalls = transcripts.size;
  const coveragePct =
    totalTranscripts > 0 ? Math.round((uniqueCalls / totalTranscripts) * 1000) / 10 : 0;

  return {
    uniqueCalls,
    uniqueDeals: deals.size,
    insightsCount: filteredRows.length,
    totalCalls: totalTranscripts,
    coveragePct,
    periodStart: minDate,
    periodEnd: maxDate,
    avgConfidence: confCount > 0 ? confSum / confCount : null,
    highConfidencePct: confCount > 0 ? Math.round((highConfCount / confCount) * 1000) / 10 : null,
    generatedAt: new Date().toISOString(),
  };
}

/** Format helper para captions. "n=245 demos · 12% del período". */
export function formatCoverageCaption(stats: SampleStats): string {
  if (stats.uniqueCalls === 0) return "Sin datos en el período/filtro";
  const period =
    stats.totalCalls > 0
      ? ` · ${stats.coveragePct.toFixed(1)}% del período`
      : "";
  return `n=${stats.uniqueCalls} demos${period}`;
}
