import { applyFilters, type Filters } from "@/lib/data/filters";
import { filterByType, groupDistinctTranscripts } from "@/lib/data/dashboard-aggregations";
import { formatCurrency, uniqueDealsRevenue } from "@/lib/data/computations";
import type { InsightRow } from "@/lib/supabase/types";

export type NameValue = { name: string; value: number };

export type GapTableRow = {
  id: string;
  feature_display: string | null;
  gap_priority: string | null;
  gap_priority_display: string | null;
  hr_category_display: string | null;
  segment: string | null;
  company_name: string | null;
  country: string | null;
  module_display: string | null;
  deal_stage: string | null;
  deal_owner: string | null;
  gap_description: string | null;
  summary: string | null;
  isDealbreaker: boolean;
};

export type PriorityRow = {
  key: string;
  label: string; // with emoji
  detections: number;
  pct: string;
  revenueAtRisk: string;
  meaning: string;
};

export type SegmentPriorityRow = {
  segment: string;
  totalDeals: number;
  pcts: Record<string, number>;
};

export type FeatureSegmentCell = {
  feature: string;
  segment: string;
  pct: number;
  deals: number;
};

export type ModuleStatusRow = {
  name: string;
  value: number;
  pct: number;
};

export type ProductGapsDetailData = {
  kpis: {
    total: number;
    inTaxonomy: number;
    newFeatures: number;
    distinctDeals: number;
    perDemo: string;
  };
  topFeatures: Array<NameValue & { priorityTag: string }>;
  prioritySummary: PriorityRow[];
  segmentPriority: {
    rows: SegmentPriorityRow[];
    priorityLabels: string[];
  };
  featureSegmentHeatmap: {
    rowLabels: string[]; // features
    colLabels: string[]; // segments
    values: number[][]; // pct of segment
    absolute: number[][]; // absolute deals
  };
  moduleStatus: ModuleStatusRow[];
  existingModulePct: number;
  gapTypes: string[];
  priorities: string[];
  priorityLabelByKey: Record<string, string>;
  gapTableRows: GapTableRow[];
};

const PRIORITY_META: Record<string, { label: string; meaning: string; emoji: string }> = {
  must_have: {
    label: "Must Have",
    emoji: "⚠️",
    meaning: "El prospect indicó que es necesaria para cerrar o adoptar la plataforma",
  },
  nice_to_have: {
    label: "Nice to Have",
    emoji: "💡",
    meaning: "Sería útil pero no es bloqueante para la decisión",
  },
  dealbreaker: {
    label: "Dealbreaker",
    emoji: "🚫",
    meaning: "La ausencia fue mencionada como razón de no avanzar con Humand",
  },
};

function priorityLabel(key: string | null | undefined): string {
  if (!key) return "—";
  const meta = PRIORITY_META[key];
  return meta ? `${meta.emoji} ${meta.label}` : key;
}

export function buildProductGapsDetailData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): ProductGapsDetailData {
  const filteredRows = applyFilters(rows, filters);
  const gaps = filterByType(filteredRows, "product_gap");

  const gapTypes = [...new Set(gaps.map((row) => row.hr_category_display).filter(Boolean))] as string[];
  const priorities = [...new Set(gaps.map((row) => row.gap_priority).filter(Boolean))] as string[];

  // Top features with dominant priority tag
  const dominantPriorityByFeature = new Map<string, string>();
  {
    const counts = new Map<string, Map<string, number>>();
    for (const row of gaps) {
      if (!row.feature_display || !row.gap_priority) continue;
      const inner = counts.get(row.feature_display) ?? new Map<string, number>();
      inner.set(row.gap_priority, (inner.get(row.gap_priority) ?? 0) + 1);
      counts.set(row.feature_display, inner);
    }
    for (const [feature, inner] of counts) {
      let best = "";
      let bestCount = -1;
      for (const [k, c] of inner) {
        if (c > bestCount) {
          best = k;
          bestCount = c;
        }
      }
      dominantPriorityByFeature.set(feature, best);
    }
  }
  const topFeatures = groupDistinctTranscripts(gaps, "feature_display", 20).map((row) => {
    const dominant = dominantPriorityByFeature.get(row.name) ?? "";
    const tag = PRIORITY_META[dominant]?.emoji ?? "";
    return { ...row, priorityTag: tag };
  });

  // Priority summary
  const totalGaps = gaps.length;
  const prioritySummary: PriorityRow[] = Object.entries(PRIORITY_META).map(([key, meta]) => {
    const subset = gaps.filter((row) => row.gap_priority === key);
    const count = subset.length;
    const pct = totalGaps > 0 ? ((count / totalGaps) * 100).toFixed(1) : "0.0";
    const revenueAtRisk = uniqueDealsRevenue(subset);
    return {
      key,
      label: `${meta.emoji} ${meta.label}`,
      detections: count,
      pct: `${pct}%`,
      revenueAtRisk: formatCurrency(revenueAtRisk),
      meaning: meta.meaning,
    };
  });

  // Segment × Priority (%)
  const segments = [...new Set(gaps.map((r) => r.segment).filter(Boolean))] as string[];
  const priorityKeys = Object.keys(PRIORITY_META);
  const priorityLabels = priorityKeys.map((k) => `${PRIORITY_META[k].emoji} ${PRIORITY_META[k].label}`);
  const segmentPriorityRows: SegmentPriorityRow[] = segments.map((segment) => {
    const segGaps = gaps.filter((r) => r.segment === segment);
    const segTotal = segGaps.length;
    const totalDeals = new Set(segGaps.map((r) => r.deal_id).filter(Boolean)).size;
    const pcts: Record<string, number> = {};
    for (let i = 0; i < priorityKeys.length; i += 1) {
      const key = priorityKeys[i];
      const label = priorityLabels[i];
      const count = segGaps.filter((r) => r.gap_priority === key).length;
      pcts[label] = segTotal > 0 ? Math.round((count / segTotal) * 1000) / 10 : 0;
    }
    return { segment, totalDeals, pcts };
  });
  // Sort by total deals desc
  segmentPriorityRows.sort((a, b) => b.totalDeals - a.totalDeals);

  // Feature × Segment heatmap (top 15 features, % of segment deals)
  const topFeatureNames = topFeatures.slice(0, 15).map((r) => r.name);
  const segTotals = new Map<string, number>();
  for (const s of segments) {
    segTotals.set(
      s,
      new Set(gaps.filter((r) => r.segment === s).map((r) => r.deal_id).filter(Boolean)).size,
    );
  }
  const orderedSegments = [...segments].sort(
    (a, b) => (segTotals.get(b) ?? 0) - (segTotals.get(a) ?? 0),
  );
  const featureSegmentValues: number[][] = topFeatureNames.map((feature) =>
    orderedSegments.map((segment) => {
      const deals = new Set(
        gaps
          .filter((r) => r.feature_display === feature && r.segment === segment)
          .map((r) => r.deal_id)
          .filter(Boolean),
      ).size;
      const total = segTotals.get(segment) ?? 0;
      return total > 0 ? Math.round((deals / total) * 1000) / 10 : 0;
    }),
  );
  const featureSegmentAbs: number[][] = topFeatureNames.map((feature) =>
    orderedSegments.map((segment) => {
      return new Set(
        gaps
          .filter((r) => r.feature_display === feature && r.segment === segment)
          .map((r) => r.deal_id)
          .filter(Boolean),
      ).size;
    }),
  );

  // Module Status existing vs missing
  const moduleCounts = new Map<string, number>();
  for (const row of gaps) {
    if (!row.module_status) continue;
    const label =
      row.module_status === "existing" ? "Existente"
      : row.module_status === "missing" ? "Faltante"
      : row.module_status === "roadmap" ? "En roadmap"
      : row.module_status;
    moduleCounts.set(label, (moduleCounts.get(label) ?? 0) + 1);
  }
  const moduleTotal = [...moduleCounts.values()].reduce((a, b) => a + b, 0);
  const moduleStatus: ModuleStatusRow[] = [...moduleCounts.entries()]
    .map(([name, value]) => ({
      name,
      value,
      pct: moduleTotal > 0 ? Math.round((value / moduleTotal) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.value - a.value);
  const existingRow = moduleStatus.find((r) => /xist/i.test(r.name));
  const existingModulePct = existingRow?.pct ?? 0;

  const distinctDeals = new Set(gaps.map((r) => r.deal_id).filter(Boolean)).size;
  const perDemo = distinctDeals > 0 ? (totalGaps / distinctDeals).toFixed(1) : "0.0";

  const priorityLabelByKey: Record<string, string> = {};
  for (const key of priorityKeys) {
    priorityLabelByKey[key] = `${PRIORITY_META[key].emoji} ${PRIORITY_META[key].label}`;
  }

  const gapTableRows: GapTableRow[] = gaps.map((row) => ({
    id: row.id,
    feature_display: row.feature_display,
    gap_priority: row.gap_priority,
    gap_priority_display: priorityLabel(row.gap_priority),
    hr_category_display: row.hr_category_display,
    segment: row.segment,
    company_name: row.company_name,
    country: row.country,
    module_display: row.module_display,
    deal_stage: row.deal_stage,
    deal_owner: row.deal_owner,
    gap_description: row.gap_description,
    summary: row.summary,
    isDealbreaker: row.gap_priority === "dealbreaker",
  }));

  return {
    kpis: {
      total: totalGaps,
      inTaxonomy: new Set(gaps.filter((row) => row.feature_is_seed).map((r) => r.feature_display)).size,
      newFeatures: new Set(gaps.filter((row) => !row.feature_is_seed).map((r) => r.feature_display)).size,
      distinctDeals,
      perDemo,
    },
    topFeatures,
    prioritySummary,
    segmentPriority: { rows: segmentPriorityRows, priorityLabels },
    featureSegmentHeatmap: {
      rowLabels: topFeatureNames,
      colLabels: orderedSegments,
      values: featureSegmentValues,
      absolute: featureSegmentAbs,
    },
    moduleStatus,
    existingModulePct,
    gapTypes,
    priorities,
    priorityLabelByKey,
    gapTableRows,
  };
}
