import { applyFilters, type Filters } from "@/lib/data/filters";
import {
  buildHeatMap,
  filterByType,
  stackBy,
} from "@/lib/data/dashboard-aggregations";
import { formatCurrency } from "@/lib/data/computations";
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

export type RegionPipelineKpis = {
  topRegion: string;
  topRegionPct: string;
  totalPipeline: string;
  highestAvgRegion: string;
  highestAvgValue: string;
  highestAvgDeals: number;
};

export type PipelineCell = {
  segment: string;
  region: string;
  revenue: number;
  deals: number;
  avgTicket: number;
  display: string;
};

export type CompetitorCountryRow = {
  country: string;
  competitor: string;
  mentions: number;
  topRelationship: string;
};

export type PainRegionPctRow = {
  pain: string;
  region: string;
  pct: number;
  deals: number;
};

export type RegionalGtmData = {
  countryInsight: StackData;
  painRegionHeatPct: {
    rowLabels: string[];
    colLabels: string[];
    values: number[][]; // pct values
    absolute: number[][]; // deals count for tooltip
  };
  moduleRegionHeat: HeatMapData;
  pipelineKpis: RegionPipelineKpis;
  pipelineGrid: {
    rowLabels: string[]; // segments
    colLabels: string[]; // regions
    cells: PipelineCell[][];
  };
  competitorsByCountry: CompetitorCountryRow[];
  competitorCountries: string[];
};

function formatRegionPct(pct: number): string {
  return `${pct.toFixed(1)}%`;
}

export function buildRegionalGtmData(
  rows: InsightRow[],
  _totalTranscripts: number,
  filters: Filters,
): RegionalGtmData {
  const filteredRows = applyFilters(rows, filters);
  const pains = filterByType(filteredRows, "pain");
  const comp = filterByType(filteredRows, "competitive_signal").filter(
    (row) => !row.is_own_brand_competitor,
  );

  // Pipeline KPIs + seg×region grid
  // dedupe by deal_id, require region
  const dealMap = new Map<string, InsightRow>();
  for (const row of filteredRows) {
    if (!row.deal_id || !row.region) continue;
    if (!dealMap.has(row.deal_id)) dealMap.set(row.deal_id, row);
  }
  const uniqueDeals = [...dealMap.values()];

  const regionTotals = new Map<string, { revenue: number; deals: number }>();
  for (const row of uniqueDeals) {
    if (!row.region) continue;
    const bucket = regionTotals.get(row.region) ?? { revenue: 0, deals: 0 };
    bucket.revenue += row.amount ?? 0;
    bucket.deals += 1;
    regionTotals.set(row.region, bucket);
  }
  const totalPipeline = [...regionTotals.values()].reduce((a, b) => a + b.revenue, 0);
  let topRegion = "—";
  let topRegionPct = 0;
  let highestAvgRegion = "—";
  let highestAvgValue = 0;
  let highestAvgDeals = 0;
  for (const [region, r] of regionTotals) {
    const pct = totalPipeline > 0 ? (r.revenue / totalPipeline) * 100 : 0;
    if (pct > topRegionPct) {
      topRegionPct = pct;
      topRegion = region;
    }
    const avg = r.deals > 0 ? r.revenue / r.deals : 0;
    if (avg > highestAvgValue) {
      highestAvgValue = avg;
      highestAvgRegion = region;
      highestAvgDeals = r.deals;
    }
  }

  // seg × region pipeline grid
  const segRegionMap = new Map<string, { revenue: number; deals: number }>();
  const segmentsSet = new Set<string>();
  const regionsSet = new Set<string>();
  for (const row of uniqueDeals) {
    if (!row.segment || !row.region) continue;
    const key = `${row.segment}::${row.region}`;
    segmentsSet.add(row.segment);
    regionsSet.add(row.region);
    const bucket = segRegionMap.get(key) ?? { revenue: 0, deals: 0 };
    bucket.revenue += row.amount ?? 0;
    bucket.deals += 1;
    segRegionMap.set(key, bucket);
  }
  // sort regions by total revenue desc; segments by total revenue desc
  const regionList = [...regionsSet].sort((a, b) => {
    const ra = regionTotals.get(a)?.revenue ?? 0;
    const rb = regionTotals.get(b)?.revenue ?? 0;
    return rb - ra;
  });
  const segRevenue = new Map<string, number>();
  for (const s of segmentsSet) {
    let total = 0;
    for (const r of regionList) {
      total += segRegionMap.get(`${s}::${r}`)?.revenue ?? 0;
    }
    segRevenue.set(s, total);
  }
  const segmentList = [...segmentsSet].sort(
    (a, b) => (segRevenue.get(b) ?? 0) - (segRevenue.get(a) ?? 0),
  );
  const cells: PipelineCell[][] = segmentList.map((segment) =>
    regionList.map((region) => {
      const bucket = segRegionMap.get(`${segment}::${region}`) ?? { revenue: 0, deals: 0 };
      const avgTicket = bucket.deals > 0 ? bucket.revenue / bucket.deals : 0;
      const display =
        bucket.deals === 0
          ? "—"
          : `${formatCurrency(bucket.revenue)} · ${bucket.deals} deals · ${avgTicket > 0 ? formatCurrency(avgTicket) : "—"}`;
      return {
        segment,
        region,
        revenue: bucket.revenue,
        deals: bucket.deals,
        avgTicket,
        display,
      };
    }),
  );

  // Pain × Region %-heatmap (% of distinct demos in that region)
  const regionDemoCount = new Map<string, Set<string>>();
  for (const row of pains) {
    if (!row.region || !row.transcript_id) continue;
    const bucket = regionDemoCount.get(row.region) ?? new Set<string>();
    bucket.add(row.transcript_id);
    regionDemoCount.set(row.region, bucket);
  }
  // Build per region: top 3 pain subtypes by distinct demos
  const painRegionMap = new Map<string, Map<string, Set<string>>>(); // region -> pain -> demos
  for (const row of pains) {
    if (!row.region || !row.transcript_id) continue;
    const pain = row.insight_subtype_display;
    if (!pain) continue;
    const regionMap = painRegionMap.get(row.region) ?? new Map<string, Set<string>>();
    const bucket = regionMap.get(pain) ?? new Set<string>();
    bucket.add(row.transcript_id);
    regionMap.set(pain, bucket);
    painRegionMap.set(row.region, regionMap);
  }
  const painSet = new Set<string>();
  const regionPainRows: PainRegionPctRow[] = [];
  for (const [region, rmap] of painRegionMap) {
    const top = [...rmap.entries()]
      .sort((a, b) => b[1].size - a[1].size)
      .slice(0, 3);
    const regionDemos = regionDemoCount.get(region)?.size ?? 0;
    for (const [pain, demos] of top) {
      painSet.add(pain);
      regionPainRows.push({
        pain,
        region,
        deals: demos.size,
        pct: regionDemos > 0 ? Math.round((demos.size / regionDemos) * 1000) / 10 : 0,
      });
    }
  }
  const painRegionRegions = [...new Set(regionPainRows.map((r) => r.region))].sort(
    (a, b) => (regionDemoCount.get(b)?.size ?? 0) - (regionDemoCount.get(a)?.size ?? 0),
  );
  const painRegionPains = [...painSet].sort((a, b) => {
    const sumA = regionPainRows.filter((r) => r.pain === a).reduce((s, r) => s + r.pct, 0);
    const sumB = regionPainRows.filter((r) => r.pain === b).reduce((s, r) => s + r.pct, 0);
    return sumB - sumA;
  });
  const painRegionValues: number[][] = painRegionPains.map((pain) =>
    painRegionRegions.map((region) => {
      const found = regionPainRows.find((r) => r.pain === pain && r.region === region);
      return found?.pct ?? 0;
    }),
  );
  const painRegionAbs: number[][] = painRegionPains.map((pain) =>
    painRegionRegions.map((region) => {
      const found = regionPainRows.find((r) => r.pain === pain && r.region === region);
      return found?.deals ?? 0;
    }),
  );

  // Competitors by country
  const ccMap = new Map<string, { mentions: number; relationships: string[] }>();
  for (const row of comp) {
    if (!row.country || !row.competitor_name) continue;
    const key = `${row.country}::${row.competitor_name}`;
    const bucket = ccMap.get(key) ?? { mentions: 0, relationships: [] };
    bucket.mentions += 1;
    if (row.competitor_relationship_display) {
      bucket.relationships.push(row.competitor_relationship_display);
    }
    ccMap.set(key, bucket);
  }
  const competitorsByCountry: CompetitorCountryRow[] = [...ccMap.entries()]
    .map(([key, v]) => {
      const [country, competitor] = key.split("::");
      // most frequent relationship
      const counts = new Map<string, number>();
      for (const r of v.relationships) counts.set(r, (counts.get(r) ?? 0) + 1);
      let top = "";
      let topCount = -1;
      for (const [k, c] of counts) {
        if (c > topCount) {
          top = k;
          topCount = c;
        }
      }
      return {
        country,
        competitor,
        mentions: v.mentions,
        topRelationship: top || "—",
      };
    })
    .sort((a, b) => a.country.localeCompare(b.country) || b.mentions - a.mentions);
  const competitorCountries = [...new Set(competitorsByCountry.map((r) => r.country))].sort();

  return {
    countryInsight: stackBy(filteredRows, "country", "insight_type_display", 15, 8),
    painRegionHeatPct: {
      rowLabels: painRegionPains,
      colLabels: painRegionRegions,
      values: painRegionValues,
      absolute: painRegionAbs,
    },
    moduleRegionHeat: buildHeatMap(filteredRows, "module_display", "region", 15, 8),
    pipelineKpis: {
      topRegion,
      topRegionPct: formatRegionPct(topRegionPct),
      totalPipeline: formatCurrency(totalPipeline),
      highestAvgRegion,
      highestAvgValue: highestAvgValue > 0 ? formatCurrency(highestAvgValue) : "—",
      highestAvgDeals,
    },
    pipelineGrid: {
      rowLabels: segmentList,
      colLabels: regionList,
      cells,
    },
    competitorsByCountry,
    competitorCountries,
  };
}

