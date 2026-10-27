"use client";

import { useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { PageTitle } from "@/components/pages/common";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { Input } from "@/components/ui/input";
import { LoadMoreButton, TableTruncatedNote, usePagedTableParams } from "@/components/ui/paged-table";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { useTaxonomyLabel } from "@/lib/taxonomy-labels";
import type { CsvLinks } from "@/lib/data/csv-export-links";
import type { FaqDetailData } from "@/lib/data/faq-detail-data";

type Props = { data: FaqDetailData; csv: CsvLinks };

export function FaqDetailView({ data, csv }: Props) {
  const t = useTranslations("faq");
  const tl = useTaxonomyLabel();
  const { topicCounts, topics, topQuestionsByTopic, faqTableRows, faqTableTotal } = data;

  // El top de preguntas es client-side (ya viene precalculado por tema); la
  // tabla de detalle filtra en server con sus propios params.
  const [topic, setTopic] = useState(topics[0] ?? "");
  const table = usePagedTableParams("ft", ["topic"] as const);

  const topQuestions = topQuestionsByTopic[topic] ?? [];

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} subtitle={t("subtitle")} />


      <p className="text-[12px] text-[var(--color-text-secondary)]">
        {t("highVolumeDesc")}
      </p>

      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title={t("byTopic")}
          csv={csv.faq}
          ask={{
            chartTitle: t("byTopicChartTitle"),
            chartKind: "horizontal-bar",
            description: t("byTopicDesc"),
            dimension: "insight_subtype_display",
            scopeType: "faq",
            rows: topicCounts.map((r) => ({ label: r.name, value: r.value })),
          }}
        >
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            {t("highVolumeTopicDesc")}
          </p>
          <HorizontalBarChart data={topicCounts.map((d) => ({ ...d, name: tl(d.name) }))} height={380} />
        </ChartCard>
        <ChartCard title={t("topByTopic")}>
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            {t("topByTopicDesc")}
          </p>
          <select className="mb-3 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={topic} onChange={(e) => setTopic(e.target.value)}>
            {topics.map((option) => (<option key={option} value={option}>{tl(option)}</option>))}
          </select>
          <ol className="space-y-2.5 text-[13px]">
            {topQuestions.length === 0 ? (
              <li className="text-[var(--color-text-secondary)]">{t("noQuestions")}</li>
            ) : (
              topQuestions.slice(0, 5).map((q, i) => (
                <li key={i} className="flex gap-2">
                  <span className="font-semibold text-[var(--color-brand-500)]">{i + 1}.</span>
                  <span>{q.name}</span>
                </li>
              ))
            )}
          </ol>
        </ChartCard>
      </section>

      <ChartCard title={t("detail")}>
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
          {t("filterByTopicDesc")}
        </p>
        <div className="mb-3 grid gap-2 md:grid-cols-2">
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={table.filters.topic} onChange={(e) => table.setFilter("topic", e.target.value)}>
            <option value="">{t("allTopics")}</option>
            {topics.map((option) => (<option key={option} value={option}>{tl(option)}</option>))}
          </select>
          <Input placeholder={t("searchFaq")} value={table.search} onChange={(e) => table.setSearch(e.target.value)} />
        </div>
        <div className="max-h-[600px] overflow-auto">
          <Table>
            <Thead><Tr><Th>{t("thTopicCol")}</Th><Th>{t("thConfCol")}</Th><Th>{t("thQuestionCol")}</Th><Th>{t("thQuoteCol")}</Th><Th>{t("thAnswerCol")}</Th></Tr></Thead>
            <Tbody>
              {faqTableRows.map((row) => (
                <Tr key={row.id}>
                  <Td>{tl(row.insight_subtype_display)}</Td>
                  <Td><ConfidenceBadge value={row.confidence} /></Td>
                  <Td>{row.summary}</Td>
                  <Td>{row.verbatim_quote}</Td>
                  <Td>{row.faq_answer}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          <LoadMoreButton
            shown={faqTableRows.length}
            total={faqTableTotal}
            loadingMore={table.loadingMore}
            onLoadMore={() => table.loadMore(faqTableRows.length)}
          />
        </div>
        <TableTruncatedNote shown={faqTableRows.length} total={faqTableTotal} />
      </ChartCard>
    </div>
  );
}
