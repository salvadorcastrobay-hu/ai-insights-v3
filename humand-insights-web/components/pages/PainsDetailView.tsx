"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageTitle } from "@/components/pages/common";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import type { PainsDetailData } from "@/lib/data/pains-detail-data";

type Props = { data: PainsDetailData; filteredRows: import("@/lib/supabase/types").InsightRow[] };

export function PainsDetailView({ data, filteredRows }: Props) {
  const {
    kpis,
    byModule,
    themeStatusHeat,
    phaseSummary,
    topPainsByPhase,
    painsByOutcome,
    themes,
    modules,
    painTableRows,
  } = data;
  const phaseTotal = phaseSummary.pre_sale + phaseSummary.closed + phaseSummary.post_sale;
  const pct = (n: number) => (phaseTotal > 0 ? `${Math.round((n / phaseTotal) * 100)}%` : "0%");
  const ratePct = (n: number) => `${Math.round(n * 100)}%`;

  const [theme, setTheme] = useState("");
  const [module, setModule] = useState("");
  const [search, setSearch] = useState("");

  const tableRows = useMemo(() => {
    return painTableRows.filter((row) => {
      if (theme && row.pain_theme !== theme) return false;
      if (module && row.module_display !== module) return false;
      if (search) {
        const blob = `${row.summary} ${row.verbatim_quote ?? ""} ${row.insight_subtype_display}`.toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [painTableRows, theme, module, search]);

  const pctGeneral = kpis.total > 0 ? Math.round((kpis.generales / kpis.total) * 100) : 0;
  const pctLinked = kpis.total > 0 ? Math.round((kpis.vinculados / kpis.total) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageTitle title="Pains — Detalle" subtitle="Detalle de pains con distribución por módulo y estado." />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total Pains" value={kpis.total} caption={`${kpis.total > 0 ? "total detectados" : "sin datos"}`} />
        <MetricCard label="Generales" value={kpis.generales} caption={`${pctGeneral}% del total · sin módulo asociado`} />
        <MetricCard label="Vinculados a Módulo" value={kpis.vinculados} caption={`${pctLinked}% del total · señal accionable`} />
      </section>

      <p className="text-[12px] text-[var(--color-text-secondary)]">
        El total de pains refleja todos los registros históricos del recorte actual. El Executive
        Summary puede mostrar un número menor si aplica filtros de período por defecto.
      </p>

      <section className="space-y-3">
        <ChartCard
          title="¿En qué módulos se concentran más problemas?"
          rawRows={filteredRows}
          ask={{
            chartTitle: "Pains por módulo",
            chartKind: "horizontal-bar",
            description: "Top módulos por deals únicos con al menos un pain vinculado.",
            dimension: "module_display",
            scopeType: "pain",
            rows: byModule.map((r) => ({ label: r.name, value: r.value })),
          }}
        >
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            Deals únicos donde se detectó al menos un pain vinculado a este módulo. Ayuda a
            priorizar foco por módulo de producto.
          </p>
          <HorizontalBarChart data={byModule} height={360} />
        </ChartCard>
        <ChartCard title="Pains: Theme × Status del Módulo">
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            El porcentaje de pains en módulos existentes revela si el problema es de roadmap o de
            propuesta de valor y UX dentro de los módulos actuales.
          </p>
          <HeatMap rowLabels={themeStatusHeat.rowLabels} colLabels={themeStatusHeat.colLabels} values={themeStatusHeat.values} height={Math.max(480, themeStatusHeat.rowLabels.length * 46 + 140)} />
        </ChartCard>
      </section>

      {/* ─── Funnel phase cross-reference ─────────────────────────────── */}
      {phaseTotal > 0 ? (
        <section className="space-y-3">
          <PageTitle
            title="Estado actual de los deals con pain"
            subtitle="¿En qué phase del funnel están hoy los deals donde se detectó al menos un pain?"
          />

          <div className="grid gap-3 md:grid-cols-3">
            <MetricCard
              label="Pre-venta"
              value={phaseSummary.pre_sale}
              caption={`${pct(phaseSummary.pre_sale)} del total · Deals activos (lead → final negotiation)`}
            />
            <MetricCard
              label="Cerrado"
              value={phaseSummary.closed}
              caption={`${pct(phaseSummary.closed)} del total · Won, lost o postponed`}
            />
            <MetricCard
              label="Post-venta"
              value={phaseSummary.post_sale}
              caption={`${pct(phaseSummary.post_sale)} del total · Onboarding churned, red list, churned`}
            />
          </div>

          {topPainsByPhase.length > 0 ? (
            <ChartCard title="Top pains, distribución por phase">
              <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
                Top {topPainsByPhase.length} pains por volumen total. Cada barra muestra cuántos
                deals únicos lo mencionaron, desglosado por phase del funnel. Útil para detectar
                si un pain es objeción de venta, crónico (sigue post-deal), o de adopción.
              </p>
              <StackedBarChart
                data={topPainsByPhase.map((r) => ({
                  pain: r.pain,
                  "Pre-venta": r.pre_sale,
                  Cerrado: r.closed,
                  "Post-venta": r.post_sale,
                }))}
                yKey="pain"
                stackKeys={["Pre-venta", "Cerrado", "Post-venta"]}
                colorMap={{
                  "Pre-venta": "#5B7CFA",
                  Cerrado: "#94A3B8",
                  "Post-venta": "#F59E0B",
                }}
                exportFileName="pains-by-phase-stacked.csv"
              />
            </ChartCard>
          ) : null}

          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Phase derivada del <code>deal_stage</code> en HubSpot. Solo cuenta deals únicos con
            al menos un pain detectado.
          </p>
        </section>
      ) : null}

      {/* ─── Pains × Outcome (Won vs Lost) ─────────────────────────────── */}
      {painsByOutcome.length > 0 ? (
        <section className="space-y-3">
          <PageTitle
            title="Pains × Outcome"
            subtitle="¿Qué pains se asocian a deals ganados vs perdidos? (mínimo 5 deals cerrados)"
          />

          <ChartCard title="Win-rate y lost-rate por pain">
            <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
              Para cada pain, % de deals con ese pain que terminaron en Won vs Lost.
              <span className="ml-2 inline-block rounded bg-green-100 px-1.5 text-green-800">🟢 Win-rate &gt; 60%</span>
              <span className="ml-1 inline-block rounded bg-amber-100 px-1.5 text-amber-800">⚠ Lost-rate &gt; 55%</span>
              <span className="ml-1 inline-block rounded bg-red-100 px-1.5 text-red-800">🔴 Lost-rate &gt; 70%</span>
            </p>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Pain</Th>
                    <Th>Won</Th>
                    <Th>Lost</Th>
                    <Th>Cerrados</Th>
                    <Th>Win-rate</Th>
                    <Th>Lost-rate</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {painsByOutcome.map((row) => {
                    const isDealKiller = row.lost_rate > 0.7;
                    const isFriction = !isDealKiller && row.lost_rate > 0.55;
                    const isResonant = row.win_rate > 0.6;
                    return (
                      <Tr key={row.pain}>
                        <Td>
                          {isDealKiller ? "🔴 " : isFriction ? "⚠ " : isResonant ? "🟢 " : ""}
                          {row.pain}
                        </Td>
                        <Td>{row.won}</Td>
                        <Td>{row.lost}</Td>
                        <Td>{row.closed_total}</Td>
                        <Td>{ratePct(row.win_rate)}</Td>
                        <Td>{ratePct(row.lost_rate)}</Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </Table>
            </div>
          </ChartCard>

          <p className="text-[12px] text-[var(--color-text-secondary)]">
            <strong>Marketing:</strong> pains 🟢 son donde el messaging funciona — produciles más contenido.
            {" "}
            <strong>Sales:</strong> pains ⚠ y 🔴 necesitan battlecards y objection handling más fuertes.
            Outcome usa <code>deal_stage</code> de HubSpot: Won = ganado, Lost / Postponed = perdido.
          </p>
        </section>
      ) : null}

      <ChartCard title="Detalle por pain">
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="">Todos los themes</option>
            {themes.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={module} onChange={(e) => setModule(e.target.value)}>
            <option value="">Todos los módulos</option>
            {modules.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
          <Input placeholder="Buscar pain..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <div className="max-h-[420px] overflow-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Pain</Th>
                <Th>Theme</Th>
                <Th>Module</Th>
                <Th>Segment</Th>
                <Th>Company</Th>
                <Th>Summary</Th>
                <Th>Quote</Th>
              </Tr>
            </Thead>
            <Tbody>
              {tableRows.map((row) => (
                <Tr key={row.id}>
                  <Td>{row.insight_subtype_display}</Td>
                  <Td>{row.pain_theme}</Td>
                  <Td>{row.module_display}</Td>
                  <Td>{row.segment}</Td>
                  <Td>{row.company_name}</Td>
                  <Td>{row.summary}</Td>
                  <Td>{row.verbatim_quote}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
}
