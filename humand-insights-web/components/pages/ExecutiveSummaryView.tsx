"use client";

import { ChartCard } from "@/components/charts/ChartCard";
import { HeatMap } from "@/components/charts/HeatMap";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { COMPETITOR_REL_COLORS } from "@/components/charts/chart-theme";
import { useDrillDown } from "@/components/drill-down/DrillDownProvider";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import { formatCurrency } from "@/lib/data/computations";
import { shortSegmentLabel } from "@/lib/data/normalizers";
import { useTranslations } from "next-intl";
import type { ExecutiveSummaryData } from "@/lib/data/executive-summary-data";
import type { InsightRow } from "@/lib/supabase/types";

type Props = {
  data: ExecutiveSummaryData;
  filteredRows: InsightRow[];
};


export function ExecutiveSummaryView({ data, filteredRows }: Props) {
  const t = useTranslations("executiveSummary");
  const { open: drill } = useDrillDown();
  const {
    kpis,
    composition,
    insightTypes,
    pains,
    moduleDemand,
    gaps,
    competitors,
    frictions,
    faqs,
  } = data;

  return (
    <div className="space-y-8">
      <PageTitle
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label={t("insightsPerCall")}
          value={kpis.insightsPerCall}
          caption={t("insightsPerCallCaption")}
        />
        <MetricCard
          label={t("transcripts")}
          value={kpis.totalCalls.toLocaleString()}
          caption={t("transcriptsCaption")}
        />
        <MetricCard
          label={t("dealsMatched")}
          value={kpis.dealsMatched.toLocaleString()}
          caption={t("dealsMatchedCaption")}
        />
        <MetricCard
          label={t("revenueTotal")}
          value={formatCurrency(kpis.revenue)}
          caption={t("revenueTotalCaption")}
        />
        <MetricCard
          label={t("callsWithInsights")}
          value={`${kpis.callsWithInsights}%`}
          caption={t("callsWithInsightsCaption")}
        />
      </section>

      <div className="space-y-4">
        <SectionHeader
          title={t("compositionTitle")}
          description={t("compositionDesc")}
        />
        <section className="space-y-3">
          <ChartCard
            title={t("byIndustry")}
            rawRows={filteredRows}
            ask={{
              chartTitle: "Distribución por Industria",
              chartKind: "horizontal-bar",
              description: "Distribución de insights por industria del cliente.",
              rows: composition.byIndustry.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            <HorizontalBarChart data={composition.byIndustry} yAxisWidth={220} />
          </ChartCard>
          <ChartCard
            title={t("bySegment")}
            rawRows={filteredRows}
            ask={{
              chartTitle: t("bySegment"),
              chartKind: "horizontal-bar",
              description: "Distribución de insights por segmento comercial.",
              rows: composition.bySegment.map((r) => ({ label: shortSegmentLabel(r.name), value: r.value })),
            }}
          >
            <HorizontalBarChart
              data={composition.bySegment.map((d) => ({ ...d, name: shortSegmentLabel(d.name) }))}
              yAxisWidth={220}
              height={220}
            />
          </ChartCard>
          <ChartCard
            title={t("byCountry")}
            rawRows={filteredRows}
            ask={{
              chartTitle: "Distribución por País",
              chartKind: "horizontal-bar",
              description: "Distribución de insights por país.",
              rows: composition.byCountry.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            <HorizontalBarChart data={composition.byCountry} yAxisWidth={220} />
          </ChartCard>
        </section>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title={t("signalSummaryTitle")}
          description={t("signalSummaryDesc")}
        />
        <ChartCard
          title={t("insightsByType")}
          rawRows={filteredRows}
          ask={{
            chartTitle: "Insights por Tipo",
            chartKind: "horizontal-bar",
            description: "Cantidad de insights extraídos por cada tipo (pain, product_gap, etc.).",
            rows: insightTypes.map((r) => ({ label: r.name, value: r.value })),
          }}
        >
          <HorizontalBarChart data={insightTypes} multicolor yAxisWidth={220} />
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title={t("painsTitle")}
          description={t("painsDesc")}
        />
        <ChartCard
          title={t("topPains")}
          rawRows={filteredRows.filter((r) => r.insight_type === "pain")}
          ask={{
            chartTitle: "Top 10 Pains (demos únicas)",
            chartKind: "horizontal-bar",
            description: "Top pains por demos únicas; valor = demos, pct = % sobre total de demos.",
            dimension: "insight_subtype_display",
            scopeType: "pain",
            rows: pains.topPains.map((r) => ({
              label: r.name,
              value: r.value,
              extra: { pct: `${r.pct.toFixed(1)}%` },
            })),
          }}
        >
          <HorizontalBarChart
            data={pains.topPains.map((r) => ({ name: r.name, value: r.value, pct: r.pct }))}
            label={(value) => {
              const row = pains.topPains.find((item) => item.value === value);
              return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
            }}
            yAxisWidth={260}
            onBarClick={(row) => drill({ dimension: "pain_theme", value: String(row.name), scopeType: "pain" })}
          />
        </ChartCard>


        <ChartCard title={t("painBySegment")}>
          <HeatMap
            rowLabels={pains.painSegmentHeat.rowLabels}
            colLabels={pains.painSegmentHeat.colLabels}
            values={pains.painSegmentHeat.values}
          />
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title={t("modulesTitle")}
          description={t("modulesDesc")}
        />
        <ChartCard
          title="Módulos más buscados en la primera demo"
          rawRows={filteredRows}
          ask={{
            chartTitle: "Módulos más buscados",
            chartKind: "horizontal-bar",
            description: "Módulos con mayor demanda (pains + gaps combinados) por demos únicas.",
            dimension: "module_display",
            rows: moduleDemand.map((r) => ({ label: r.name, value: r.value, extra: { pct: `${r.pct.toFixed(1)}%` } })),
          }}
        >
          <HorizontalBarChart
            data={moduleDemand.map((r) => ({ name: r.name, value: r.value, pct: r.pct }))}
            label={(value) => {
              const row = moduleDemand.find((item) => item.value === value);
              return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
            }}
            yAxisWidth={220}
          />
        </ChartCard>
        <section className="space-y-3">
          <ChartCard
            title="Top 20 Feature Gaps — Frecuencia"
            rawRows={filteredRows.filter((r) => r.insight_type === "product_gap")}
            ask={{
              chartTitle: "Top 20 Feature Gaps — Frecuencia",
              chartKind: "horizontal-bar",
              description: "Features faltantes más solicitadas por deals únicos.",
              dimension: "feature_display",
              scopeType: "product_gap",
              rows: gaps.byFreq.map((r) => ({ label: r.name, value: r.value, extra: { pct: `${r.pct.toFixed(1)}%` } })),
            }}
          >
            <HorizontalBarChart
              data={gaps.byFreq.map((r) => ({ name: r.name, value: r.value, pct: r.pct }))}
              label={(value) => {
                const row = gaps.byFreq.find((item) => item.value === value);
                return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
              }}
              yAxisWidth={220}
            />
          </ChartCard>
          <ChartCard
            title="Top 20 Feature Gaps — Revenue en Riesgo"
            rawRows={filteredRows.filter((r) => r.insight_type === "product_gap")}
            ask={{
              chartTitle: "Top 20 Feature Gaps — Revenue en Riesgo",
              chartKind: "horizontal-bar",
              description: "Features ordenadas por revenue de los deals que las mencionaron.",
              dimension: "feature_display",
              scopeType: "product_gap",
              rows: gaps.byRevenue.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            <HorizontalBarChart
              data={gaps.byRevenue}
              label={(value) => formatCurrency(value)}
              yAxisWidth={220}
            />
          </ChartCard>
        </section>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="¿Qué competidores se mencionan más?"
          description="Top competidores desglosados por tipo de relación (usa, evalúa, migra, etc.)."
        />
        <ChartCard
          title="Top Competidores Mencionados"
          rawRows={filteredRows.filter((r) => r.insight_type === "competitive_signal" && !r.is_own_brand_competitor)}
          ask={{
            chartTitle: "Top Competidores Mencionados",
            chartKind: "stacked-bar",
            description: "Top competidores por deals únicos, desglosados por tipo de relación.",
            dimension: "competitor_name",
            scopeType: "competitive_signal",
            rows: competitors.data.map((r) => ({ label: String(r.name), value: competitors.stackKeys.reduce((sum, k) => sum + (Number(r[k]) || 0), 0) })),
          }}
        >
          <StackedBarChart
            data={competitors.data}
            yKey="name"
            stackKeys={competitors.stackKeys}
            colorMap={COMPETITOR_REL_COLORS}
            yAxisWidth={200}
          />
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="¿Cuáles son las fricciones más recurrentes en la primera demo?"
          description="Top fricciones por demos únicas, desglose por etapa y revenue en riesgo."
        />
        <section className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Top 10 Fricciones (demos únicas)"
            rawRows={filteredRows.filter((r) => r.insight_type === "deal_friction")}
            ask={{
              chartTitle: "Top 10 Fricciones",
              chartKind: "horizontal-bar",
              description: "Top fricciones del deal por demos únicas afectadas.",
              dimension: "friction_subtype",
              scopeType: "deal_friction",
              rows: frictions.top.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            {frictions.top.length > 0 ? (
              <HorizontalBarChart data={frictions.top} yAxisWidth={240} />
            ) : (
              <EmptyState>Sin datos de fricciones en el recorte actual.</EmptyState>
            )}
          </ChartCard>
          <ChartCard
            title="Fricciones — Revenue en Riesgo"
            rawRows={filteredRows.filter((r) => r.insight_type === "deal_friction")}
            ask={{
              chartTitle: "Fricciones — Revenue en Riesgo",
              chartKind: "horizontal-bar",
              description: "Fricciones ordenadas por revenue de los deals afectados.",
              dimension: "friction_subtype",
              scopeType: "deal_friction",
              rows: frictions.byRevenue.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            {frictions.byRevenue.length > 0 ? (
              <HorizontalBarChart
                data={frictions.byRevenue}
                label={(v) => formatCurrency(v)}
                yAxisWidth={240}
              />
            ) : (
              <EmptyState>Sin datos de revenue en fricciones.</EmptyState>
            )}
          </ChartCard>
        </section>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="¿Qué preguntas aparecen siempre?"
          description="Top FAQs por demos únicas y co-ocurrencia con módulos."
        />
        <section className="space-y-3">
          <ChartCard
            title="Top 10 Preguntas Frecuentes (demos únicas)"
            rawRows={filteredRows.filter((r) => r.insight_type === "faq")}
            ask={{
              chartTitle: "Top 10 FAQs",
              chartKind: "horizontal-bar",
              description: "Top topics de preguntas frecuentes por demos únicas.",
              dimension: "insight_subtype_display",
              scopeType: "faq",
              rows: faqs.top.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            {faqs.top.length > 0 ? (
              <HorizontalBarChart data={faqs.top} yAxisWidth={260} />
            ) : (
              <EmptyState>Sin datos de FAQs.</EmptyState>
            )}
          </ChartCard>
          <ChartCard title="FAQ Insights — Top Preguntas por Módulo">
            <HeatMap
              rowLabels={faqs.moduleHeat.rowLabels}
              colLabels={faqs.moduleHeat.colLabels}
              values={faqs.moduleHeat.values}
            />
          </ChartCard>
        </section>

      </div>

    </div>
  );
}
