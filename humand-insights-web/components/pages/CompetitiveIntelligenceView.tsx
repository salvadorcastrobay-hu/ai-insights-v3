"use client";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { COMPETITOR_REL_COLORS } from "@/components/charts/chart-theme";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { formatCurrency } from "@/lib/data/computations";
import type { CompetitiveIntelligenceData } from "@/lib/data/competitive-intelligence-data";

type Props = { data: CompetitiveIntelligenceData };

const RELATIONSHIP_LEGEND: Array<{ label: string; color: string; note: string }> = [
  { label: "Usa actualmente", color: COMPETITOR_REL_COLORS["Usa actualmente"], note: "desplazamiento activo, máxima prioridad" },
  { label: "Evaluando", color: COMPETITOR_REL_COLORS.Evaluando, note: "necesita battle card específica" },
  { label: "Migrando desde", color: COMPETITOR_REL_COLORS["Migrando desde"], note: "oportunidad activa, acelerar" },
  { label: "Uso anterior", color: COMPETITOR_REL_COLORS["Uso anterior"], note: "aprender por qué lo dejaron" },
  { label: "Mencionado", color: COMPETITOR_REL_COLORS.Mencionado, note: "señal débil, no actuar sin más contexto" },
  { label: "Descartado", color: COMPETITOR_REL_COLORS.Descartado, note: "win para Humand, documentar motivo" },
];

export function CompetitiveIntelligenceView({ data }: Props) {
  const {
    isEmpty,
    kpis,
    competitorCounts,
    relationStack,
    countryHeat,
    segmentStack,
    industryStack,
    stageStack,
    migrationRows,
  } = data;

  if (isEmpty) {
    return <EmptyState>No hay señales competitivas para los filtros actuales.</EmptyState>;
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Competitive Intelligence" />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Competidores relevantes"
          value={kpis.relevantCompetitors}
          caption="Con señal de relación fuerte"
        />
        <MetricCard
          label="Deals con señal competitiva"
          value={kpis.dealsWithSignal}
          delta={`${kpis.dealsPct}% del total`}
        />
        <MetricCard label="Revenue con competencia activa" value={formatCurrency(kpis.compRevenue)} />
      </section>

      <SectionHeader
        title="A. ¿Contra quién competimos?"
        description="Ranking de competidores por deals únicos, con desglose de la relación que el prospect tiene con ellos."
      />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="¿Contra quién competimos más seguido?">
          <HorizontalBarChart data={competitorCounts} height={Math.max(320, competitorCounts.length * 32)} />
        </ChartCard>
        <ChartCard title="¿Cuál es la relación del prospect con el competidor?">
          <StackedBarChart
            data={relationStack.data}
            yKey="name"
            stackKeys={relationStack.stackKeys}
            colorMap={COMPETITOR_REL_COLORS}
            height={Math.max(320, relationStack.data.length * 32)}
          />
        </ChartCard>
      </section>

      <ChartCard title="Leyenda de tipos de relación competitiva">
        <div className="grid gap-2 text-[12px] md:grid-cols-3">
          {RELATIONSHIP_LEGEND.map((item) => (
            <div key={item.label} className="flex items-start gap-2">
              <span
                className="mt-[2px] inline-block h-3 w-3 flex-shrink-0 rounded-sm"
                style={{ backgroundColor: item.color }}
              />
              <div>
                <div className="font-semibold text-[var(--color-text-default)]">{item.label}</div>
                <div className="text-[var(--color-text-secondary)]">{item.note}</div>
              </div>
            </div>
          ))}
        </div>
      </ChartCard>

      <SectionHeader
        title="B. ¿Dónde y con quién?"
        description="Presencia de cada competidor por país, segmento comercial e industria."
      />
      <ChartCard title="¿En qué países aparece cada competidor?">
        <HeatMap
          rowLabels={countryHeat.rowLabels}
          colLabels={countryHeat.colLabels}
          values={countryHeat.values}
          height={Math.max(360, countryHeat.rowLabels.length * 36 + 140)}
        />
      </ChartCard>
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="¿En qué segmento aparece cada competidor?">
          <StackedBarChart
            data={segmentStack.data}
            yKey="name"
            stackKeys={segmentStack.stackKeys}
            height={Math.max(320, segmentStack.data.length * 32)}
          />
        </ChartCard>
        <ChartCard title="¿En qué industrias aparece cada competidor?">
          <StackedBarChart
            data={industryStack.data}
            yKey="name"
            stackKeys={industryStack.stackKeys}
            height={Math.max(320, industryStack.data.length * 32)}
          />
        </ChartCard>
      </section>

      <SectionHeader
        title="C. ¿En qué momento del deal aparecen?"
        description="Cruce competidor × etapa del deal. Si un competidor se repite en etapas Lost, priorizar battle card."
      />
      <ChartCard title="¿En qué etapa del deal aparece cada competidor?">
        <StackedBarChart
          data={stageStack.data}
          yKey="name"
          stackKeys={stageStack.stackKeys}
          height={Math.max(320, stageStack.data.length * 32)}
        />
      </ChartCard>

      <SectionHeader
        title="D. Migration Opportunities"
        description="Deals donde el prospect usa actualmente o migra desde un competidor directo. Ordenado por revenue descendente."
      />
      <ChartCard>
        {migrationRows.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No hay oportunidades de migración detectadas en los datos filtrados.
          </p>
        ) : (
          <div className="max-h-[460px] overflow-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Empresa</Th>
                  <Th>Competidor</Th>
                  <Th>Tipo de Relación</Th>
                  <Th>Industria</Th>
                  <Th>País</Th>
                  <Th>Segmento</Th>
                  <Th>Revenue</Th>
                  <Th>Etapa</Th>
                  <Th>AE</Th>
                </Tr>
              </Thead>
              <Tbody>
                {migrationRows.map((row) => (
                  <Tr key={`${row.id}-${row.competitor}`}>
                    <Td>{row.company}</Td>
                    <Td>{row.competitor}</Td>
                    <Td>{row.relationship}</Td>
                    <Td>{row.industry}</Td>
                    <Td>{row.country}</Td>
                    <Td>{row.segment}</Td>
                    <Td>{row.revenueDisplay}</Td>
                    <Td>{row.stage}</Td>
                    <Td>{row.owner}</Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}
