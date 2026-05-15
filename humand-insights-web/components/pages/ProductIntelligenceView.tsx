"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { formatCurrency } from "@/lib/data/computations";
import type { ProductIntelligenceData } from "@/lib/data/product-intelligence-data";

type Props = { data: ProductIntelligenceData; filteredRows: import("@/lib/supabase/types").InsightRow[] };

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[12px] leading-[1.5] text-[var(--color-text-secondary)]">{children}</p>
  );
}

function SelectBox({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-[12px] text-[var(--color-text-secondary)]">
      <span>{label}</span>
      <select
        className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-white p-2 text-[13px] text-[var(--color-text-default)]"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ProductIntelligenceView({ data, filteredRows }: Props) {
  const {
    topPains,
    painThemeBreakdown,
    painSegmentHeat,
    painIndustryStack,
    moduleSegmentStack,
    featureFreq,
    featureRevenue,
    featureSegmentStack,
    priorities,
    gapsCount,
    painDetailByPain,
    gapDetailByFeature,
  } = data;

  const painOptions = useMemo(() => Object.keys(painDetailByPain), [painDetailByPain]);
  const gapOptions = useMemo(() => Object.keys(gapDetailByFeature), [gapDetailByFeature]);

  const [selectedPain, setSelectedPain] = useState<string>(painOptions[0] ?? "");
  const [selectedFeature, setSelectedFeature] = useState<string>(gapOptions[0] ?? "");

  const painRows = selectedPain ? painDetailByPain[selectedPain] ?? [] : [];
  const gapRows = selectedFeature ? gapDetailByFeature[selectedFeature] ?? [] : [];

  return (
    <div className="space-y-8">
      <PageTitle
        title="Product Intelligence"
        subtitle="Pains, módulos buscados y gaps de producto en la primera demo."
      />

      <div className="space-y-4">
        <SectionHeader
          title="¿Con qué problemas llegan los prospects?"
          description="Top pains por demos únicas, con desglose por tema y por segmento."
        />
        <ChartCard
          title="Top 15 Pains (demos únicas)"
          rawRows={filteredRows.filter((r) => r.insight_type === "pain")}
          ask={{
            chartTitle: "Top 15 Pains",
            chartKind: "horizontal-bar",
            description: "Top pains por demos únicas.",
            dimension: "insight_subtype_display",
            scopeType: "pain",
            rows: topPains.map((r) => ({ label: r.name, value: r.value, extra: { pct: `${r.pct.toFixed(1)}%` } })),
          }}
        >
          <HorizontalBarChart
            data={topPains.map((r) => ({ name: r.name, value: r.value, pct: r.pct }))}
            label={(value) => {
              const row = topPains.find((item) => item.value === value);
              return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
            }}
            yAxisWidth={260}
          />
        </ChartCard>

        {painThemeBreakdown.length > 0 ? (
          <div className="space-y-3">
            <h3 className="text-[14px] font-semibold text-[var(--color-text-default)]">
              Desglose de los 2 principales temas de pain
            </h3>
            <Caption>
              Para cada tema, se muestran sus subtipos más frecuentes y el % del tema.
            </Caption>
            <section className="grid gap-3 lg:grid-cols-2">
              {painThemeBreakdown.map((theme) => (
                <ChartCard
                  key={theme.theme}
                  title={`${theme.theme} — ${theme.demos} demos (${theme.pct.toFixed(1)}%)`}
                >
                  {theme.subtypes.length > 0 ? (
                    <HorizontalBarChart
                      data={theme.subtypes.map((s) => ({
                        name: s.name,
                        value: s.value,
                        pct: s.pctOfTheme,
                      }))}
                      label={(value) => {
                        const row = theme.subtypes.find((s) => s.value === value);
                        return row ? `${value} (${row.pctOfTheme.toFixed(1)}%)` : String(value);
                      }}
                      yAxisWidth={240}
                      height={260}
                    />
                  ) : (
                    <EmptyState>Sin subtipos para este tema.</EmptyState>
                  )}
                </ChartCard>
              ))}
            </section>
          </div>
        ) : null}

        <ChartCard title="Pains × Segmento">
          <HeatMap
            rowLabels={painSegmentHeat.rowLabels}
            colLabels={painSegmentHeat.colLabels}
            values={painSegmentHeat.values}
          />
        </ChartCard>

        <ChartCard title="Pains por Industria (stack por tema)">
          {painIndustryStack.stackKeys.length > 0 ? (
            <StackedBarChart
              data={painIndustryStack.data}
              yKey="name"
              stackKeys={painIndustryStack.stackKeys}
              yAxisWidth={200}
            />
          ) : (
            <EmptyState>Sin datos de pains por industria.</EmptyState>
          )}
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="¿Qué módulos y features buscan?"
          description="Co-ocurrencia de módulos con segmentos y detalle de feature gaps."
        />
        <ChartCard title="Módulos × Segmento (pains + gaps)">
          {moduleSegmentStack.stackKeys.length > 0 ? (
            <StackedBarChart
              data={moduleSegmentStack.data}
              yKey="name"
              stackKeys={moduleSegmentStack.stackKeys}
              yAxisWidth={220}
            />
          ) : (
            <EmptyState>Sin datos de módulos por segmento.</EmptyState>
          )}
        </ChartCard>
        <section className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Top 20 Feature Gaps — Frecuencia"
            rawRows={filteredRows.filter((r) => r.insight_type === "product_gap")}
            ask={{
              chartTitle: "Top 20 Feature Gaps — Frecuencia",
              chartKind: "horizontal-bar",
              description: "Features faltantes más solicitadas por deals únicos.",
              dimension: "feature_display",
              scopeType: "product_gap",
              rows: featureFreq.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            <HorizontalBarChart data={featureFreq} yAxisWidth={240} />
          </ChartCard>
          <ChartCard
            title="Top 10 Feature Gaps — Revenue en Riesgo"
            rawRows={filteredRows.filter((r) => r.insight_type === "product_gap")}
            ask={{
              chartTitle: "Top 10 Feature Gaps — Revenue en Riesgo",
              chartKind: "horizontal-bar",
              description: "Features ordenadas por revenue acumulado de los deals que las solicitan.",
              dimension: "feature_display",
              scopeType: "product_gap",
              rows: featureRevenue.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            <HorizontalBarChart
              data={featureRevenue}
              label={(v) => formatCurrency(v)}
              yAxisWidth={240}
            />
          </ChartCard>
        </section>
        <ChartCard title="Feature Gaps × Segmento">
          {featureSegmentStack.stackKeys.length > 0 ? (
            <StackedBarChart
              data={featureSegmentStack.data}
              yKey="name"
              stackKeys={featureSegmentStack.stackKeys}
              yAxisWidth={240}
            />
          ) : (
            <EmptyState>Sin datos de features por segmento.</EmptyState>
          )}
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title="Prioridad de gaps"
          description="Clasificación de feature gaps por prioridad del prospect."
        />
        <ChartCard>
          <Table>
            <Thead>
              <Tr>
                <Th>Prioridad</Th>
                <Th>Descripción</Th>
                <Th>Features</Th>
                <Th>Revenue</Th>
                <Th>Avg/Deal</Th>
              </Tr>
            </Thead>
            <Tbody>
              {priorities.map((row) => (
                <Tr key={row.priority}>
                  <Td>
                    <span className="font-semibold">{row.priority}</span>
                  </Td>
                  <Td>
                    <span className="text-[12px] text-[var(--color-text-secondary)]">
                      {row.description}
                    </span>
                  </Td>
                  <Td>{row.features}</Td>
                  <Td>{formatCurrency(row.revenue)}</Td>
                  <Td>{formatCurrency(row.avgDeal)}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </ChartCard>
        {gapsCount === 0 ? (
          <EmptyState>No hay product gaps para el filtro actual.</EmptyState>
        ) : null}
      </div>

      {painOptions.length > 0 ? (
        <div className="space-y-4">
          <SectionHeader
            title="Drill-down: Pains"
            description="Selecciona un pain para ver los registros con mayor confianza."
          />
          <ChartCard>
            <div className="mb-3 grid gap-2 md:grid-cols-[320px_1fr]">
              <SelectBox
                label="Pain"
                value={selectedPain}
                options={painOptions}
                onChange={setSelectedPain}
              />
            </div>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Compañía</Th>
                    <Th>Industria</Th>
                    <Th>Segmento</Th>
                    <Th>País</Th>
                    <Th>Módulo</Th>
                    <Th>Resumen</Th>
                    <Th>Quote</Th>
                    <Th>Confianza</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {painRows.map((row) => (
                    <Tr key={row.id}>
                      <Td>{row.company ?? "—"}</Td>
                      <Td>{row.industry ?? "—"}</Td>
                      <Td>{row.segment ?? "—"}</Td>
                      <Td>{row.country ?? "—"}</Td>
                      <Td>{row.module ?? "—"}</Td>
                      <Td>{row.summary}</Td>
                      <Td>{row.quote ?? "—"}</Td>
                      <Td>{row.confidence.toFixed(2)}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          </ChartCard>
        </div>
      ) : null}

      {gapOptions.length > 0 ? (
        <div className="space-y-4">
          <SectionHeader
            title="Drill-down: Feature Gaps"
            description="Selecciona un feature para ver los deals afectados, ordenados por monto."
          />
          <ChartCard>
            <div className="mb-3 grid gap-2 md:grid-cols-[320px_1fr]">
              <SelectBox
                label="Feature"
                value={selectedFeature}
                options={gapOptions}
                onChange={setSelectedFeature}
              />
            </div>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>Compañía</Th>
                    <Th>Industria</Th>
                    <Th>Segmento</Th>
                    <Th>País</Th>
                    <Th>Owner</Th>
                    <Th>Módulo</Th>
                    <Th>Prioridad</Th>
                    <Th>Monto</Th>
                    <Th>Resumen</Th>
                    <Th>Quote</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {gapRows.map((row) => (
                    <Tr key={row.id}>
                      <Td>{row.company ?? "—"}</Td>
                      <Td>{row.industry ?? "—"}</Td>
                      <Td>{row.segment ?? "—"}</Td>
                      <Td>{row.country ?? "—"}</Td>
                      <Td>{row.owner ?? "—"}</Td>
                      <Td>{row.module ?? "—"}</Td>
                      <Td>{row.priority ?? "—"}</Td>
                      <Td>{row.amount !== null ? formatCurrency(row.amount) : "—"}</Td>
                      <Td>{row.summary}</Td>
                      <Td>{row.quote ?? "—"}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </div>
          </ChartCard>
        </div>
      ) : null}
    </div>
  );
}
