"use client";

import { ChartCard } from "@/components/charts/ChartCard";
import { HeatMap } from "@/components/charts/HeatMap";
import { TrendLineChart } from "@/components/charts/LineChart";
import { CategoryPieChart } from "@/components/charts/PieChart";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { COMPETITOR_REL_COLORS } from "@/components/charts/chart-theme";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import {
  buildHeatMap,
  distinctCount,
  filterByType,
  groupDistinctTranscripts,
  monthlyInsightTrend,
  stackBy,
  topBreakdowns,
} from "@/lib/data/dashboard-aggregations";
import { painsWithPct, uniqueDealsRevenue } from "@/lib/data/computations";
import { useFilteredRows } from "@/lib/data/use-filtered-rows";
import type { InsightRow } from "@/lib/supabase/types";

type Props = {
  rows: InsightRow[];
  totalTranscripts: number;
};

export function ExecutiveSummaryClient({ rows, totalTranscripts }: Props) {
  const { filteredRows } = useFilteredRows(rows);

  const totalCalls = distinctCount(filteredRows, "transcript_id");
  const insightsPerCall = totalCalls > 0 ? (filteredRows.length / totalCalls).toFixed(1) : "0.0";
  const dealsMatched = distinctCount(filteredRows, "deal_id");
  const revenue = uniqueDealsRevenue(filteredRows);
  const callsWithInsights = totalTranscripts > 0 ? ((totalCalls / totalTranscripts) * 100).toFixed(1) : "0.0";

  const byIndustry = groupDistinctTranscripts(filteredRows, "industry", 15);
  const bySegment = groupDistinctTranscripts(filteredRows, "segment", 15);
  const byCountry = groupDistinctTranscripts(filteredRows, "country", 15);
  const insightTypes = groupDistinctTranscripts(filteredRows, "insight_type_display", 20);

  const painRows = filterByType(filteredRows, "pain");
  const topPains = painsWithPct(painRows, 10, totalTranscripts);
  const painHeatMap = buildHeatMap(painRows, "insight_subtype_display", "segment", 15, 8);
  const painThemeBreakdowns = topBreakdowns(painRows, "pain_theme", "insight_subtype_display", 2);
  const painByModule = groupDistinctTranscripts(painRows, "module_display", 12);

  const moduleDemand = groupDistinctTranscripts(filteredRows, "module_display", 15);

  const gaps = filterByType(filteredRows, "product_gap");
  const gapsByFreq = groupDistinctTranscripts(gaps, "feature_display", 10);
  const gapRevenue = groupDistinctTranscripts(gaps, "feature_name", 10);

  const comp = filterByType(filteredRows, "competitive_signal").filter((r) => !r.is_own_brand_competitor);
  const compStack = stackBy(comp, "competitor_name", "competitor_relationship_display", 12);

  const frictions = filterByType(filteredRows, "deal_friction");
  const frictionTop = groupDistinctTranscripts(frictions, "insight_subtype_display", 10);
  const frictionBreakdown = topBreakdowns(frictions, "insight_subtype_display", "segment", 2);
  const frictionRevenue = groupDistinctTranscripts(frictions, "deal_stage", 10);

  const faqs = filterByType(filteredRows, "faq");
  const faqTop = groupDistinctTranscripts(faqs, "insight_subtype_display", 10);
  const faqHeatMap = buildHeatMap(faqs, "insight_subtype_display", "module_display", 8, 8);
  const faqBreakdown = topBreakdowns(faqs, "insight_subtype_display", "module_display", 2);

  const trend = monthlyInsightTrend(filteredRows);
  const trendKeys = [...new Set(filteredRows.map((r) => r.insight_type_display))];

  return (
    <div className="space-y-6">
      <PageTitle title="Executive Summary" />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Insights por Call" value={insightsPerCall} delta="Positivo" />
        <MetricCard label="Transcripts" value={totalCalls.toLocaleString()} />
        <MetricCard label="Deals con Match" value={dealsMatched.toLocaleString()} />
        <MetricCard label="Revenue Total" value={new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(revenue)} />
        <MetricCard label="Calls con Insights" value={`${callsWithInsights}%`} />
      </section>

      <SectionHeader title="Composición de la muestra" />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Industria TOP 15">
          <HorizontalBarChart data={byIndustry} height={360} />
        </ChartCard>
        <ChartCard title="Segmento">
          <HorizontalBarChart data={bySegment} height={360} />
        </ChartCard>
        <div className="lg:col-span-2">
          <ChartCard title="País TOP 15">
            <HorizontalBarChart data={byCountry} height={380} />
          </ChartCard>
        </div>
      </section>

      <SectionHeader title="Resumen de señales detectadas" />
      <ChartCard title="Insights por tipo">
        <HorizontalBarChart data={insightTypes} multicolor height={460} />
      </ChartCard>

      <SectionHeader title="¿Con qué problemas llegan los clientes?" />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Top 10 pains">
          <HorizontalBarChart
            data={topPains.map((row) => ({ name: row.name, value: row.value }))}
            label={(value) => {
              const match = topPains.find((item) => item.value === value);
              return match ? `${match.value} (${match.pct.toFixed(1)}%)` : String(value);
            }}
            height={420}
          />
        </ChartCard>
        <ChartCard title="Top themes">
          <CategoryPieChart
            data={painThemeBreakdowns.map((item) => ({
              name: item.name || "Sin theme",
              value: item.data.reduce((acc, curr) => acc + curr.value, 0),
            }))}
          />
        </ChartCard>
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        {painThemeBreakdowns.map((theme) => (
          <ChartCard key={theme.name} title={`${theme.name || "Sin theme"}`}>
            <HorizontalBarChart data={theme.data} height={260} />
          </ChartCard>
        ))}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Pain × Segmento Heatmap">
          <HeatMap rowLabels={painHeatMap.rowLabels} colLabels={painHeatMap.colLabels} values={painHeatMap.values} height={Math.max(500, painHeatMap.rowLabels.length * 38)} />
        </ChartCard>
        <ChartCard title="Pain × Module">
          <HorizontalBarChart data={painByModule} height={500} />
        </ChartCard>
      </section>

      <SectionHeader title="¿Qué módulos buscan más?" />
      <ChartCard>
        <HorizontalBarChart data={moduleDemand} height={420} />
      </ChartCard>

      <SectionHeader title="Feature Gaps" />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Top by Frequency">
          <HorizontalBarChart data={gapsByFreq} height={360} />
        </ChartCard>
        <ChartCard title="Top by Revenue">
          <HorizontalBarChart data={gapRevenue} height={360} />
        </ChartCard>
      </section>

      <SectionHeader title="¿Qué competidores se mencionan más?" />
      <ChartCard title="Competitor × Relationship">
        <StackedBarChart data={compStack.data} yKey="name" stackKeys={compStack.stackKeys} colorMap={COMPETITOR_REL_COLORS} height={460} />
      </ChartCard>

      <SectionHeader title="Fricciones recurrentes" />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Top 10 fricciones">
          <HorizontalBarChart data={frictionTop} height={360} />
        </ChartCard>
        <ChartCard title="Fricciones × Revenue proxy">
          <HorizontalBarChart data={frictionRevenue} height={360} />
        </ChartCard>
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        {frictionBreakdown.map((item) => (
          <ChartCard key={item.name} title={item.name}>
            <HorizontalBarChart data={item.data} height={240} />
          </ChartCard>
        ))}
      </section>

      <SectionHeader title="FAQs" />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="Top FAQs">
          <HorizontalBarChart data={faqTop} height={360} />
        </ChartCard>
        <ChartCard title="Top FAQs × Modules">
          <HeatMap rowLabels={faqHeatMap.rowLabels} colLabels={faqHeatMap.colLabels} values={faqHeatMap.values} height={420} />
        </ChartCard>
      </section>
      <section className="grid gap-3 lg:grid-cols-2">
        {faqBreakdown.map((item) => (
          <ChartCard key={item.name} title={item.name}>
            <HorizontalBarChart data={item.data} height={240} />
          </ChartCard>
        ))}
      </section>

      <SectionHeader title="Tendencia Mensual" />
      {trend.length > 0 ? (
        <ChartCard>
          <TrendLineChart data={trend} seriesKeys={trendKeys} />
        </ChartCard>
      ) : (
        <EmptyState>No hay datos suficientes para tendencia mensual.</EmptyState>
      )}
    </div>
  );
}
