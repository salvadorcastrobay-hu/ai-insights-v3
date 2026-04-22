"use client";

import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { HorizontalBarChart } from "@/components/charts/BarChart";
import { MetricCard } from "@/components/layout/MetricCard";
import { PageTitle } from "@/components/pages/common";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import type { FaqDetailData } from "@/lib/data/faq-detail-data";

type Props = { data: FaqDetailData };

export function FaqDetailView({ data }: Props) {
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
      <PageTitle title="FAQs — Detalle" subtitle="Detalle de preguntas frecuentes para priorizar Battle Cards." />

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard label="Total FAQs" value={kpis.totalFaqs} caption="insights de tipo FAQ" />
        <MetricCard label="Topics Únicos" value={kpis.uniqueTopics} caption="categorías de preguntas detectadas" />
        <MetricCard
          label="Preguntas por Demo"
          value={kpis.questionsPerDemo}
          caption="promedio · si baja con el tiempo, el pre-demo está funcionando"
        />
      </section>

      <p className="text-[12px] text-[var(--color-text-secondary)]">
        Un número alto de preguntas puede indicar que el prospect no encontró respuestas en
        materiales previos. Usá el ranking de topics para priorizar contenido de enablement.
      </p>

      <section className="grid gap-3 lg:grid-cols-2">
        <ChartCard title="FAQs por Topic (deals únicos con al menos 1 pregunta)">
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            Los topics con mayor volumen son los candidatos prioritarios para construir Battle
            Cards. Cada AE debería tener una respuesta preparada para esos topics.
          </p>
          <HorizontalBarChart data={topicCounts} height={380} />
        </ChartCard>
        <ChartCard title="Top 5 preguntas por topic">
          <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
            Estas 5 preguntas son la base para la Battle Card del topic seleccionado.
          </p>
          <select className="mb-2 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={topic} onChange={(e) => setTopic(e.target.value)}>
            {topics.map((option) => (<option key={option} value={option}>{option}</option>))}
          </select>
          <HorizontalBarChart data={topQuestions} height={380} />
        </ChartCard>
      </section>

      <ChartCard title="Detalle FAQ">
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">
          Filtrá por topic o busca palabras clave para revisar ejemplos reales antes de preparar
          respuestas estándar.
        </p>
        <div className="mb-3 grid gap-2 md:grid-cols-2">
          <select className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-2" value={topic} onChange={(e) => setTopic(e.target.value)}>
            <option value="">Todos los topics</option>
            {topics.map((option) => (<option key={option} value={option}>{option}</option>))}
          </select>
          <Input placeholder="Buscar pregunta..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="max-h-[420px] overflow-auto">
          <Table>
            <Thead><Tr><Th>Topic</Th><Th>Pregunta</Th><Th>Cita textual</Th></Tr></Thead>
            <Tbody>
              {tableRows.map((row) => (
                <Tr key={row.id}>
                  <Td>{row.insight_subtype_display}</Td>
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
