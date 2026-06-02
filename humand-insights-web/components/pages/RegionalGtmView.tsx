"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import type { RegionalGtmData } from "@/lib/data/regional-gtm-data";

type Props = { data: RegionalGtmData };

export function RegionalGtmView({ data }: Props) {
  const {
    countryInsight,
    painRegionHeatPct,
    moduleRegionHeat,
    pipelineKpis,
    pipelineGrid,
    competitorsByCountry,
    competitorCountries,
  } = data;

  const [country, setCountry] = useState<string>("");

  const compRows = useMemo(() => {
    if (!country) return competitorsByCountry;
    return competitorsByCountry.filter((r) => r.country === country);
  }, [competitorsByCountry, country]);

  return (
    <div className="space-y-6">
      <PageTitle title="Regional / GTM" />

      <SectionHeader
        title="A. ¿Cuánto vale cada mercado?"
        description="Vista rápida de cobertura y pipeline por región."
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label="Región con más pipeline"
          value={pipelineKpis.topRegion}
          delta={`${pipelineKpis.topRegionPct} del total`}
        />
        <MetricCard label="Pipeline total" value={pipelineKpis.totalPipeline} />
        <MetricCard
          label="Mayor ticket promedio"
          value={pipelineKpis.highestAvgValue}
          delta={`${pipelineKpis.highestAvgRegion} — ${pipelineKpis.highestAvgDeals} deals`}
        />
      </section>

      <ChartCard title="Pipeline por Segmento × Región">
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
          Cada celda: Revenue · Deals · Ticket Promedio.
        </p>
        {pipelineGrid.rowLabels.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            No hay deals con segmento y región asignados.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <Thead>
                <Tr>
                  <Th>Segmento</Th>
                  {pipelineGrid.colLabels.map((region) => (
                    <Th key={region}>{region}</Th>
                  ))}
                </Tr>
              </Thead>
              <Tbody>
                {pipelineGrid.rowLabels.map((segment, r) => (
                  <Tr key={segment}>
                    <Td className="font-semibold">{segment}</Td>
                    {pipelineGrid.cells[r].map((cell) => (
                      <Td key={`${segment}-${cell.region}`}>{cell.display}</Td>
                    ))}
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </div>
        )}
      </ChartCard>

      <SectionHeader
        title="B. ¿Dónde estamos teniendo más conversaciones?"
        description="Top 15 países por cantidad de insights, con desglose por tipo."
      />
      <ChartCard title="Country × Insight Type">
        <StackedBarChart
          data={countryInsight.data}
          yKey="name"
          stackKeys={countryInsight.stackKeys}
          height={Math.max(480, countryInsight.data.length * 34)}
        />
      </ChartCard>

      <SectionHeader
        title="C. ¿Qué encontramos en cada mercado?"
        description="Top 3 pains por región como % de las demos únicas en esa región — comparable entre mercados de distinto tamaño."
      />
      <ChartCard
        title="Top 3 Pains por Región (% de demos)"
        ask={{
          chartTitle: "Top 3 Pains por Región (% de demos)",
          chartKind: "heatmap",
          description:
            "Matriz pain × región. Cada celda muestra el % de demos en esa región donde apareció el pain. Solo el top 3 por región.",
          dimension: "insight_subtype_display",
          scopeType: "pain",
          rows: painRegionHeatPct.rowLabels.flatMap((pain, r) =>
            painRegionHeatPct.colLabels
              .map((region, c) => ({
                label: `${pain} — ${region}`,
                value: painRegionHeatPct.values[r]?.[c] ?? 0,
                extra: {
                  pain,
                  region,
                  pct: `${(painRegionHeatPct.values[r]?.[c] ?? 0).toFixed(1)}%`,
                  demos: painRegionHeatPct.absolute[r]?.[c] ?? 0,
                },
              }))
              .filter((cell) => Number(cell.value) > 0),
          ),
          notes:
            "El pipeline ya enriquece quotes por pain (insight_subtype_display). Las citas mostradas son globales para el pain (no filtradas por región).",
        }}
      >
        {painRegionHeatPct.rowLabels.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">Sin datos suficientes.</p>
        ) : (
          <HeatMap
            rowLabels={painRegionHeatPct.rowLabels}
            colLabels={painRegionHeatPct.colLabels}
            values={painRegionHeatPct.values}
            valueFormat={(v) => (v > 0 ? `${v.toFixed(1)}%` : "")}
            height={Math.max(320, painRegionHeatPct.rowLabels.length * 36 + 140)}
          />
        )}
      </ChartCard>
      <p className="text-[12px] text-[var(--color-text-secondary)]">
        Los pains principales suelen ser consistentes entre regiones — las diferencias están en la
        intensidad (%). Leer junto al volumen absoluto de demos de cada mercado.
      </p>

      <ChartCard title="Módulos demandados por región">
        <HeatMap
          rowLabels={moduleRegionHeat.rowLabels}
          colLabels={moduleRegionHeat.colLabels}
          values={moduleRegionHeat.values}
          height={Math.max(420, moduleRegionHeat.rowLabels.length * 32 + 140)}
        />
      </ChartCard>

      <SectionHeader
        title="Competidores por País"
        description="Ranking de competidores por país con menciones y relación principal detectada."
      />
      <ChartCard>
        <div className="mb-3">
          <label className="mr-2 text-[12px] text-[var(--color-text-secondary)]">
            Filtrar por país:
          </label>
          <select
            className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2 text-[12px]"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            <option value="">(Todos)</option>
            {competitorCountries.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[420px] overflow-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>País</Th>
                <Th>Competidor</Th>
                <Th>Menciones</Th>
                <Th>Relación Principal</Th>
              </Tr>
            </Thead>
            <Tbody>
              {compRows.map((row) => (
                <Tr key={`${row.country}-${row.competitor}`}>
                  <Td>{row.country}</Td>
                  <Td>{row.competitor}</Td>
                  <Td>{row.mentions}</Td>
                  <Td>{row.topRelationship}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      </ChartCard>
    </div>
  );
}
