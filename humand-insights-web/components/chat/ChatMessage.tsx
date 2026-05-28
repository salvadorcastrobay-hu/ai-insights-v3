"use client";

import { Check, ChevronDown, ChevronRight, Copy, Download } from "lucide-react";
import { useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { downloadMarkdown, messageToMarkdown } from "./messageToMarkdown";
import type { ChatMessageModel, ChartPayload, DataTablePayload, MarketingRecommendation } from "./types";

/** Renderer compartido para contenido markdown de respuestas del chat.
 *  Mismo estilo que AskChart, para consistencia visual entre features. */
function AssistantMarkdown({ content }: { content: string }) {
  return (
    <div className="chat-assistant-md text-[13px] leading-6 text-[var(--color-text-default)]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: (props) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
          ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0" {...props} />,
          ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0" {...props} />,
          li: (props) => <li className="leading-relaxed" {...props} />,
          strong: (props) => <strong className="font-semibold" {...props} />,
          em: (props) => <em className="italic" {...props} />,
          code: (props) => (
            <code className="rounded bg-[var(--color-neutral-100)] px-1 py-0.5 font-mono text-[12px]" {...props} />
          ),
          pre: (props) => (
            <pre className="my-2 overflow-x-auto rounded bg-[var(--color-neutral-100)] p-2 font-mono text-[12px]" {...props} />
          ),
          h1: (props) => <h4 className="mb-1 mt-3 text-[15px] font-semibold" {...props} />,
          h2: (props) => <h4 className="mb-1 mt-3 text-[14px] font-semibold" {...props} />,
          h3: (props) => <h4 className="mb-1 mt-2 text-[13px] font-semibold" {...props} />,
          h4: (props) => <h4 className="mb-1 mt-2 text-[13px] font-semibold" {...props} />,
          a: (props) => (
            <a className="text-[var(--color-brand-500)] underline" target="_blank" rel="noreferrer" {...props} />
          ),
          blockquote: (props) => (
            <blockquote className="my-2 border-l-2 border-[var(--color-brand-400)] pl-2 italic text-[var(--color-text-secondary)]" {...props} />
          ),
          table: (props) => (
            <div className="my-2 overflow-x-auto">
              <table className="min-w-full border-collapse text-[12px]" {...props} />
            </div>
          ),
          th: (props) => <th className="border-b border-[var(--color-neutral-200)] px-2 py-1 text-left font-semibold" {...props} />,
          td: (props) => <td className="border-b border-[var(--color-neutral-100)] px-2 py-1" {...props} />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function TableView({ table }: { table: DataTablePayload }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {table.columns.map((column) => (
              <th key={column} className="px-3 py-2 text-left font-medium text-slate-600">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {table.rows.map((row, index) => (
            <tr key={index}>
              {table.columns.map((column) => (
                <td key={column} className="px-3 py-2 align-top text-slate-700">
                  {String(row[column] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartPreview({ chart }: { chart: ChartPayload }) {
  if (chart.type === "metric") {
    const metric = chart.series[0]?.value;
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{chart.title ?? "Metric"}</p>
        <p className="mt-2 text-3xl font-semibold text-slate-900">{String(metric ?? "-")}</p>
      </div>
    );
  }

  const maxValue = Math.max(
    ...chart.series.map((item) => Number(item[chart.valueKey ?? "value"] ?? 0)),
    0,
  );

  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      {chart.title ? <p className="mb-3 text-sm font-medium text-slate-700">{chart.title}</p> : null}
      <div className="space-y-3">
        {chart.series.map((item, index) => {
          const value = Number(item[chart.valueKey ?? "value"] ?? 0);
          const width = maxValue === 0 ? 0 : Math.max(8, (value / maxValue) * 100);
          return (
            <div key={index} className="space-y-1">
              <div className="flex items-center justify-between gap-4 text-xs text-slate-600">
                <span className="truncate">{String(item[chart.labelKey ?? "label"] ?? `Serie ${index + 1}`)}</span>
                <span className="font-medium text-slate-900">{String(item[chart.valueKey ?? "value"] ?? "")}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100">
                <div className="h-2 rounded-full bg-blue-500" style={{ width: `${width}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AngleCard({ angle, defaultOpen }: { angle: MarketingRecommendation["recommended_angles"][number]; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <article className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 px-3 py-2 text-left transition hover:bg-[var(--color-neutral-100)]"
      >
        <span className="mt-0.5 shrink-0 text-[var(--color-text-secondary)]">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="flex min-w-[18px] shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-500)] px-1.5 py-0.5 text-[10px] font-bold text-white">
          {angle.rank}
        </span>
        <span className="flex-1 text-[13px] font-semibold leading-snug text-[var(--color-text-default)]">
          {angle.title}
        </span>
        <span className="shrink-0 rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">
          {angle.action_type}
        </span>
      </button>
      {open ? (
        <div className="space-y-2 border-t border-[var(--color-neutral-100)] px-3 py-2.5 text-[12px] leading-5 text-[var(--color-text-default)]">
          <AngleField label="Audiencia" value={angle.target_audience} />
          <AngleField label="Hero" value={angle.hero_message} />
          <AngleField label="Core" value={angle.core_message} />
          <AngleField label="Pain" value={angle.key_pain_addressed} />
          <AngleField label="Data" value={angle.supporting_data} />
          {angle.channels.length ? (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
                Canales
              </span>
              {angle.channels.map((channel) => (
                <span key={channel} className="rounded-full bg-[var(--color-brand-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-brand-500)]">
                  {channel}
                </span>
              ))}
            </div>
          ) : null}
          {angle.content_ideas.length ? (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
                Ideas de contenido
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                {angle.content_ideas.map((idea) => (
                  <li key={idea}>{idea}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function AngleField({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2">
      <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
        {label}
      </span>
      <span className="flex-1">{value}</span>
    </div>
  );
}

function RecommendationView({ recommendation }: { recommendation: MarketingRecommendation }) {
  return (
    <div className="space-y-3">
      <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-brand-50)] px-3 py-2">
        <p className="text-[11px] leading-5 text-[var(--color-text-default)]">{recommendation.segment_summary}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <MetaChip label="Idioma" value={recommendation.recommended_market_language} />
          <MetaChip label="Confianza" value={recommendation.data_confidence} />
          <MetaChip label="Freshness" value={recommendation.freshness_window} />
          {recommendation.sample_size != null ? (
            <MetaChip label="N" value={String(recommendation.sample_size)} />
          ) : null}
        </div>
      </div>

      <div className="grid gap-2 xl:grid-cols-2">
        {recommendation.recommended_angles.map((angle, i) => (
          <AngleCard key={angle.rank} angle={angle} defaultOpen={i === 0} />
        ))}
      </div>

      {(recommendation.qualification_summary.length > 0 || recommendation.what_not_to_do.length > 0) ? (
        <div className="grid gap-2 md:grid-cols-2">
          {recommendation.qualification_summary.length > 0 ? (
            <ListCard title="Qualification" items={recommendation.qualification_summary} tone="default" />
          ) : null}
          {recommendation.what_not_to_do.length > 0 ? (
            <ListCard title="What not to do" items={recommendation.what_not_to_do} tone="warn" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MetaChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-brand-100)] bg-white px-1.5 py-0.5 text-[10px] text-[var(--color-text-default)]">
      <span className="font-semibold uppercase tracking-[0.08em] text-[var(--color-text-secondary)]">{label}</span>
      <span className="font-medium capitalize">{value}</span>
    </span>
  );
}

function ListCard({ title, items, tone }: { title: string; items: string[]; tone: "default" | "warn" }) {
  const toneClass =
    tone === "warn"
      ? "border-red-200 bg-red-50/60"
      : "border-[var(--color-neutral-200)] bg-[var(--color-bg-card)]";
  return (
    <div className={`rounded-[var(--radius-s)] border ${toneClass} px-3 py-2`}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12px] leading-5 text-[var(--color-text-default)]">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</p>
      {children}
    </section>
  );
}

export function ChatMessage({
  message,
  assistantLabel = "Assistant",
}: {
  message: ChatMessageModel;
  assistantLabel?: string;
}) {
  const isAssistant = message.role === "assistant";
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      const md = messageToMarkdown(message);
      await navigator.clipboard.writeText(md);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  }

  function handleDownload() {
    const md = messageToMarkdown(message);
    const stamp = new Date().toISOString().slice(0, 10);
    const tag = (message.mode ?? "chat").replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    downloadMarkdown(md, `${assistantLabel.toLowerCase()}-${tag}-${stamp}.md`);
  }

  return (
    <article
      className={[
        "rounded-[var(--radius-m)] border px-4 py-4 shadow-[var(--shadow-4dp)]",
        isAssistant
          ? "border-[var(--color-neutral-200)] bg-[var(--color-bg-card)]"
          : "border-[var(--color-brand-100)] bg-[var(--color-brand-50)]",
      ].join(" ")}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)]">
            {isAssistant ? assistantLabel : "Tú"}
          </p>
          {message.mode ? (
            <span className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[var(--color-text-secondary)]">
              {message.mode}
            </span>
          ) : null}
        </div>
        {isAssistant ? (
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopy}
              title="Copiar como Markdown"
              className="flex h-7 items-center gap-1 rounded-[var(--radius-s)] border border-transparent px-2 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-neutral-200)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]"
            >
              {copied ? <Check size={12} /> : <Copy size={12} />}
              {copied ? "Copiado" : "Copiar"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Descargar como .md"
              className="flex h-7 items-center gap-1 rounded-[var(--radius-s)] border border-transparent px-2 text-[11px] font-medium text-[var(--color-text-secondary)] transition hover:border-[var(--color-neutral-200)] hover:bg-[var(--color-neutral-100)] hover:text-[var(--color-text-default)]"
            >
              <Download size={12} />
              Descargar
            </button>
          </div>
        ) : null}
      </div>

      {isAssistant && message.filters_applied
        ? (() => {
            const entries = Object.entries(message.filters_applied ?? {}).filter(
              ([, v]) => (Array.isArray(v) ? v.length : Boolean(v)),
            );
            if (!entries.length) return null;
            return (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
                <span className="font-semibold uppercase tracking-[0.1em]">Filtros aplicados</span>
                {entries.map(([key, value]) => (
                  <span
                    key={key}
                    className="rounded-full border border-[var(--color-brand-100)] bg-[var(--color-brand-50)] px-2 py-0.5 text-[10px] font-medium text-[var(--color-brand-500)]"
                  >
                    {key}:{" "}
                    {Array.isArray(value) ? value.join(", ") : String(value)}
                  </span>
                ))}
              </div>
            );
          })()
        : null}

      <div className="mt-3">
        {message.role === "assistant" && message.content ? (
          <AssistantMarkdown content={message.content} />
        ) : (
          <div className="whitespace-pre-wrap text-[13px] leading-6 text-[var(--color-text-default)]">{message.content}</div>
        )}
      </div>

      {message.warnings?.length ? (
        <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <p className="font-medium">Warnings</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {message.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {message.recommendation ? (
        <div className="mt-5">
          <RecommendationView recommendation={message.recommendation} />
        </div>
      ) : null}

      {message.chart ? (
        <div className="mt-5">
          <Section title="Auto chart">
            <ChartPreview chart={message.chart} />
          </Section>
        </div>
      ) : null}

      {message.table ? (
        <div className="mt-5">
          <Section title="Results table">
            <TableView table={message.table} />
          </Section>
        </div>
      ) : null}

      {message.quant_table ? (
        <div className="mt-5">
          <Section title="Quantitative results">
            <TableView table={message.quant_table} />
          </Section>
        </div>
      ) : null}

      {message.qual_table ? (
        <div className="mt-5">
          <Section title="Qualitative results">
            <TableView table={message.qual_table} />
          </Section>
        </div>
      ) : null}

      {message.search_results?.length ? (
        <div className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Search results</p>
          <div className="space-y-3">
            {message.search_results.map((item, index) => (
              <div key={`${item.company_name ?? "chunk"}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span>{item.company_name || "Sin empresa"}</span>
                  <span>{item.segment || "Sin segmento"}</span>
                  <span>{item.call_date || "Sin fecha"}</span>
                  <span>{item.source_type || "transcript"}</span>
                  {item.similarity != null ? <span>sim {item.similarity.toFixed(3)}</span> : null}
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.chunk_text || ""}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {message.search_sql_table ? (
        <div className="mt-5">
          <Section title="Complementary SQL">
            <TableView table={message.search_sql_table} />
          </Section>
        </div>
      ) : null}

      {(message.sql || message.quant_sql || message.qual_sql || message.search_sql) ? (
        <div className="mt-5 grid gap-3 lg:grid-cols-2">
          {message.sql ? (
            <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">Generated SQL</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">{message.sql}</pre>
            </details>
          ) : null}
          {message.quant_sql ? (
            <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">Quantitative SQL</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">{message.quant_sql}</pre>
            </details>
          ) : null}
          {message.qual_sql ? (
            <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">Qualitative SQL</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">{message.qual_sql}</pre>
            </details>
          ) : null}
          {message.search_sql ? (
            <details className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-medium text-slate-800">Search SQL</summary>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-xs text-slate-700">{message.search_sql}</pre>
            </details>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
