"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { TrendLineChart } from "@/components/charts/LineChart";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import {
  COMPARE_BY_OPTIONS,
  METRICS,
  type CompareByKey,
  type ComparativeAnalysisData,
  type MetricName,
} from "@/lib/data/comparative-analysis-data";

const DISPLAY_MODES = ["Volumen", "%", "Delta absoluto", "Delta %"] as const;
type DisplayMode = (typeof DISPLAY_MODES)[number];
type PeriodRow = { month: string; value: number };
type CategoryRow = { name: string; value: number };

type Props = { data: ComparativeAnalysisData };

export function ComparativeAnalysisView({ data }: Props) {
  const [compareBy, setCompareBy] = useState<CompareByKey>("periods");
  const [metric, setMetric] = useState<MetricName>("Menciones");
  const [displayMode, setDisplayMode] = useState<DisplayMode>("Volumen");
  const [facetA, setFacetA] = useState("");
  const [facetB, setFacetB] = useState("");
  const isPeriods = compareBy === "periods";

  const periodData: PeriodRow[] = useMemo(() => {
    return data.periods.map((row) => ({ month: row.month, value: Number(row[metric]) }));
  }, [data.periods, metric]);

  const categoricalData: CategoryRow[] = useMemo(() => {
    if (isPeriods) return [];
    const facetKey = compareBy as Exclude<CompareByKey, "periods">;
    const facetRows = data.byFacet[facetKey] ?? [];
    return facetRows
      .map((row) => ({ name: row.name, value: Number(row[metric]) }))
      .sort((a, b) => b.value - a.value);
  }, [data.byFacet, compareBy, metric, isPeriods]);

  const facets = useMemo(() => categoricalData.map((row) => row.name), [categoricalData]);

  const delta = useMemo(() => {
    if (!facetA || !facetB || isPeriods) return null;
    const a = categoricalData.find((item) => item.name === facetA)?.value ?? 0;
    const b = categoricalData.find((item) => item.name === facetB)?.value ?? 0;
    const abs = a - b;
    const pct = b !== 0 ? ((a - b) / b) * 100 : 0;
    return { a, b, abs, pct };
  }, [categoricalData, isPeriods, facetA, facetB]);

  const displayData = useMemo(() => {
    if (isPeriods) return periodData;

    if (displayMode === "%") {
      const total = categoricalData.reduce((acc, row) => acc + Number(row.value), 0);
      return categoricalData.map((row) => ({ name: row.name, value: total > 0 ? (Number(row.value) / total) * 100 : 0 }));
    }

    if (displayMode === "Delta absoluto" && facetB) {
      const base = categoricalData.find((row) => row.name === facetB)?.value ?? 0;
      return categoricalData.map((row) => ({ name: row.name, value: Number(row.value) - Number(base) }));
    }

    if (displayMode === "Delta %" && facetB) {
      const base = categoricalData.find((row) => row.name === facetB)?.value ?? 0;
      return categoricalData.map((row) => ({
        name: row.name,
        value: base !== 0 ? ((Number(row.value) - Number(base)) / Number(base)) * 100 : 0,
      }));
    }

    return categoricalData.map((row) => ({ name: row.name, value: Number(row.value) }));
  }, [isPeriods, periodData, categoricalData, displayMode, facetB]);

  return (
    <div className="space-y-6">
      <PageTitle title="Comparative Analysis" subtitle="Compará señales por períodos, región, segmento o industria." />

      <SectionHeader title="Configurar comparación" description="Elegí el eje de comparación, la métrica y el modo de lectura." />
      <ChartCard title="Configuración">
        <div className="grid gap-2 md:grid-cols-4">
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={compareBy} onChange={(e) => setCompareBy(e.target.value as CompareByKey)}>
            {COMPARE_BY_OPTIONS.map((option) => (<option key={option.key} value={option.key}>{option.label}</option>))}
          </select>
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={metric} onChange={(e) => setMetric(e.target.value as MetricName)}>
            {METRICS.map((option) => (<option key={option} value={option}>{option}</option>))}
          </select>
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={displayMode} onChange={(e) => setDisplayMode(e.target.value as DisplayMode)}>
            {DISPLAY_MODES.map((option) => (<option key={option} value={option}>{option}</option>))}
          </select>
          {compareBy !== "periods" ? (
            <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={facetB} onChange={(e) => setFacetB(e.target.value)}>
              <option value="">Base (delta)</option>
              {facets.map((option) => (<option key={option} value={option}>{option}</option>))}
            </select>
          ) : null}
        </div>
      </ChartCard>

      {compareBy !== "periods" ? (
        <section className="grid gap-3 md:grid-cols-2">
          <label className="text-[12px]">Lado A
            <select className="mt-1 w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={facetA} onChange={(e) => setFacetA(e.target.value)}>
              <option value="">Seleccionar</option>
              {facets.map((option) => (<option key={option} value={option}>{option}</option>))}
            </select>
          </label>
          <label className="text-[12px]">Lado B
            <select className="mt-1 w-full rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={facetB} onChange={(e) => setFacetB(e.target.value)}>
              <option value="">Seleccionar</option>
              {facets.map((option) => (<option key={option} value={option}>{option}</option>))}
            </select>
          </label>
        </section>
      ) : null}

      {delta ? (
        <section className="grid gap-3 md:grid-cols-4">
          <MetricCard label={`${facetA} (${metric})`} value={delta.a.toFixed(2)} />
          <MetricCard label={`${facetB} (${metric})`} value={delta.b.toFixed(2)} />
          <MetricCard label="Delta absoluto" value={delta.abs.toFixed(2)} />
          <MetricCard label="Delta %" value={`${delta.pct.toFixed(1)}%`} />
        </section>
      ) : null}

      <SectionHeader title="Comparativa" description={isPeriods ? "Evolución temporal de la métrica seleccionada." : `Lectura: ${displayMode}. Usá Base (delta) para fijar un referente.`} />
      <ChartCard title="Comparativa">
        {isPeriods ? (
          <TrendLineChart data={(displayData as PeriodRow[]).map((row) => ({ month: row.month, [metric]: Number(row.value) }))} seriesKeys={[metric]} />
        ) : (
          <HorizontalBarChart data={(displayData as CategoryRow[]).map((row) => ({ name: row.name, value: Number(row.value) }))} height={460} />
        )}
      </ChartCard>

      <SectionHeader title="Detalle de comparación" description="Tabla de valores utilizados por el gráfico arriba." />
      <ChartCard title="Tabla">
        <Table>
          <Thead>
            <Tr><Th>Facet</Th><Th>Value</Th></Tr>
          </Thead>
          <Tbody>
            {displayData.map((row) => (
              <Tr key={String(("name" in row ? row.name : row.month) ?? "")}>
                <Td>{String("name" in row ? row.name : row.month)}</Td>
                <Td>{Number(row.value).toFixed(2)}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </ChartCard>
    </div>
  );
}
