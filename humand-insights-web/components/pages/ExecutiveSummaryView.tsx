"use client";

import { ChartCard } from "@/components/charts/ChartCard";
import { HeatMap } from "@/components/charts/HeatMap";
import { TrendLineChart } from "@/components/charts/LineChart";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { COMPETITOR_REL_COLORS } from "@/components/charts/chart-theme";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import { formatCurrency } from "@/lib/data/computations";
import type { ExecutiveSummaryData } from "@/lib/data/executive-summary-data";

type Props = {
  data: ExecutiveSummaryData;
};

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] leading-[1.5] text-[var(--color-text-secondary)]">{children}</p>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius-m)] bg-[var(--color-brand-50)] px-4 py-3 text-[12px] leading-[1.5] text-[var(--color-text-default)]">
      {children}
    </div>
  );
}

export function ExecutiveSummaryView({ data }: Props) {
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
    trend,
  } = data;

  return (
    <div className="space-y-8">
      <PageTitle
        title="Executive Summary"
        subtitle="Panorama completo de señales detectadas en el período seleccionado."
      />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard
          label="Insights por Call"
          value={kpis.insightsPerCall}
          caption="Promedio de señales detectadas por demo."
        />
        <MetricCard
          label="Transcripts"
          value={kpis.totalCalls.toLocaleString()}
          caption="Calls únicas en el recorte actual."
        />
        <MetricCard
          label="Deals con Match"
          value={kpis.dealsMatched.toLocaleString()}
          caption="Deals únicos con al menos un insight."
        />
        <MetricCard
          label="Revenue Total"
          value={formatCurrency(kpis.revenue)}
          caption="Suma de monto por deal único."
        />
        <MetricCard
          label="Calls con Insights"
          value={`${kpis.callsWithInsights}%`}
          caption="% del total de demos procesadas."
        />
      </section>

      <div className="space-y-4">
        <SectionHeader
          title="Composición de la muestra"
          description="Volumen de demos únicas cubiertas por industria, segmento y país."
        />
        <section className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="Distribución por Industria (Top 15)">
            <HorizontalBarChart data={composition.byIndustry} yAxisWidth={220} />
          </ChartCard>
          <ChartCard title="Distribución por Segmento">
            <HorizontalBarChart data={composition.bySegment} yAxisWidth={180} />
          </ChartCard>
          <div className="lg:col-span-2">
            <ChartCard title="Distribución por País (Top 15)">
              <HorizontalBarChart data={composition.byCountry} yAxisWidth={180} />
            </ChartCard>
          </div>
        </section>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="Resumen de señales detectadas"
          description="Cantidad de insights únicos por tipo. Una misma demo puede generar varios."
        />
        <ChartCard title="Insights por Tipo">
          <HorizontalBarChart data={insightTypes} multicolor yAxisWidth={220} />
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="¿Con qué problemas llegan los clientes?"
          description="Top pains por demos únicas, desglosados por tema y por módulo."
        />
        <ChartCard title="Top 10 Pains (demos únicas)">
          <HorizontalBarChart
            data={pains.topPains.map((r) => ({ name: r.name, value: r.value, pct: r.pct }))}
            label={(value) => {
              const row = pains.topPains.find((item) => item.value === value);
              return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
            }}
            yAxisWidth={260}
          />
        </ChartCard>

        {pains.painThemeSiblings.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-[var(--color-text-default)]">
              Pains relacionados (por tema)
            </h3>
            <Caption>
              Para cada uno de los 2 pains principales, otros pains del mismo tema.
            </Caption>
            <section className="grid gap-3 lg:grid-cols-2">
              {pains.painThemeSiblings.map((group) => (
                <ChartCard key={group.name} title={group.name}>
                  {group.data.length > 0 ? (
                    <HorizontalBarChart data={group.data} yAxisWidth={240} height={260} />
                  ) : (
                    <EmptyState>Sin pains relacionados bajo el mismo tema.</EmptyState>
                  )}
                </ChartCard>
              ))}
            </section>
          </div>
        ) : null}

        {pains.painByModuleBreakdown.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-[var(--color-text-default)]">
              Pain Insights — desglose de los 2 principales pains por módulo
            </h3>
            <section className="grid gap-3 lg:grid-cols-2">
              {pains.painByModuleBreakdown.map((group) => (
                <ChartCard key={group.name} title={`Desglose: ${group.name}`}>
                  {group.data.length > 0 ? (
                    <HorizontalBarChart data={group.data} yAxisWidth={200} height={260} />
                  ) : (
                    <EmptyState>Sin módulos asociados para este pain.</EmptyState>
                  )}
                </ChartCard>
              ))}
            </section>
          </div>
        ) : null}

        <ChartCard title="Top 15 Pains × Segmento">
          <HeatMap
            rowLabels={pains.painSegmentHeat.rowLabels}
            colLabels={pains.painSegmentHeat.colLabels}
            values={pains.painSegmentHeat.values}
          />
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="¿Qué módulos buscan y qué les falta?"
          description="Demanda de módulos (pains + gaps combinados) y gaps por frecuencia y revenue."
        />
        <ChartCard title="Módulos más buscados en la primera demo">
          <HorizontalBarChart
            data={moduleDemand.map((r) => ({ name: r.name, value: r.value, pct: r.pct }))}
            label={(value) => {
              const row = moduleDemand.find((item) => item.value === value);
              return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
            }}
            yAxisWidth={220}
          />
        </ChartCard>
        <section className="grid gap-3 lg:grid-cols-2">
          <ChartCard title="Top 10 Feature Gaps — Frecuencia">
            <HorizontalBarChart
              data={gaps.byFreq.map((r) => ({ name: r.name, value: r.value, pct: r.pct }))}
              label={(value) => {
                const row = gaps.byFreq.find((item) => item.value === value);
                return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
              }}
              yAxisWidth={220}
            />
          </ChartCard>
          <ChartCard title="Top 10 Feature Gaps — Revenue en Riesgo">
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
        <ChartCard title="Top Competidores Mencionados">
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
          <ChartCard title="Top 10 Fricciones (demos únicas)">
            {frictions.top.length > 0 ? (
              <HorizontalBarChart data={frictions.top} yAxisWidth={240} />
            ) : (
              <EmptyState>Sin datos de fricciones en el recorte actual.</EmptyState>
            )}
          </ChartCard>
          <ChartCard title="Fricciones — Revenue en Riesgo">
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
        {frictions.breakdown.length > 0 ? (
          <section className="grid gap-3 lg:grid-cols-2">
            {frictions.breakdown.map((item) => (
              <ChartCard key={item.name} title={`Desglose: ${item.name}`}>
                {item.data.length > 0 ? (
                  <HorizontalBarChart data={item.data} yAxisWidth={180} height={260} />
                ) : (
                  <EmptyState>Sin datos de desglose.</EmptyState>
                )}
              </ChartCard>
            ))}
          </section>
        ) : null}
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="¿Qué preguntas aparecen siempre?"
          description="Top FAQs por demos únicas y co-ocurrencia con módulos."
        />
        <section className="grid gap-3 lg:grid-cols-[2fr_3fr]">
          <ChartCard title="Top 10 Preguntas Frecuentes (demos únicas)">
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

        {faqs.topicModuleBreakdown.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-[var(--color-text-default)]">
              Desglose de los 2 principales topics de FAQs por módulo co-ocurrente
            </h3>
            <section className="grid gap-3 lg:grid-cols-2">
              {faqs.topicModuleBreakdown.map((item) => (
                <ChartCard key={item.name} title={`Módulos donde aparece: ${item.name}`}>
                  {item.data.length > 0 ? (
                    <HorizontalBarChart data={item.data} yAxisWidth={200} height={280} />
                  ) : (
                    <EmptyState>Sin co-ocurrencia de módulos.</EmptyState>
                  )}
                </ChartCard>
              ))}
            </section>
          </div>
        ) : null}
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="Tendencia Mensual"
          description="Evolución mensual del volumen de insights por tipo."
        />
        {trend.data.length > 0 ? (
          <ChartCard>
            <TrendLineChart data={trend.data} seriesKeys={trend.keys} />
          </ChartCard>
        ) : (
          <EmptyState>No hay datos suficientes para tendencia mensual.</EmptyState>
        )}
        <Note>
          La caída en las últimas semanas del período puede reflejar que el dataset aún no está
          completo para esas fechas.
        </Note>
      </div>
    </div>
  );
}
