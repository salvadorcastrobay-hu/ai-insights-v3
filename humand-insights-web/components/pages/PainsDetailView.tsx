"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { CategoryPieChart } from "@/components/charts/PieChart";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageTitle } from "@/components/pages/common";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { FUNNEL_PHASE_COLOR, FUNNEL_PHASE_DISPLAY } from "@/lib/data/normalizers";
import type { PainsDetailData } from "@/lib/data/pains-detail-data";

type Props = { data: PainsDetailData; filteredRows: import("@/lib/supabase/types").InsightRow[] };

export function PainsDetailView({ data, filteredRows }: Props) {
  const {
    kpis,
    byModule,
    themeStatusHeat,
    phaseSummary,
    topPainsByPhase,
    themes,
    modules,
    painTableRows,
  } = data;

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
          rawRows={filteredRows.filter((r) => r.insight_type === "pain")}
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
      {kpis.withPhase > 0 ? (
        <section className="space-y-3">
          <PageTitle
            title="Pains × Funnel Phase"
            subtitle="¿En qué momento del journey aparece cada pain? Pre-venta, cerrado o post-venta."
          />

          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-1">
              <ChartCard title="Distribución de deals con pain por phase">
                <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
                  Cantidad de deals únicos con al menos un pain, agrupados por phase del journey.
                </p>
                <CategoryPieChart data={phaseSummary} height={300} exportFileName="pains-by-phase.csv" />
              </ChartCard>
            </div>

            <div className="lg:col-span-2">
              <ChartCard title="Top pains, distribución por phase">
                <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
                  Top {topPainsByPhase.length} pains por volumen total. Cada barra muestra cuántos
                  deals únicos lo mencionaron, desglosado por phase del funnel.
                </p>
                <StackedBarChart
                  data={topPainsByPhase.map((r) => ({
                    pain: r.pain,
                    [FUNNEL_PHASE_DISPLAY.pre_sale]: r.pre_sale,
                    [FUNNEL_PHASE_DISPLAY.closed]: r.closed,
                    [FUNNEL_PHASE_DISPLAY.post_sale]: r.post_sale,
                  }))}
                  yKey="pain"
                  stackKeys={[
                    FUNNEL_PHASE_DISPLAY.pre_sale,
                    FUNNEL_PHASE_DISPLAY.closed,
                    FUNNEL_PHASE_DISPLAY.post_sale,
                  ]}
                  colorMap={{
                    [FUNNEL_PHASE_DISPLAY.pre_sale]: FUNNEL_PHASE_COLOR.pre_sale,
                    [FUNNEL_PHASE_DISPLAY.closed]: FUNNEL_PHASE_COLOR.closed,
                    [FUNNEL_PHASE_DISPLAY.post_sale]: FUNNEL_PHASE_COLOR.post_sale,
                  }}
                  exportFileName="pains-by-phase-stacked.csv"
                />
              </ChartCard>
            </div>
          </div>

          <p className="text-[12px] text-[var(--color-text-secondary)]">
            Phase derivada del <code>deal_stage</code> en HubSpot. <strong>Pre-venta</strong>:
            lead → final negotiation. <strong>Cerrado</strong>: won / lost / postponed.{" "}
            <strong>Post-venta</strong>: onboarding churned / red list / churned. Deals sin stage
            asignado no se incluyen.
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
