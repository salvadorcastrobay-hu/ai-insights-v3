"use client";

import { Sparkles, X, Send, Loader2, ArrowUpRight, BarChart3 } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useAskChart, type AskChartContext } from "./AskChartProvider";

type Message = { role: "user" | "assistant"; content: string };

const PAGE_META: Record<string, { label: string; suggestions: string[] }> = {
  "/executive-summary": {
    label: "Executive Summary",
    suggestions: [
      "¿Cuáles son los 3 pains más frecuentes y qué % representan?",
      "¿Qué región concentra más señales?",
      "Resumime el estado de la muestra en una frase.",
    ],
  },
  "/product-intelligence": {
    label: "Product Intelligence",
    suggestions: [
      "¿Qué feature gap tiene más revenue asociado?",
      "¿Qué módulos lideran en Enterprise?",
      "Top 3 pain themes con ejemplos de módulos afectados.",
    ],
  },
  "/competitive-intelligence": {
    label: "Competitive Intelligence",
    suggestions: [
      "¿Contra qué competidor perdemos más deals?",
      "¿Dónde aparece más Buk vs Senior?",
      "¿Qué industrias tienen más actividad competitiva?",
    ],
  },
  "/sales-enablement": {
    label: "Sales Enablement",
    suggestions: [
      "¿Qué fricción frena más deals y en qué stage?",
      "¿Cuánto revenue tenemos en riesgo por fricciones?",
      "Top 3 fricciones por segmento.",
    ],
  },
  "/regional-gtm": {
    label: "Regional / GTM",
    suggestions: [
      "¿Qué pain es único de HISPAM vs EMEA?",
      "¿Qué región está en mejor forma?",
      "Features más pedidas por región.",
    ],
  },
  "/pains-detail": {
    label: "Pains Detail",
    suggestions: [
      "¿Qué pain theme tiene más demos asociadas?",
      "¿Cuántos pains están vinculados a módulo vs sueltos?",
      "Dame ejemplos de pains del tema principal.",
    ],
  },
  "/product-gaps-detail": {
    label: "Product Gaps Detail",
    suggestions: [
      "¿Cuáles son los must-have más frecuentes?",
      "¿Cuántas features nuevas vs seed detectamos?",
      "Top feature gaps por revenue.",
    ],
  },
  "/faq-detail": {
    label: "FAQ Detail",
    suggestions: [
      "¿Qué FAQ aparece en más deals?",
      "¿Qué temas de FAQ son los más frecuentes?",
      "Resumen de FAQs de pricing.",
    ],
  },
  "/comparative-analysis": {
    label: "Comparative Analysis",
    suggestions: [
      "¿Qué cambió entre los últimos 30 días y los 30 previos?",
      "¿Qué región creció más?",
      "Delta principal en pains por segmento.",
    ],
  },
};

const DEFAULT_META = {
  label: "este dashboard",
  suggestions: [
    "Dame un resumen ejecutivo de lo filtrado.",
    "¿Qué señal sobresale?",
    "¿Qué debería revisar primero?",
  ],
};

function chartSuggestions(chart: AskChartContext): string[] {
  const first = chart.rows[0]?.label;
  const base = [
    `¿Qué historia cuenta "${chart.chartTitle}"?`,
    `¿Por qué ${first ? `"${first}" lidera` : "los primeros lideran"}?`,
    "Dame 3 bullets accionables para el equipo.",
  ];
  return base;
}

function countActiveFilters(f: Record<string, unknown>): number {
  let n = 0;
  for (const v of Object.values(f)) {
    if (Array.isArray(v) && v.length) n++;
    else if (typeof v === "string" && v) n++;
  }
  return n;
}

export function AskChartLauncher() {
  const { openGeneric } = useAskChart();
  return (
    <button
      type="button"
      onClick={openGeneric}
      className="group fixed bottom-6 right-6 z-40 flex h-14 items-center gap-2 rounded-full px-5 text-white shadow-[0_14px_40px_-10px_rgba(73,107,227,0.55)] transition-all hover:scale-[1.03] hover:shadow-[0_18px_50px_-10px_rgba(73,107,227,0.65)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-400)] focus:ring-offset-2"
      style={{ background: "linear-gradient(135deg, #496be3 0%, #6f93eb 45%, #9785ff 100%)" }}
      aria-label="Preguntar"
    >
      <span className="relative flex h-6 w-6 items-center justify-center">
        <span className="absolute inset-0 animate-ping rounded-full bg-white/30" />
        <Sparkles className="relative h-4 w-4" />
      </span>
      <span className="text-[13px] font-semibold tracking-wide">Preguntar</span>
      <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-white/90 md:inline">
        ⌘K
      </kbd>
    </button>
  );
}

export function AskChartSheet() {
  const { isOpen, close, chart, filters } = useAskChart();
  const pathname = usePathname();
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const pageMeta = PAGE_META[pathname ?? ""] ?? DEFAULT_META;
  const suggestions = chart ? chartSuggestions(chart) : pageMeta.suggestions;
  const activeFilterCount = countActiveFilters(filters);

  // Reset conversation when scope (chart vs page) changes or sheet re-opens on a new target
  useEffect(() => {
    if (!isOpen) return;
    setMessages([]);
    setInput("");
  }, [isOpen, chart?.chartTitle]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isStreaming]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) close();
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        // toggle handled elsewhere via launcher; do nothing if already open
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  const send = useCallback(
    async (questionArg?: string) => {
      const question = (questionArg ?? input).trim();
      if (!question || isStreaming) return;
      setInput("");
      setMessages((m) => [...m, { role: "user", content: question }, { role: "assistant", content: "" }]);
      setIsStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        const res = await fetch("/api/ask-chart", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question,
            pathname,
            filters,
            chartContext: chart ?? null,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const txt = await res.text().catch(() => "");
          throw new Error(txt || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let acc = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((m) => {
            const out = [...m];
            out[out.length - 1] = { role: "assistant", content: acc };
            return out;
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Error desconocido";
        setMessages((m) => {
          const out = [...m];
          out[out.length - 1] = { role: "assistant", content: `⚠️ ${msg}` };
          return out;
        });
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [input, isStreaming, pathname, filters, chart],
  );

  const stop = () => {
    abortRef.current?.abort();
    setIsStreaming(false);
  };

  const reset = () => {
    abortRef.current?.abort();
    setMessages([]);
    setInput("");
  };

  if (!isOpen) return null;

  const scopeLabel = chart?.chartTitle ?? pageMeta.label;
  const scopeSub = chart ? `en ${pageMeta.label}` : undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={close} role="presentation">
      <div className="absolute inset-0 bg-[#0a0f1f]/30 backdrop-blur-[2px] animate-[fadeIn_.18s_ease-out]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex h-full w-full max-w-[440px] flex-col border-l border-white/60 bg-white shadow-[-16px_0_60px_-16px_rgba(33,52,120,0.18)] animate-[slideIn_.24s_cubic-bezier(.2,.9,.3,1)]"
      >
        <div
          className="relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #f1f4fd 0%, #dee5fb 50%, #eff2ff 100%)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-10 h-40 w-40 rounded-full opacity-60 blur-2xl"
            style={{ background: "radial-gradient(closest-side, #9785ff 0%, transparent 70%)" }}
          />
          <div className="relative flex items-start justify-between px-5 pb-4 pt-5">
            <div className="min-w-0 flex-1 pr-3">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-sm"
                  style={{ background: "linear-gradient(135deg, #496be3 0%, #9785ff 100%)" }}
                >
                  {chart ? <BarChart3 className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                </div>
                <h2 className="truncate text-[16px] font-semibold text-[var(--color-text-default)]">
                  {chart ? "Preguntar al gráfico" : "Preguntar al dashboard"}
                </h2>
              </div>
              <p className="mt-1.5 truncate text-[12px] text-[var(--color-text-secondary)]">
                Scope:{" "}
                <span className="font-medium text-[var(--color-text-default)]">{scopeLabel}</span>
                {scopeSub ? <span> {scopeSub}</span> : null}
                {activeFilterCount > 0 ? (
                  <>
                    {" "}
                    ·{" "}
                    <span className="inline-flex items-center gap-1 rounded-full bg-[var(--color-brand-500)]/10 px-2 py-[1px] text-[11px] font-medium text-[var(--color-brand-500)]">
                      {activeFilterCount} filtro{activeFilterCount === 1 ? "" : "s"}
                    </span>
                  </>
                ) : null}
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              className="rounded-md p-1 text-[var(--color-text-secondary)] hover:bg-white/60"
              aria-label="Cerrar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 ? (
            <div>
              <p className="mb-3 text-[12px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                Probá con
              </p>
              <div className="space-y-2">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="group flex w-full items-center justify-between gap-2 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white px-3.5 py-2.5 text-left text-[13px] text-[var(--color-text-default)] transition-all hover:border-[var(--color-brand-400)] hover:bg-[var(--color-brand-50)] hover:shadow-[var(--shadow-4dp)]"
                  >
                    <span>{s}</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-secondary)] transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-[var(--color-brand-500)]" />
                  </button>
                ))}
              </div>
              {chart ? (
                <div className="mt-4 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-brand-50)]/50 px-3 py-2 text-[11px] leading-relaxed text-[var(--color-text-secondary)]">
                  <span className="font-semibold text-[var(--color-text-default)]">
                    {chart.rows.length} filas
                  </span>{" "}
                  visibles en este gráfico. Respondo solo con esos datos y los filtros globales.
                </div>
              ) : (
                <p className="mt-4 text-[11px] text-[var(--color-text-secondary)]">
                  Usa los datos filtrados actuales. Si cambiás filtros, preguntá de nuevo.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((m, i) => (
                <MessageBubble
                  key={i}
                  role={m.role}
                  content={m.content}
                  streaming={i === messages.length - 1 && isStreaming && m.role === "assistant"}
                />
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--color-neutral-200)] bg-white px-4 py-3">
          {messages.length > 0 ? (
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={reset}
                disabled={isStreaming}
                className="text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-default)] disabled:opacity-50"
              >
                Nueva conversación
              </button>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stop}
                  className="text-[11px] font-medium text-[var(--color-brand-500)] hover:underline"
                >
                  Detener
                </button>
              ) : null}
            </div>
          ) : null}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="relative"
          >
            <div
              className={`rounded-[var(--radius-m)] border bg-white transition-all ${
                isStreaming
                  ? "border-[var(--color-brand-400)] shadow-[0_0_0_3px_rgba(111,147,235,0.2)]"
                  : "border-[var(--color-neutral-200)] focus-within:border-[var(--color-brand-400)] focus-within:shadow-[0_0_0_3px_rgba(111,147,235,0.2)]"
              }`}
            >
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                rows={2}
                placeholder={chart ? "Preguntá sobre este gráfico…" : "Ej: ¿qué cambió esta semana?"}
                disabled={isStreaming}
                className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13px] text-[var(--color-text-default)] placeholder:text-[var(--color-text-secondary)] focus:outline-none disabled:opacity-60"
              />
              <div className="flex items-center justify-between border-t border-[var(--color-neutral-100)] px-3 py-1.5">
                <span className="text-[10px] text-[var(--color-text-secondary)]">
                  Enter para enviar · Shift+Enter nueva línea
                </span>
                <button
                  type="submit"
                  disabled={!input.trim() || isStreaming}
                  className="flex h-7 w-7 items-center justify-center rounded-md text-white transition-all disabled:cursor-not-allowed disabled:opacity-40"
                  style={{
                    background:
                      input.trim() && !isStreaming
                        ? "linear-gradient(135deg, #496be3 0%, #9785ff 100%)"
                        : "var(--color-neutral-200)",
                  }}
                  aria-label="Enviar"
                >
                  {isStreaming ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Send className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      </aside>

      <style jsx global>{`
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes slideIn {
          from { transform: translateX(24px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  streaming,
}: {
  role: "user" | "assistant";
  content: string;
  streaming: boolean;
}) {
  if (role === "user") {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[85%] rounded-[var(--radius-m)] px-3.5 py-2 text-[13px] text-white shadow-sm"
          style={{ background: "linear-gradient(135deg, #496be3 0%, #6f93eb 100%)" }}
        >
          {content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2">
      <div
        className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
        style={{ background: "linear-gradient(135deg, #496be3 0%, #9785ff 100%)" }}
      >
        <Sparkles className="h-3 w-3" />
      </div>
      <div className="max-w-[85%] rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white px-3.5 py-2 text-[13px] leading-relaxed text-[var(--color-text-default)] shadow-sm">
        {content ? (
          <div className="ask-chart-md">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: (props) => <p className="mb-2 last:mb-0 leading-relaxed" {...props} />,
                ul: (props) => <ul className="mb-2 list-disc space-y-1 pl-4 last:mb-0" {...props} />,
                ol: (props) => <ol className="mb-2 list-decimal space-y-1 pl-4 last:mb-0" {...props} />,
                li: (props) => <li className="leading-relaxed" {...props} />,
                strong: (props) => <strong className="font-semibold text-[var(--color-text-default)]" {...props} />,
                em: (props) => <em className="italic" {...props} />,
                code: (props) => <code className="rounded bg-[var(--color-neutral-100)] px-1 py-0.5 font-mono text-[12px]" {...props} />,
                h1: (props) => <h4 className="mb-1 mt-2 text-[14px] font-semibold" {...props} />,
                h2: (props) => <h4 className="mb-1 mt-2 text-[14px] font-semibold" {...props} />,
                h3: (props) => <h4 className="mb-1 mt-2 text-[13px] font-semibold" {...props} />,
                h4: (props) => <h4 className="mb-1 mt-2 text-[13px] font-semibold" {...props} />,
                a: (props) => <a className="text-[var(--color-brand-500)] underline" target="_blank" rel="noreferrer" {...props} />,
                blockquote: (props) => <blockquote className="my-1 border-l-2 border-[var(--color-brand-400)] pl-2 italic text-[var(--color-text-secondary)]" {...props} />,
              }}
            >
              {content}
            </ReactMarkdown>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-[var(--color-text-secondary)]">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-brand-400)]" />
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-brand-400)]" style={{ animationDelay: "150ms" }} />
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--color-brand-400)]" style={{ animationDelay: "300ms" }} />
          </div>
        )}
        {streaming && content ? (
          <span className="ml-1 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-[var(--color-brand-400)]" />
        ) : null}
      </div>
    </div>
  );
}
