"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { EmptyState, PageTitle } from "@/components/pages/common";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { useTaxonomyLabel } from "@/lib/taxonomy-labels";
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
  const t = useTranslations("productIntelligence");
  const tl = useTaxonomyLabel();
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
        title={t("title")}
        subtitle={t("subtitle")}
      />

      <div className="space-y-4">
        <SectionHeader
          title={t("problemsTitle")}
          description={t("problemsDesc")}
        />
        <ChartCard
          title={t("topPainsTitle")}
          rawRows={filteredRows.filter((r) => r.insight_type === "pain")}
          ask={{
            chartTitle: t("topPainsChartTitle"),
            chartKind: "horizontal-bar",
            description: t("topPainsDesc"),
            dimension: "insight_subtype_display",
            scopeType: "pain",
            rows: topPains.map((r) => ({ label: r.name, value: r.value, extra: { pct: `${r.pct.toFixed(1)}%` } })),
          }}
        >
          <HorizontalBarChart
            data={topPains.map((r) => ({ name: tl(r.name), value: r.value, pct: r.pct }))}
            label={(value) => {
              const row = topPains.find((item) => item.value === value);
              return row ? `${value} (${row.pct.toFixed(1)}%)` : String(value);
            }}
            yAxisWidth={260}
          />
        </ChartCard>


        <ChartCard title={t("painBySegment")}>
          <HeatMap
            rowLabels={painSegmentHeat.rowLabels.map(tl)}
            colLabels={painSegmentHeat.colLabels}
            values={painSegmentHeat.values}
          />
        </ChartCard>

        <ChartCard title={t("painByIndustry")}>
          {painIndustryStack.stackKeys.length > 0 ? (
            <StackedBarChart
              data={painIndustryStack.data}
              yKey="name"
              stackKeys={painIndustryStack.stackKeys}
              yAxisWidth={200}
            />
          ) : (
            <EmptyState>{t("noPainsByIndustry")}</EmptyState>
          )}
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title={t("modulesTitle")}
          description={t("modulesDesc")}
        />
        <ChartCard title={t("moduleBySegment")}>
          {moduleSegmentStack.stackKeys.length > 0 ? (
            <StackedBarChart
              data={moduleSegmentStack.data.map((r) => ({ ...r, name: tl(String(r.name)) }))}
              yKey="name"
              stackKeys={moduleSegmentStack.stackKeys}
              yAxisWidth={220}
            />
          ) : (
            <EmptyState>{t("noModulesBySegment")}</EmptyState>
          )}
        </ChartCard>
        <section className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title={t("topGapsFreq")}
            rawRows={filteredRows.filter((r) => r.insight_type === "product_gap")}
            ask={{
              chartTitle: t("topGapsFreq"),
              chartKind: "horizontal-bar",
              description: t("topGapsFreqDesc"),
              dimension: "feature_display",
              scopeType: "product_gap",
              rows: featureFreq.map((r) => ({ label: r.name, value: r.value })),
            }}
          >
            <HorizontalBarChart data={featureFreq} yAxisWidth={240} />
          </ChartCard>
          <ChartCard
            title={t("topGapsRevenue")}
            rawRows={filteredRows.filter((r) => r.insight_type === "product_gap")}
            ask={{
              chartTitle: t("topGapsRevenue"),
              chartKind: "horizontal-bar",
              description: t("topGapsRevenueDesc"),
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
        <ChartCard title={t("gapsBySegment")}>
          {featureSegmentStack.stackKeys.length > 0 ? (
            <StackedBarChart
              data={featureSegmentStack.data}
              yKey="name"
              stackKeys={featureSegmentStack.stackKeys}
              yAxisWidth={240}
            />
          ) : (
            <EmptyState>{t("noGapsBySegment")}</EmptyState>
          )}
        </ChartCard>
      </div>

      <div className="space-y-4">
        <SectionHeader
          title={t("gapsPriority")}
          description={t("gapsPriorityDesc")}
        />
        <ChartCard>
          <Table>
            <Thead>
              <Tr>
                <Th>{t("thPriority")}</Th>
                <Th>{t("thDescription")}</Th>
                <Th>{t("thFeatures")}</Th>
                <Th>Revenue</Th>
                <Th>{t("thAvgDeal")}</Th>
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
          <EmptyState>{t("noGaps")}</EmptyState>
        ) : null}
      </div>

      {painOptions.length > 0 ? (
        <div className="space-y-4">
          <SectionHeader
            title={t("drillPains")}
            description={t("drillPainsDesc")}
          />
          <ChartCard>
            <div className="mb-3 grid gap-2 md:grid-cols-[320px_1fr]">
              <SelectBox
                label={t("painLabel")}
                value={selectedPain}
                options={painOptions}
                onChange={setSelectedPain}
              />
            </div>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>{t("thCompany")}</Th>
                    <Th>{t("thIndustry")}</Th>
                    <Th>{t("thSegment")}</Th>
                    <Th>{t("thCountry")}</Th>
                    <Th>{t("thModule")}</Th>
                    <Th>{t("thSummary")}</Th>
                    <Th>{t("thQuote")}</Th>
                    <Th>{t("thConfidence")}</Th>
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
            title={t("drillGaps")}
            description={t("drillGapsDesc")}
          />
          <ChartCard>
            <div className="mb-3 grid gap-2 md:grid-cols-[320px_1fr]">
              <SelectBox
                label={t("featureLabel")}
                value={selectedFeature}
                options={gapOptions}
                onChange={setSelectedFeature}
              />
            </div>
            <div className="max-h-[480px] overflow-auto">
              <Table>
                <Thead>
                  <Tr>
                    <Th>{t("thCompany")}</Th>
                    <Th>{t("thIndustry")}</Th>
                    <Th>{t("thSegment")}</Th>
                    <Th>{t("thCountry")}</Th>
                    <Th>{t("thOwner")}</Th>
                    <Th>{t("thModule")}</Th>
                    <Th>{t("thPriority")}</Th>
                    <Th>{t("thAmount")}</Th>
                    <Th>{t("thSummary")}</Th>
                    <Th>{t("thQuote")}</Th>
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
