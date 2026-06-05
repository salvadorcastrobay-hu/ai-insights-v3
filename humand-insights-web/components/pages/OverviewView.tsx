"use client";

import { ArrowDownRight, ArrowUpRight, Sparkles } from "lucide-react";

import { ChartCard } from "@/components/charts/ChartCard";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import type { OverviewData } from "@/lib/data/overview-data";

type Props = {
  data: OverviewData;
  coveragePct: number;
};

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

export function OverviewView({ data, coveragePct }: Props) {
  const { kpis, recap, topPains, topFaqs, topIndustries, topSegments } = data;
  const maxPain = topPains.reduce((m, p) => Math.max(m, p.pct), 0) || 1;

  return (
    <div className="space-y-5">
      <PageTitle title="Overview" subtitle="Vista rápida de lo más relevante. Usá los filtros para acotar; el sidebar para profundizar." />

      {/* Weekly recap */}
      <section className="rounded-[var(--radius-l)] border border-[var(--color-brand-200)] bg-gradient-to-b from-[var(--color-brand-50)] to-[var(--color-bg-card)] p-5">
        <div className="mb-3.5 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-text-default)]">
          <Sparkles size={16} className="text-[var(--color-brand-500)]" />
          Qué pasó esta semana
          <span className="rounded-full border border-[var(--color-brand-100)] bg-[var(--color-bg-card)] px-2 py-0.5 text-[11px] font-normal text-[var(--color-text-secondary)]">
            últimos {recap.windowDays} días · vs. {recap.windowDays} días previos
          </span>
        </div>

        <div className="mb-4 flex flex-wrap gap-8">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[30px] font-semibold leading-none">{fmt(recap.demos.current)}</span>
              <DeltaBadge deltaPct={recap.demos.deltaPct} />
            </div>
            <div className="text-[12px] text-[var(--color-text-secondary)]">Demos</div>
          </div>
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-[30px] font-semibold leading-none">{fmt(recap.deals.current)}</span>
              <DeltaBadge deltaPct={recap.deals.deltaPct} />
            </div>
            <div className="text-[12px] text-[var(--color-text-secondary)]">Deals nuevos</div>
          </div>
        </div>

        <div className="space-y-1.5 text-[13px]">
          <RecapLine label="▲ Subieron" tone="up" items={recap.risers.map((r) => `${r.name} +${r.delta}`)} empty="sin cambios" />
          <RecapLine label="▼ Bajaron" tone="down" items={recap.fallers.map((r) => `${r.name} ${r.delta}`)} empty="sin cambios" />
          <RecapLine label="⚔ Competidores top" tone="new" items={recap.topCompetitors} empty="sin menciones" />
        </div>
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
        <ChartCard title="Top 5 Pains">
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">% de demos donde apareció</p>
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

        <ChartCard title="Top 5 Preguntas (FAQ)">
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">por cantidad de demos</p>
          <TopList rows={topFaqs} />
        </ChartCard>
      </section>

      {/* Top 5 industrias + segmentos */}
      <section className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Top 5 Industrias">
          <TopList rows={topIndustries} />
        </ChartCard>
        <ChartCard title="Top 5 Segmentos">
          <TopList rows={topSegments} />
        </ChartCard>
      </section>
    </div>
  );
}

function RecapLine({
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
