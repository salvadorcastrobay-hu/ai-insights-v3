"use client";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { useDrillDown } from "@/components/drill-down/DrillDownProvider";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/data/computations";
import type { SalesEnablementData } from "@/lib/data/sales-enablement-data";

type Props = { data: SalesEnablementData; filteredRows: import("@/lib/supabase/types").InsightRow[] };

export function SalesEnablementView({ data, filteredRows }: Props) {
  const t = useTranslations("salesEnablement");
  const { open: drill } = useDrillDown();
  const {
    isEmpty,
    kpis,
    topFrictionTypes,
    top2Friction,
    frictionSegment,
    stageHeat,
    industryHeat,
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
        <MetricCard label={t("totalFrictions")} value={kpis.totalFricciones} />
        <MetricCard label={t("affectedDeals")} value={kpis.affectedDeals} />
        <MetricCard label={t("revenueAtRisk")} value={formatCurrency(kpis.revenueAtRisk)} />
        <MetricCard
          label={t("frictionPerDeal")}
          value={kpis.frictionsPerDeal}
          caption={t("frictionPerDealCaption")}
        />
      </section>

      <SectionHeader
        title={t("frictionRankingTitle")}
        description={t("frictionRankingDesc")}
      />
      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title={t("frictionRankingChart")}
          rawRows={filteredRows.filter((r) => r.insight_type === "deal_friction")}
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
        <ChartCard title={t("frictionBySize")}>
          <StackedBarChart
            data={frictionSegment.data}
            yKey="name"
            stackKeys={frictionSegment.stackKeys}
            height={Math.max(320, frictionSegment.data.length * 32)}
          />
        </ChartCard>
      </section>

      <ChartCard title={t("frictionBreakdown")}>
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
                <ul className="space-y-1 text-[12px] text-[var(--color-text-default)]">
                  {item.topSummaries.length === 0 ? (
                    <li className="text-[var(--color-text-secondary)]">(Sin datos de summary)</li>
                  ) : (
                    item.topSummaries.map((s, i) => (
                      <li key={i} className="leading-snug">
                        <span className="mr-1 text-[var(--color-text-secondary)]">•</span>
                        {s.text}
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))
          )}
        </div>
      </ChartCard>

      <section className="space-y-3">
        <ChartCard title={t("frictionByStage")}>
          <HeatMap
            rowLabels={stageHeat.rowLabels}
            colLabels={stageHeat.colLabels}
            values={stageHeat.values}
            height={Math.max(360, stageHeat.rowLabels.length * 32 + 140)}
          />
        </ChartCard>
        <ChartCard title={t("frictionByIndustry")}>
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

      {hasFaqs ? (
        <>
          <SectionHeader
            title={t("battleCards")}
            description={t("battleCardsDesc")}
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
                      <li key={i} className="leading-snug">
                        <span className="mr-1 text-[var(--color-text-secondary)]">•</span>
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
