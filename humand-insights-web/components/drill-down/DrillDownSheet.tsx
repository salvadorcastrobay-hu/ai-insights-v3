"use client";

import { Building2, Quote, TrendingUp, X, Layers3, Target, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { useDrillDown } from "./DrillDownProvider";
import { useTaxonomyLabel } from "@/lib/taxonomy-labels";

type SubRow = { name: string; value: number };
type QuoteRow = {
  id: string;
  summary: string;
  quote: string | null;
  company: string | null;
  deal_name: string | null;
  deal_id: string | null;
  call_date: string | null;
  segment: string | null;
  region: string | null;
  country: string | null;
  confidence: number | null;
  subtype: string | null;
  amount: number | null;
};

type DrillResponse = {
  dimension: string;
  value: string;
  subDimension: string;
  totals: { insights: number; unique_transcripts: number; unique_deals: number; revenue_usd: number };
  subBreakdown: SubRow[];
  segmentSplit: SubRow[];
  regionSplit: SubRow[];
  industrySplit: SubRow[];
  stageSplit: SubRow[];
  quotes: QuoteRow[];
};

const SUB_DIM_KEYS: Record<string, string> = {
  insight_subtype_display: "insight_subtype_display",
  competitor_relationship_display: "competitor_relationship_display",
  gap_priority: "gap_priority",
  deal_stage: "deal_stage",
  module_status: "module_status",
  module_display: "module_display",
};

const DIM_KEYS: Record<string, string> = {
  pain_theme: "pain_theme",
  competitor_name: "competitor_name",
  feature_display: "feature_display",
  friction_subtype: "friction_subtype",
  module_display: "module_display",
  insight_subtype_display: "insight_subtype_display",
};

function fmtUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString("es-AR", { year: "numeric", month: "short", day: "numeric" });
  } catch {
    return iso;
  }
}

export function DrillDownSheet() {
  const t = useTranslations("drillDown");
  const tl = useTaxonomyLabel();
  const { current, close, filters, isOpen } = useDrillDown();
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"sub" | "quotes" | "split">("sub");

  useEffect(() => {
    if (!current) return;
    setData(null);
    setError(null);
    setLoading(true);
    setTab("sub");
    const ctrl = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/drill-down", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dimension: current.dimension,
            value: current.value,
            filters,
            scopeType: current.scopeType,
          }),
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(await res.text());
        const json = (await res.json()) as DrillResponse;
        setData(json);
      } catch (e) {
        if ((e as { name?: string })?.name === "AbortError") return;
        setError(e instanceof Error ? e.message : "Error");
      } finally {
        setLoading(false);
      }
    })();
    return () => ctrl.abort();
  }, [current, filters]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, close]);

  if (!isOpen || !current) return null;

  const dimKey = DIM_KEYS[current.dimension];
  const dimLabel = dimKey ? t(`labels.${dimKey}` as Parameters<typeof t>[0]) : (current.label ?? current.dimension);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      onClick={close}
      role="presentation"
    >
      <div className="absolute inset-0 bg-[#0a0f1f]/30 backdrop-blur-[2px] animate-[fadeIn_.18s_ease-out]" />
      <aside
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 flex h-full w-full max-w-[560px] flex-col border-l border-white/60 bg-white shadow-[-16px_0_60px_-16px_rgba(33,52,120,0.2)] animate-[slideIn_.24s_cubic-bezier(.2,.9,.3,1)]"
      >
        {/* Header */}
        <div
          className="relative overflow-hidden"
          style={{ background: "linear-gradient(135deg, #f1f4fd 0%, #dee5fb 55%, #eff2ff 100%)" }}
        >
          <div
            aria-hidden
            className="pointer-events-none absolute -right-8 -top-10 h-44 w-44 rounded-full opacity-60 blur-2xl"
            style={{ background: "radial-gradient(closest-side, #9785ff 0%, transparent 70%)" }}
          />
          <div className="relative flex items-start justify-between px-5 pb-4 pt-5">
            <div className="min-w-0 flex-1 pr-3">
              <div className="flex items-center gap-2">
                <div
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-white shadow-sm"
                  style={{ background: "linear-gradient(135deg, #496be3 0%, #9785ff 100%)" }}
                >
                  <Layers3 className="h-3.5 w-3.5" />
                </div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
                  {dimLabel}
                </span>
              </div>
              <h2 className="mt-1.5 truncate text-[18px] font-semibold leading-tight text-[var(--color-text-default)]">
                {tl(current.value)}
              </h2>
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
          {/* KPIs */}
          {data ? (
            <div className="relative grid grid-cols-4 gap-2 px-5 pb-4">
              <Kpi label={t("insights")} value={data.totals.insights.toLocaleString("en-US")} />
              <Kpi label={t("calls")} value={data.totals.unique_transcripts.toLocaleString("en-US")} />
              <Kpi label={t("deals")} value={data.totals.unique_deals.toLocaleString("en-US")} />
              <Kpi label={t("revenue")} value={fmtUSD(data.totals.revenue_usd)} />
            </div>
          ) : (
            <div className="relative grid grid-cols-4 gap-2 px-5 pb-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-[52px] animate-pulse rounded-[var(--radius-m)] bg-white/50" />
              ))}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex shrink-0 items-center gap-1 border-b border-[var(--color-neutral-200)] bg-white px-3">
          <TabBtn active={tab === "sub"} onClick={() => setTab("sub")} icon={<Target className="h-3.5 w-3.5" />}>
            {data ? (SUB_DIM_KEYS[data.subDimension] ? t(`labels.${SUB_DIM_KEYS[data.subDimension]}` as Parameters<typeof t>[0]) : t("subtypes")) : t("subtypes")}
          </TabBtn>
          <TabBtn active={tab === "quotes"} onClick={() => setTab("quotes")} icon={<Quote className="h-3.5 w-3.5" />}>
            {t("verbatims")} {data?.quotes?.length ? `(${data.quotes.length})` : ""}
          </TabBtn>
          <TabBtn active={tab === "split"} onClick={() => setTab("split")} icon={<TrendingUp className="h-3.5 w-3.5" />}>
            {t("cuts")}
          </TabBtn>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto bg-[var(--color-bg-page)]">
          {loading ? (
            <div className="flex h-40 items-center justify-center text-[var(--color-text-secondary)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="ml-2 text-[13px]">{t("loading")}</span>
            </div>
          ) : error ? (
            <div className="m-4 rounded-[var(--radius-m)] border border-red-200 bg-red-50 p-3 text-[12px] text-red-900">
              {error}
            </div>
          ) : data ? (
            <>
              {tab === "sub" ? <SubBreakdown rows={data.subBreakdown} tl={tl} /> : null}
              {tab === "quotes" ? <QuotesList quotes={data.quotes} tl={tl} /> : null}
              {tab === "split" ? (
                <div className="space-y-3 p-4">
                  <MiniBars title={t("bySegment")} rows={data.segmentSplit} />
                  <MiniBars title={t("byRegion")} rows={data.regionSplit} />
                  <MiniBars title={t("byIndustry")} rows={data.industrySplit} />
                  <MiniBars title={t("byStage")} rows={data.stageSplit} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideIn {
          from { transform: translateX(24px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
      `}</style>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-m)] border border-white/80 bg-white/70 px-2.5 py-1.5 backdrop-blur-sm">
      <div className="text-[9px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
        {label}
      </div>
      <div className="mt-0.5 truncate text-[13px] font-semibold text-[var(--color-text-default)]">
        {value}
      </div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[12px] font-medium transition-colors ${
        active
          ? "border-[var(--color-brand-500)] text-[var(--color-brand-500)]"
          : "border-transparent text-[var(--color-text-secondary)] hover:text-[var(--color-text-default)]"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}

function SubBreakdown({ rows, tl }: { rows: SubRow[]; tl: (s: string) => string }) {
  if (!rows.length) {
    return (
      <div className="m-4 rounded-[var(--radius-m)] border border-dashed border-[var(--color-neutral-200)] bg-white p-6 text-center text-[12px] text-[var(--color-text-secondary)]">
        Sin subtipos asociados.
      </div>
    );
  }
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="space-y-2 p-4">
      {rows.map((r) => (
        <div
          key={r.name}
          className="group rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white px-3 py-2.5 transition-colors hover:border-[var(--color-brand-400)]"
        >
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="truncate text-[13px] font-medium text-[var(--color-text-default)]">{tl(r.name)}</span>
            <span className="shrink-0 text-[12px] font-semibold text-[var(--color-brand-500)]">
              {r.value.toLocaleString("en-US")}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--color-neutral-100)]">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(4, (r.value / max) * 100)}%`,
                background: "linear-gradient(90deg, #6f93eb 0%, #9785ff 100%)",
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function QuotesList({ quotes, tl }: { quotes: QuoteRow[]; tl: (s: string) => string }) {
  if (!quotes.length) {
    return (
      <div className="m-4 rounded-[var(--radius-m)] border border-dashed border-[var(--color-neutral-200)] bg-white p-6 text-center text-[12px] text-[var(--color-text-secondary)]">
        No hay verbatims disponibles.
      </div>
    );
  }
  return (
    <div className="space-y-2.5 p-4">
      {quotes.map((q) => (
        <article
          key={q.id}
          className="rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white px-3.5 py-3 shadow-[var(--shadow-4dp)] transition-shadow hover:shadow-[var(--shadow-8dp)]"
        >
          {q.quote ? (
            <blockquote className="relative border-l-2 border-[var(--color-brand-400)] pl-3 text-[13px] italic leading-relaxed text-[var(--color-text-default)]">
              “{q.quote}”
            </blockquote>
          ) : (
            <p className="text-[13px] text-[var(--color-text-default)]">{q.summary}</p>
          )}
          {q.quote ? (
            <p className="mt-1.5 text-[11.5px] text-[var(--color-text-secondary)]">{q.summary}</p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--color-text-secondary)]">
            {q.company ? (
              <span className="inline-flex items-center gap-1">
                <Building2 className="h-3 w-3" />
                <span className="font-medium text-[var(--color-text-default)]">{q.company}</span>
              </span>
            ) : null}
            {q.deal_name ? <span className="truncate">· {q.deal_name}</span> : null}
            {q.segment ? <Chip>{q.segment}</Chip> : null}
            {q.region ? <Chip>{q.region}</Chip> : null}
            {q.subtype ? <Chip tone="brand">{tl(q.subtype)}</Chip> : null}
            {q.call_date ? <span className="ml-auto">{fmtDate(q.call_date)}</span> : null}
          </div>
        </article>
      ))}
    </div>
  );
}

function Chip({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "brand" }) {
  return (
    <span
      className={`rounded-full px-1.5 py-[1px] text-[10px] font-medium ${
        tone === "brand"
          ? "bg-[var(--color-brand-50)] text-[var(--color-brand-500)]"
          : "bg-[var(--color-neutral-100)] text-[var(--color-text-default)]"
      }`}
    >
      {children}
    </span>
  );
}

function MiniBars({ title, rows }: { title: string; rows: SubRow[] }) {
  if (!rows.length) return null;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <div className="rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-white p-3">
      <h4 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-text-secondary)]">
        {title}
      </h4>
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.name} className="flex items-center gap-2">
            <span className="w-[120px] shrink-0 truncate text-[12px] text-[var(--color-text-default)]">{r.name}</span>
            <div className="flex-1 h-1.5 rounded-full bg-[var(--color-neutral-100)]">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(3, (r.value / max) * 100)}%`,
                  background: "linear-gradient(90deg, #6f93eb 0%, #9785ff 100%)",
                }}
              />
            </div>
            <span className="shrink-0 text-[11px] font-semibold text-[var(--color-brand-500)]">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
