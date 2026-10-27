"use client";


import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { HeatMap } from "@/components/charts/HeatMap";
import { StackedBarChart } from "@/components/charts/StackedBar";
import { useDrillDown } from "@/components/drill-down/DrillDownProvider";
import { SectionHeader } from "@/components/layout/SectionHeader";
import { PageTitle } from "@/components/pages/common";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { Input } from "@/components/ui/input";
import { LoadMoreButton, TableTruncatedNote, usePagedTableParams } from "@/components/ui/paged-table";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { useTaxonomyLabel } from "@/lib/taxonomy-labels";
import type { CsvLinks } from "@/lib/data/csv-export-links";
import type { ProductGapsDetailData } from "@/lib/data/product-gaps-detail-data";

type Props = { data: ProductGapsDetailData; csv: CsvLinks };

const PRIORITY_COLORS: Record<string, string> = {
  "⚠️ Must Have": "#E53E3E",
  "💡 Nice to Have": "#D69E2E",
  "🚫 Dealbreaker": "#9B2335",
};

export function ProductGapsDetailView({ data, csv }: Props) {
  const t = useTranslations("productGaps");
  const tl = useTaxonomyLabel();
  const { open: drill } = useDrillDown();
  const {
    topFeatures,
    prioritySummary,
    segmentPriority,
    featureSegmentHeatmap,
    moduleStatus,
    existingModulePct,
    priorityLabelByKey,
    gapTableRows,
    gapTableTotal,
    gapTableModules,
    gapTablePriorities,
  } = data;

  const table = usePagedTableParams("gt", ["priority", "module"] as const);

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
      <PageTitle title={t("title")} subtitle={t("subtitle")} />

      <SectionHeader
        title={t("topFeaturesTitle")}
        description={t("topFeaturesDesc")}
      />
      <ChartCard
        csv={csv.product_gap}
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
        title={t("priorityTitle")}
        description={t("priorityRevenueDesc")}
      />
      <ChartCard>
        <Table>
          <Thead>
            <Tr>
              <Th>{t("thPriority")}</Th>
              <Th>{t("thDetections")}</Th>
              <Th>{t("thPctTotal")}</Th>
              <Th>{t("thRevenueAtRisk")}</Th>
              <Th>{t("thMeaning")}</Th>
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
          {t("dealbreakersNote")}
        </p>
      </ChartCard>

      <SectionHeader
        title={t("segmentPriorityTitle")}
        description={t("segmentPriorityDesc")}
      />
      <ChartCard>
        {segmentPriorityChart.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">{t("noDataSuficient")}</p>
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
        title={t("featureSegmentTitle")}
        description={t("featureSegmentDesc")}
      />
      <ChartCard>
        {featureSegmentHeatmap.rowLabels.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">{t("noDataSuficient")}</p>
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
        title={t("moduleStatusTitle")}
        description={t("moduleStatusDesc", { pct: existingModulePct })}
      />
      <ChartCard>
        {moduleStatus.length === 0 ? (
          <p className="text-[13px] text-[var(--color-text-secondary)]">{t("noModuleStatus")}</p>
        ) : (
          <HorizontalBarChart
            data={moduleStatus.map((r) => ({ name: `${r.name} (${r.pct}%)`, value: r.value }))}
            height={Math.max(200, moduleStatus.length * 60)}
            multicolor
          />
        )}
      </ChartCard>

      <SectionHeader
        title={t("detailTitle")}
        description={t("detailDesc")}
      />
      <ChartCard>
        <div className="mb-3 grid gap-2 md:grid-cols-3">
          <select
            className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2"
            value={table.filters.priority}
            onChange={(e) => table.setFilter("priority", e.target.value)}
          >
            <option value="">{t("allPriorities")}</option>
            {gapTablePriorities.map((option) => (
              <option key={option} value={option}>
                {priorityLabelByKey[option] ?? option}
              </option>
            ))}
          </select>
          <select
            className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2"
            value={table.filters.module}
            onChange={(e) => table.setFilter("module", e.target.value)}
          >
            <option value="">{t("allModules")}</option>
            {gapTableModules.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
          <Input
            placeholder={t("searchGap")}
            value={table.search}
            onChange={(e) => table.setSearch(e.target.value)}
          />
        </div>
        <div className="max-h-[600px] overflow-auto">
          <Table>
            <Thead>
              <Tr>
                <Th>{t("thCompany")}</Th>
                <Th>{t("thFeature")}</Th>
                <Th>{t("thModule")}</Th>
                <Th>{t("thPriority")}</Th>
                <Th>{t("thSegment")}</Th>
                <Th>{t("thCountry")}</Th>
                <Th>{t("thStage")}</Th>
                <Th>{t("thAE")}</Th>
                <Th>{t("thConf")}</Th>
                <Th>{t("thSummary")}</Th>
              </Tr>
            </Thead>
            <Tbody>
              {gapTableRows.map((row) => (
                <Tr
                  key={row.id}
                  className={row.isDealbreaker ? "bg-[#fff0f0]" : ""}
                >
                  <Td>{row.company_name}</Td>
                  <Td>{row.feature_display}</Td>
                  <Td>{tl(row.module_display ?? "")}</Td>
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
          <LoadMoreButton
            shown={gapTableRows.length}
            total={gapTableTotal}
            loadingMore={table.loadingMore}
            onLoadMore={() => table.loadMore(gapTableRows.length)}
          />
        </div>
        <TableTruncatedNote shown={gapTableRows.length} total={gapTableTotal} />
      </ChartCard>
    </div>
  );
}
