"use client";

import { ArrowDownRight, ArrowUpRight, BadgeCheck, Sparkles } from "lucide-react";
import { parseAsBoolean, useQueryState } from "nuqs";

import { ChartCard } from "@/components/charts/ChartCard";
import { useFilterTransition } from "@/components/layout/FilterTransition";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { OverviewData } from "@/lib/data/overview-data";

type Props = {
  data: OverviewData;
  coveragePct: number;
  validated: boolean;
};

function ValidatedToggle({ validated }: { validated: boolean }) {
  const ctx = useFilterTransition();
  const [, setValidated] = useQueryState(
    "validated",
    parseAsBoolean.withOptions({ shallow: false, startTransition: ctx?.startTransition }),
  );
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] transition",
        validated
          ? "border-emerald-400 bg-emerald-50 text-emerald-700"
          : "border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] text-[var(--color-text-secondary)] hover:border-[var(--color-neutral-300)]",
      )}
      title="Mostrar solo demos validadas (first_meeting_status = Validated)"
    >
      <input
        type="checkbox"
        className="h-3.5 w-3.5"
        checked={validated}
        onChange={(e) => setValidated(e.target.checked ? true : null)}
      />
      <BadgeCheck size={14} />
      <span className="font-medium">Solo demos validadas</span>
    </label>
  );
}

function fmt(n: number): string {
  return n.toLocaleString("es-AR");
}

function DeltaBadge({ deltaPct }: { deltaPct: number | null }) {
  if (deltaPct == null) return <span className="text-[12px] text-[var(--color-text-secondary)]">—</span>;
  const up = deltaPct >= 0;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[13px] font-semibold ${
        up ? "text-emerald-700" : "text-rose-600"
      }`}
    >
      {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
      {Math.abs(deltaPct)}%
    </span>
  );
}

export function OverviewView({ data, coveragePct, validated }: Props) {
  const { kpis, recap, topPains, topFaqs, topIndustries, topSegments, wonLostPains, winRateBaseline } = data;
  const maxPain = topPains.reduce((m, p) => Math.max(m, p.pct), 0) || 1;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <PageTitle title="Overview" subtitle="Vista rápida de lo más relevante. Usá los filtros para acotar; el sidebar para profundizar." />
        <ValidatedToggle validated={validated} />
      </div>

      {/* Weekly recap */}
      <section className="rounded-[var(--radius-l)] border border-[var(--color-brand-200)] bg-gradient-to-b from-[var(--color-brand-50)] to-[var(--color-bg-card)] p-5">
        <div className="mb-3.5 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-default)]">
          <Sparkles size={16} className="text-[var(--color-brand-500)]" />
          Qué pasó esta semana
          <span className="rounded-full border border-[var(--color-brand-100)] bg-[var(--color-bg-card)] px-2 py-0.5 text-[11px] font-normal text-[var(--color-text-secondary)]">
            últimos {recap.windowDays} días · vs. promedio de las últimas {recap.baselineWeeks} semanas
          </span>
        </div>

        {/* Actividad contextualizada */}
        <div className="mb-4 flex flex-wrap gap-8">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[30px] font-semibold leading-none">{fmt(recap.activity.demosThisWeek)}</span>
              <DeltaBadge deltaPct={recap.activity.deltaPct} />
            </div>
            <div className="text-[12px] text-[var(--color-text-secondary)]">
              Demos · prom {fmt(recap.activity.avgWeeklyDemos)}/sem
            </div>
          </div>
          <div>
            <div className="text-[30px] font-semibold leading-none">{fmt(recap.activity.dealsThisWeek)}</div>
            <div className="text-[12px] text-[var(--color-text-secondary)]">
              Deals ·{" "}
              <span className="font-semibold text-emerald-700">
                {fmt(recap.activity.validatedDealsThisWeek)} validados
              </span>
              {recap.activity.dealsThisWeek > 0
                ? ` (${Math.round((recap.activity.validatedDealsThisWeek / recap.activity.dealsThisWeek) * 100)}%)`
                : ""}
              {" · "}
              <span className="font-semibold text-[var(--color-brand-500)]">
                {fmt(recap.activity.inboundDealsThisWeek)} inbound
              </span>
            </div>
          </div>
        </div>

        {/* Pains (pains) que cambiaron en importancia */}
        <div className="mb-1 text-[12px] font-semibold text-[var(--color-text-default)]">
          Pains que mencionan los prospectos
          <span className="ml-1.5 font-normal text-[var(--color-text-secondary)]">
            — % de demos que los mencionan, esta semana vs. promedio
          </span>
        </div>
        <div className="space-y-1.5 text-[13px]">
          <ShareLine
            label="📈 Más mencionados"
            tone="up"
            items={recap.gained.map((m) => `${m.name}: ${m.baselinePct}% → ${m.thisWeekPct}% (+${m.deltaPts} pts)`)}
            empty="nada se destacó"
          />
          <ShareLine
            label="📉 Menos mencionados"
            tone="down"
            items={recap.lost.map((m) => `${m.name}: ${m.baselinePct}% → ${m.thisWeekPct}% (${m.deltaPts} pts)`)}
            empty="nada cayó"
          />
        </div>

        {/* Competidores: más mencionados + en alza */}
        <div className="mt-3 mb-1 text-[12px] font-semibold text-[var(--color-text-default)]">
          Competidores mencionados en las demos
        </div>
        <div className="space-y-1.5 text-[13px]">
          <ShareLine
            label="🏆 Más mencionados"
            tone="new"
            items={recap.competitorTop.map((c) => `${c.name} (${c.value})`)}
            empty="sin menciones"
          />
          <ShareLine
            label="📈 En alza"
            tone="up"
            items={recap.competitorRisers.map((m) => `${m.name}: ${m.baselinePct}% → ${m.thisWeekPct}% (+${m.deltaPts} pts)`)}
            empty="ninguno creció"
          />
        </div>

        {/* Snapshot de la semana */}
        {recap.snapshotPains.length > 0 ? (
          <div className="mt-3 border-t border-[var(--color-brand-100)] pt-3">
            <div className="mb-1.5 text-[12px] font-semibold text-[var(--color-text-secondary)]">
              🔝 Pains más hablados esta semana (% de demos)
            </div>
            <div className="flex flex-wrap gap-x-2 gap-y-1.5 text-[13px]">
              {recap.snapshotPains.map((p) => (
                <span key={p.name} className="rounded-full bg-[var(--color-bg-card)] border border-[var(--color-brand-100)] px-2 py-0.5">
                  {p.name} <span className="font-semibold">{p.pct}%</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* KPIs */}
      <section className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="Calls analizadas" value={fmt(kpis.uniqueCalls)} caption={`${coveragePct.toFixed(1)}% del período`} />
        <MetricCard label="Deals" value={fmt(kpis.uniqueDeals)} caption="con insight" />
        <MetricCard label="Insights" value={fmt(kpis.insightsCount)} />
        <MetricCard
          label="Confianza prom."
          value={kpis.avgConfidence != null ? kpis.avgConfidence.toFixed(2) : "—"}
          caption={kpis.highConfidencePct != null ? `${kpis.highConfidencePct.toFixed(0)}% alta` : undefined}
        />
        <MetricCard
          label="Período"
          value={kpis.periodEnd ?? "—"}
          caption={kpis.periodStart ? `desde ${kpis.periodStart}` : undefined}
        />
      </section>

      {/* Top 5 pains + FAQs */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Pains principales">
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">% de demos donde se mencionó</p>
          <div className="space-y-2.5">
            {topPains.length === 0 ? (
              <p className="text-[13px] text-[var(--color-text-secondary)]">Sin datos.</p>
            ) : (
              topPains.map((p) => (
                <div key={p.name} className="grid grid-cols-[1fr_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 truncate text-[13px]">{p.name}</div>
                    <div className="h-[7px] overflow-hidden rounded-full bg-[var(--color-neutral-100)]">
                      <div
                        className="h-full rounded-full bg-[var(--color-brand-500)]"
                        style={{ width: `${(p.pct / maxPain) * 100}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums">{p.pct.toFixed(1)}%</span>
                </div>
              ))
            )}
          </div>
        </ChartCard>

        <ChartCard title="Preguntas frecuentes">
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">por cantidad de demos</p>
          <TopList rows={topFaqs} />
        </ChartCard>
      </section>

      {/* Win-rate por pain */}
      {wonLostPains.length > 0 ? (
        <ChartCard title="Win-rate por pain">
          <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
            De los deals <b>cerrados</b> donde apareció cada pain, qué % ganamos.
            Comparado con el win-rate general (<b>{winRateBaseline}%</b>):
            por encima 🟢 = ese dolor acompaña deals que cerramos · por debajo 🔴 = ojo.
          </p>
          <Table>
            <Thead>
              <Tr>
                <Th>Pain</Th>
                <Th>Deals cerrados</Th>
                <Th>Win-rate</Th>
                <Th>vs. general</Th>
              </Tr>
            </Thead>
            <Tbody>
              {wonLostPains.map((p) => {
                const diff = Math.round((p.winRate - winRateBaseline) * 10) / 10;
                const above = diff >= 0;
                return (
                  <Tr key={p.name}>
                    <Td>{p.name}</Td>
                    <Td className="tabular-nums text-[var(--color-text-secondary)]">{fmt(p.closed)}</Td>
                    <Td className={`font-semibold tabular-nums ${above ? "text-emerald-700" : "text-rose-600"}`}>
                      {p.winRate}%
                    </Td>
                    <Td className="tabular-nums">
                      {above ? "🟢 +" : "🔴 "}{diff} pts
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </ChartCard>
      ) : null}

      {/* Industrias + segmentos */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Industrias">
          <TopList rows={topIndustries} />
        </ChartCard>
        <ChartCard title="Segmentos">
          <TopList rows={topSegments} />
        </ChartCard>
      </section>
    </div>
  );
}

function ShareLine({
  label,
  items,
  tone,
  empty,
}: {
  label: string;
  items: string[];
  tone: "up" | "down" | "new";
  empty: string;
}) {
  const toneClass =
    tone === "up"
      ? "bg-emerald-50 text-emerald-700"
      : tone === "down"
        ? "bg-rose-50 text-rose-600"
        : "bg-amber-50 text-amber-700";
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
      <span className="inline-block w-[120px] shrink-0 text-[var(--color-text-secondary)]">{label}</span>
      {items.length === 0 ? (
        <span className="text-[12px] text-[var(--color-text-secondary)]">{empty}</span>
      ) : (
        items.map((it) => (
          <span key={it} className={`rounded-full px-2 py-0.5 text-[12px] ${toneClass}`}>
            {it}
          </span>
        ))
      )}
    </div>
  );
}

function TopList({ rows }: { rows: Array<{ name: string; value: number }> }) {
  if (rows.length === 0) {
    return <p className="text-[13px] text-[var(--color-text-secondary)]">Sin datos.</p>;
  }
  return (
    <Table>
      <Thead>
        <Tr>
          <Th>Nombre</Th>
          <Th>Demos</Th>
        </Tr>
      </Thead>
      <Tbody>
        {rows.map((r) => (
          <Tr key={r.name}>
            <Td>{r.name}</Td>
            <Td className="font-semibold tabular-nums">{fmt(r.value)}</Td>
          </Tr>
        ))}
      </Tbody>
    </Table>
  );
}
