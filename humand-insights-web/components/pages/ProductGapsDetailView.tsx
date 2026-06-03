"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { useDrillDown } from "@/components/drill-down/DrillDownProvider";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { PageTitle } from "@/components/pages/common";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import type { ProductGapsDetailData } from "@/lib/data/product-gaps-detail-data";
import type { InsightRow } from "@/lib/supabase/types";

type Props = { data: ProductGapsDetailData; filteredRows: InsightRow[] };

const PRIORITY_COLORS: Record<string, string> = {
  "⚠️ Must Have": "#E53E3E",
  "💡 Nice to Have": "#D69E2E",
  "🚫 Dealbreaker": "#9B2335",
};

export function ProductGapsDetailView({ data, filteredRows }: Props) {
  const { open: drill } = useDrillDown();
  const {
    kpis,
    topFeatures,
    prioritySummary,
    segmentPriority,
    featureSegmentHeatmap,
    moduleStatus,
    existingModulePct,
    priorityLabelByKey,
    gapTableRows,
  } = data;

  const [priority, setPriority] = useState("");
  const [module, setModule] = useState("");
  const [search, setSearch] = useState("");

  const filtered = useMemo(
    () =>
      gapTableRows.filter((row) => {
        if (priority && row.gap_priority !== priority) return false;
        if (module && row.module_display !== module) return false;
        if (search) {
          const blob = `${row.summary ?? ""} ${row.gap_description ?? ""}`.toLowerCase();
          if (!blob.includes(search.toLowerCase())) return false;
        }
        return true;
      }),
    [gapTableRows, priority, module, search],
  );

  const moduleOptions = useMemo(
    () => [...new Set(gapTableRows.map((r) => r.module_display).filter(Boolean))] as string[],
    [gapTableRows],
  );

  const priorityOptions = useMemo(
    () => [...new Set(gapTableRows.map((r) => r.gap_priority).filter(Boolean))] as string[],
    [gapTableRows],
  );

  // Topfeatures data with priority tag prepended for display
  const topFeaturesDisplay = topFeatures.map((row) => ({
    name: row.priorityTag ? `${row.priorityTag} ${row.name}` : row.name,
    value: row.value,
    rawName: row.name,
  }));

  // Segment priority stack
  const segmentPriorityChart = segmentPriority.rows.map((row) => {
    const entry: Record<string, string | number> = { name: row.segment };
    for (const label of segmentPriority.priorityLabels) {
      entry[label] = row.pcts[label] ?? 0;
    }
    return entry;
  });

  return (
    <div className="space-y-6">
      <PageTitle title="Product Gaps — Detalle" subtitle="Priorización de gaps, revenue en riesgo y señales por segmento." />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Total Detecciones de Gaps"
          value={kpis.total}
          caption={`en ${kpis.distinctDeals} demos · ${kpis.perDemo} gaps por demo`}
        />
        <MetricCard
          label="Features en Taxonomía"
          value={kpis.inTaxonomy}
          caption="seeds definidos previamente por el equipo"
        />
        <MetricCard
          label="Features Nuevas Detectadas"
          value={kpis.newFeatures}
          caption="detectadas por el modelo · revisar para ampliar taxonomía"
        />
      </section>

      <SectionHeader
        title="Top 20 Features Faltantes"
        description="Ordenado por deals únicos que mencionaron la feature. El emoji indica la prioridad dominante."
      />
      <ChartCard
        rawRows={filteredRows.filter((r) => r.insight_type === "product_gap")}
        ask={{
          chartTitle: "Top 20 features faltantes",
          chartKind: "horizontal-bar",
          description: "Features ordenadas por deals únicos; el emoji indica prioridad dominante.",
          dimension: "feature_display",
          scopeType: "product_gap",
          rows: topFeaturesDisplay.map((r) => ({ label: r.rawName, value: r.value })),
        }}
      >
        <HorizontalBarChart
          data={topFeaturesDisplay}
          height={Math.max(520, topFeaturesDisplay.length * 30 + 60)}
          yAxisWidth={260}
          onBarClick={(row) =>
            drill({
              dimension: "feature_display",
              value: String((row as { rawName?: string }).rawName ?? row.name),
              scopeType: "product_gap",
            })
          }
        />
      </ChartCard>

      <SectionHeader
        title="Distribución por Prioridad"
        description="Revenue en Riesgo = suma del amount de los deals únicos que mencionaron este tipo de gap."
      />
      <ChartCard>
        <Table>
          <Thead>
            <Tr>
              <Th>Prioridad</Th>
              <Th>Detecciones</Th>
              <Th>% del Total</Th>
              <Th>Revenue en Riesgo</Th>
              <Th>Qué significa</Th>
            </Tr>
          </Thead>
          <Tbody>
            {prioritySummary.map((row) => (
              <Tr
                key={row.key}
                className={row.key === "dealbreaker" ? "bg-[#fff0f0]" : ""}
              >
                <Td className="font-semibold">{row.label}</Td>
                <Td>{row.detections}</Td>
                <Td>{row.pct}</Td>
                <Td>{row.revenueAtRisk}</Td>
                <Td className="text-[12px] text-[var(--color-text-secondary)]">{row.meaning}</Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
        <p className="mt-2 text-[12px] text-[var(--color-text-secondary)]">
          Los Dealbreakers son el número más accionable de esta página. Representan features cuya
          ausencia fue razón de no avanzar.
        </p>
      </ChartCard>

      <SectionHeader
        title="Prioridad de Gaps por Segmento (%)"
        description="Distribución relativa de las prioridades dentro de cada segmento. Lectura normalizada por volumen de gaps."
      />
      <ChartCard>
        {segmentPriorityChart.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Sin datos suficientes.</p>
        ) : (
          <StackedBarChart
            data={segmentPriorityChart}
            yKey="name"
            stackKeys={segmentPriority.priorityLabels}
            colorMap={PRIORITY_COLORS}
            xTickSuffix="%"
            height={Math.max(280, segmentPriorityChart.length * 44)}
          />
        )}
      </ChartCard>

      <SectionHeader
        title="Feature Gaps por Segmento (Top 15)"
        description="Porcentaje de deals del segmento que mencionaron cada feature gap. Entre paréntesis, los deals absolutos."
      />
      <ChartCard>
        {featureSegmentHeatmap.rowLabels.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Sin datos suficientes.</p>
        ) : (
          <HeatMap
            rowLabels={featureSegmentHeatmap.rowLabels}
            colLabels={featureSegmentHeatmap.colLabels}
            values={featureSegmentHeatmap.values}
            valueFormat={(v) => (v > 0 ? `${v.toFixed(1)}%` : "")}
            height={Math.max(520, featureSegmentHeatmap.rowLabels.length * 36 + 140)}
          />
        )}
      </ChartCard>

      <SectionHeader
        title="Módulos: Existentes vs. Faltantes"
        description={`El ${existingModulePct}% de los feature gaps son en módulos que YA EXISTEN en Humand. El problema es de profundidad funcional, no de cobertura.`}
      />
      <ChartCard>
        {moduleStatus.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Sin datos de module_status.</p>
        ) : (
          <HorizontalBarChart
            data={moduleStatus.map((r) => ({ name: `${r.name} (${r.pct}%)`, value: r.value }))}
            height={Math.max(200, moduleStatus.length * 60)}
            multicolor
          />
        )}
      </ChartCard>

      <SectionHeader
        title="Detalle de Gaps"
        description="Filtrá por prioridad para aislar los Dealbreakers. Las filas rojas corresponden a gaps tipo dealbreaker."
      />
      <ChartCard>
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <select
            className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
          >
            <option value="">Todas las prioridades</option>
            {priorityOptions.map((option) => (
              <option key={option} value={option}>
                {priorityLabelByKey[option] ?? option}
              </option>
            ))}
          </select>
          <select
            className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2"
            value={module}
            onChange={(e) => setModule(e.target.value)}
          >
            <option value="">Todos los módulos</option>
            {moduleOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <Input
            placeholder="Buscar en resumen..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-[480px] overflow-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>Empresa</Th>
                <Th>Feature</Th>
                <Th>Módulo</Th>
                <Th>Prioridad</Th>
                <Th>Segmento</Th>
                <Th>País</Th>
                <Th>Etapa</Th>
                <Th>AE</Th>
                <Th>Conf.</Th>
                <Th>Resumen</Th>
              </Tr>
            </Thead>
            <Tbody>
              {filtered.map((row) => (
                <Tr
                  key={row.id}
                  className={row.isDealbreaker ? "bg-[#fff0f0]" : ""}
                >
                  <Td>{row.company_name}</Td>
                  <Td>{row.feature_display}</Td>
                  <Td>{row.module_display}</Td>
                  <Td>{row.gap_priority_display}</Td>
                  <Td>{row.segment}</Td>
                  <Td>{row.country}</Td>
                  <Td>{row.deal_stage}</Td>
                  <Td>{row.deal_owner}</Td>
                  <Td><ConfidenceBadge value={row.confidence} /></Td>
                  <Td>{row.summary ?? row.gap_description}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
}
