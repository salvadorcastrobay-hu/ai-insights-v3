"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageTitle } from "@/components/pages/common";
import { ConfidenceBadge } from "@/components/ui/ConfidenceBadge";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { useTranslations } from "next-intl";
import { useTaxonomyLabel } from "@/lib/taxonomy-labels";
import type { FaqDetailData } from "@/lib/data/faq-detail-data";

type Props = { data: FaqDetailData; filteredRows: import("@/lib/supabase/types").InsightRow[] };

export function FaqDetailView({ data, filteredRows }: Props) {
  const t = useTranslations("faq");
  const tl = useTaxonomyLabel();
  const { kpis, topicCounts, topics, topQuestionsByTopic, faqTableRows } = data;

  const [topic, setTopic] = useState(topics[0] ?? "");
  const [search, setSearch] = useState("");

  const topQuestions = topQuestionsByTopic[topic] ?? [];

  const tableRows = useMemo(() => {
    return faqTableRows.filter((row) => {
      if (topic && row.insight_subtype_display !== topic) return false;
      if (search) {
        const blob = `${row.summary} ${row.verbatim_quote ?? ""}`.toLowerCase();
        if (!blob.includes(search.toLowerCase())) return false;
      }
      return true;
    });
  }, [faqTableRows, topic, search]);

  return (
    <div className="space-y-6">
      <PageTitle title={t("title")} subtitle={t("subtitle")} />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label={t("total")} value={kpis.totalFaqs} caption={t("totalCaption")} />
        <MetricCard label={t("uniqueTopics")} value={kpis.uniqueTopics} caption={t("uniqueTopicsCaption")} />
        <MetricCard
          label={t("perDemo")}
          value={kpis.questionsPerDemo}
          caption="promedio · si baja con el tiempo, el pre-demo está funcionando"
        />
      </section>

      <p className="text-[12px] text-[var(--color-text-secondary)]">
        Un número alto de preguntas puede indicar que el prospect no encontró respuestas en
        materiales previos. Usá el ranking de topics para priorizar contenido de enablement.
      </p>

      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard
          title={t("byTopic")}
          rawRows={filteredRows.filter((r) => r.insight_type === "faq")}
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
            Los topics con mayor volumen son los candidatos prioritarios para construir Battle
            Cards. Cada AE debería tener una respuesta preparada para esos topics.
          </p>
          <HorizontalBarChart data={topicCounts} height={380} />
        </ChartCard>
        <ChartCard title={t("topByTopic")}>
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            Estas 5 preguntas son la base para la Battle Card del topic seleccionado.
          </p>
          <select className="mb-2 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={topic} onChange={(e) => setTopic(e.target.value)}>
            {topics.map((option) => (<option key={option} value={option}>{option}</option>))}
          </select>
          <HorizontalBarChart data={topQuestions} height={380} />
        </ChartCard>
      </section>

      <ChartCard title={t("detail")}>
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
          Filtrá por topic o busca palabras clave para revisar ejemplos reales antes de preparar
          respuestas estándar.
        </p>
        <div className="mb-3 grid gap-2 md:grid-cols-2">
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">Todos los topics</option>
            {topics.map((option) => (<option key={option} value={option}>{option}</option>))}
          </select>
          <Input placeholder={t("searchFaq")} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-[420px] overflow-auto">
          <Table>
            <Thead><Tr><Th>Topic</Th><Th>Conf.</Th><Th>Pregunta</Th><Th>Cita textual</Th></Tr></Thead>
            <Tbody>
              {tableRows.map((row) => (
                <Tr key={row.id}>
                  <Td>{tl(row.insight_subtype_display)}</Td>
                  <Td><ConfidenceBadge value={row.confidence} /></Td>
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
