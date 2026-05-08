"use client";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { useDrillDown } from "@/components/drill-down/DrillDownProvider";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { formatCurrency } from "@/lib/data/computations";
import type { SalesEnablementData } from "@/lib/data/sales-enablement-data";

type Props = { data: SalesEnablementData };

export function SalesEnablementView({ data }: Props) {
  const { open: drill } = useDrillDown();
  const {
    isEmpty,
    kpis,
    topFrictionTypes,
    top2Friction,
    frictionSegment,
    stageHeat,
    industryHeat,
    aeRows,
    aeFrictionStack,
    faqBattleCards,
    hasFaqs,
  } = data;

  if (isEmpty && !hasFaqs) {
    return <EmptyState>No hay fricciones ni FAQs para el filtro actual.</EmptyState>;
  }

  return (
    <div className="space-y-6">
      <PageTitle title="Sales Enablement" />

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Fricciones" value={kpis.totalFricciones} />
        <MetricCard label="Deals Afectados" value={kpis.affectedDeals} />
        <MetricCard label="Revenue en Riesgo" value={formatCurrency(kpis.revenueAtRisk)} />
        <MetricCard
          label="Fricciones por deal"
          value={kpis.frictionsPerDeal}
          caption="Promedio de fricciones por deal afectado"
        />
      </section>

      <SectionHeader
        title="A. ¿Qué está frenando los deals?"
        description="Ranking de fricciones por deals únicos y desglose narrativo de las dos principales."
      />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title="¿Qué está frenando más los deals?"
          ask={{
            chartTitle: "Top fricciones",
            chartKind: "horizontal-bar",
            description: "Fricciones ordenadas por deals únicos afectados.",
            dimension: "friction_subtype",
            scopeType: "deal_friction",
            rows: topFrictionTypes.map((r) => ({ label: r.name, value: r.value })),
          }}
        >
          <HorizontalBarChart
            data={topFrictionTypes}
            height={Math.max(320, topFrictionTypes.length * 32)}
            onBarClick={(row) =>
              drill({ dimension: "friction_subtype", value: String(row.name), scopeType: "deal_friction" })
            }
          />
        </ChartCard>
        <ChartCard title="¿Varía la fricción según el tamaño de empresa?">
          <StackedBarChart
            data={frictionSegment.data}
            yKey="name"
            stackKeys={frictionSegment.stackKeys}
            height={Math.max(320, frictionSegment.data.length * 32)}
          />
        </ChartCard>
      </section>

      <ChartCard title="Fricción Breakdown — Top 2">
        <div className="grid gap-4 md:grid-cols-2">
          {top2Friction.length === 0 ? (
            <p className="text-[13px] text-[var(--color-text-secondary)]">Sin datos suficientes.</p>
          ) : (
            top2Friction.map((item) => (
              <div key={item.name} className="space-y-2">
                <p className="text-[14px] font-semibold text-[var(--color-text-default)]">
                  {item.name}
                </p>
                <p className="text-[12px] text-[var(--color-text-secondary)]">
                  Aparece en {item.totalDeals} deals ({item.pctOfAffected}% de los afectados)
                </p>
                <ul className="space-y-1 text-[12px] text-[var(--color-text-secondary)]">
                  {item.topSummaries.length === 0 ? (
                    <li>(Sin datos de summary)</li>
                  ) : (
                    item.topSummaries.map((s, i) => (
                      <li key={i}>• {s.text} → {s.pct}%</li>
                    ))
                  )}
                </ul>
              </div>
            ))
          )}
        </div>
      </ChartCard>

      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="¿En qué etapa del deal aparece cada fricción?">
          <HeatMap
            rowLabels={stageHeat.rowLabels}
            colLabels={stageHeat.colLabels}
            values={stageHeat.values}
            height={Math.max(360, stageHeat.rowLabels.length * 32 + 140)}
          />
        </ChartCard>
        <ChartCard title="¿Qué fricción predomina según la industria?">
          <HeatMap
            rowLabels={industryHeat.rowLabels}
            colLabels={industryHeat.colLabels}
            values={industryHeat.values}
            height={Math.max(360, industryHeat.rowLabels.length * 32 + 140)}
          />
        </ChartCard>
      </section>
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        Si una fricción aparece mucho en Discovery, hay que abordarla al inicio de la conversación.
        Si aparece en Final Negotiation o Postponed, es un bloqueante tardío que necesita un
        argumento preparado de antemano.
      </p>

      <SectionHeader
        title="B. ¿Qué AEs necesitan más soporte?"
        description="Ordenado por fricciones promedio por deal — el AE con más complejidad aparece primero."
      />
      <ChartCard>
        <div className="max-h-[480px] overflow-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>AE</Th>
                <Th>Deals</Th>
                <Th>Avg Amount</Th>
                <Th>Fricc/deal</Th>
                <Th>% c/fricción</Th>
                <Th>Top Fricción</Th>
                <Th>Top Competidor</Th>
              </Tr>
            </Thead>
            <Tbody>
              {aeRows.map((row) => (
                <Tr key={row.ae}>
                  <Td>{row.ae}</Td>
                  <Td>{row.deals}</Td>
                  <Td>{row.avgAmount}</Td>
                  <Td>{row.frictionsPerDeal}</Td>
                  <Td>{row.pctDealsWithFriction}</Td>
                  <Td>{row.topFriction}</Td>
                  <Td>{row.topCompetitor}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </ChartCard>

      <ChartCard title="¿Qué tipo de fricciones enfrenta cada AE?">
        <StackedBarChart
          data={aeFrictionStack.data}
          yKey="name"
          stackKeys={aeFrictionStack.stackKeys}
          height={Math.max(320, aeFrictionStack.data.length * 36)}
        />
      </ChartCard>

      {hasFaqs ? (
        <>
          <SectionHeader
            title="C. ¿Qué preguntan los prospects? (Battle Cards)"
            description="Top 5 preguntas por topic, priorizadas por frecuencia. Base para preparar respuestas antes de la próxima demo."
          />
          <section className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {faqBattleCards.map((card) => (
              <ChartCard key={card.topic} title={card.topic}>
                <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
                  Aparece en {card.demos} demos
                </p>
                <ul className="space-y-1 text-[12px] text-[var(--color-text-default)]">
                  {card.questions.length === 0 ? (
                    <li className="text-[var(--color-text-secondary)]">
                      (Sin preguntas disponibles)
                    </li>
                  ) : (
                    card.questions.map((q, i) => (
                      <li key={i}>
                        <span className="text-[var(--color-text-secondary)]">[{q.pct}%]</span>{" "}
                        {q.text}
                      </li>
                    ))
                  )}
                </ul>
              </ChartCard>
            ))}
          </section>
        </>
      ) : null}
    </div>
  );
}
