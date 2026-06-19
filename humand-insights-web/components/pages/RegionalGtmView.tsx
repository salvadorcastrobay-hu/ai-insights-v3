"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { MetricCard } from "@/components/layout/MetricCard";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import type { RegionalGtmData } from "@/lib/data/regional-gtm-data";

type Props = { data: RegionalGtmData };

export function RegionalGtmView({ data }: Props) {
  const t = useTranslations("regionalGtm");
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
      <PageTitle title={t("title")} />

      <SectionHeader
        title={t("sectionA")}
        description={t("sectionADesc")}
      />
      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label={t("topRegion")}
          value={pipelineKpis.topRegion}
          delta={`${pipelineKpis.topRegionPct} del total`}
        />
        <MetricCard label={t("totalPipeline")} value={pipelineKpis.totalPipeline} />
        <MetricCard
          label={t("highestAvg")}
          value={pipelineKpis.highestAvgValue}
          delta={`${pipelineKpis.highestAvgRegion} — ${pipelineKpis.highestAvgDeals} deals`}
        />
      </section>

      <ChartCard title={t("pipelineBySegment")}>
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
        title={t("sectionB")}
        description={t("sectionBDesc")}
      />
      <ChartCard title={t("countryInsightType")}>
        <StackedBarChart
          data={countryInsight.data}
          yKey="name"
          stackKeys={countryInsight.stackKeys}
          height={Math.max(480, countryInsight.data.length * 34)}
        />
      </ChartCard>

      <SectionHeader
        title={t("sectionC")}
        description="Top 3 pains por región como % de las demos únicas en esa región — comparable entre mercados de distinto tamaño."
      />
      <ChartCard
        title={t("topPainsByRegion")}
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

      <ChartCard title={t("modulesByRegion")}>
        <HeatMap
          rowLabels={moduleRegionHeat.rowLabels}
          colLabels={moduleRegionHeat.colLabels}
          values={moduleRegionHeat.values}
          height={Math.max(420, moduleRegionHeat.rowLabels.length * 32 + 140)}
        />
      </ChartCard>

      <SectionHeader
        title={t("competitorsByCountry")}
        description={t("competitorsByCountryDesc")}
      />
      <ChartCard>
        <div className="mb-3">
          <label className="mr-2 text-[12px] text-[var(--color-text-secondary)]">
            {t("filterByCountry")}
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
