"use client";

import { ChevronDown, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { PageTitle } from "@/components/pages/common";
import type { AdInsight, StoredAd } from "@/lib/competitor-ads/store";
import { cn } from "@/lib/utils";

type Angle = {
  label: string;
  description: string;
  weight: number;
  related_pains: string[];
  example_copies: string[];
};
type Tally = { key: string; count: number };
type PerAd = {
  ad_archive_id: string;
  collation_id: string | null;
  goal: string;
  content_type: string;
  related_pains: string[];
};
type Synthesis = {
  summary: string;
  angles: Angle[];
  offer_types: string[];
  ads_analyzed: number;
  per_ad?: PerAd[];
  by_goal?: Tally[];
  by_content_type?: Tally[];
};

const GOAL_LABELS: Record<string, string> = {
  lead_gen: "Lead-gen",
  demo: "Demo",
  descarga: "Descarga",
  contenido: "Contenido",
  trafico: "Tráfico",
  otro: "Otro",
};
const CONTENT_LABELS: Record<string, string> = {
  caso_exito: "Caso de éxito",
  webinar: "Webinar",
  evento: "Evento",
  demo_producto: "Demo de producto",
  guia_descargable: "Guía descargable",
  calculadora: "Calculadora",
  blog_articulo: "Blog/artículo",
  lanzamiento_feature: "Lanzamiento",
  generico: "Genérico",
};
const goalLabel = (k: string) => GOAL_LABELS[k] ?? k;
const contentLabel = (k: string) => CONTENT_LABELS[k] ?? k;

type Props = {
  ads: StoredAd[];
  insights: AdInsight[];
  refreshedAt: string | null;
  canRefresh: boolean;
  readError?: string | null;
};

// Formateo determinístico en UTC (evita hydration mismatch).
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}
function fmtDateTime(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "nunca";
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  return `${fmtDate(iso)} ${hh}:${min} UTC`;
}

type Campaign = { lead: StoredAd; variants: number };
type Group = {
  competitor: string;
  active: number;
  total: number;
  campaigns: Campaign[];
  synthesis: Synthesis | null;
  classByKey: Map<string, PerAd>;
};

const campaignKey = (a: StoredAd) => a.collation_id ?? a.ad_archive_id;

function dedupeCampaigns(ads: StoredAd[]): Campaign[] {
  const map = new Map<string, Campaign>();
  for (const a of ads) {
    const key = campaignKey(a);
    const existing = map.get(key);
    if (existing) existing.variants += 1;
    else map.set(key, { lead: a, variants: 1 });
  }
  return [...map.values()];
}

export function CompetitorAdsView({ ads, insights, refreshedAt, canRefresh, readError }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const groups = useMemo<Group[]>(() => {
    const byComp = new Map<string, StoredAd[]>();
    for (const ad of ads) {
      const arr = byComp.get(ad.competitor) ?? [];
      arr.push(ad);
      byComp.set(ad.competitor, arr);
    }
    return [...byComp.entries()]
      .map(([competitor, list]) => {
        const ins = insights.find((i) => i.competitor === competitor);
        const synthesis = (ins?.payload as Synthesis | undefined) ?? null;
        const classByKey = new Map<string, PerAd>();
        for (const p of synthesis?.per_ad ?? []) {
          classByKey.set(p.collation_id ?? p.ad_archive_id, p);
        }
        return {
          competitor,
          active: list.filter((a) => a.is_active).length,
          total: list.length,
          campaigns: dedupeCampaigns(list),
          synthesis,
          classByKey,
        };
      })
      .sort((a, b) => b.active - a.active || b.total - a.total);
  }, [ads, insights]);

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/competitor-ads/refresh", { method: "POST" });
      const json = (await res.json()) as {
        totalUpserted?: number;
        error?: string;
        results?: Array<{ competitor: string; error?: string; analyzeError?: string; analyzed?: boolean }>;
      };
      if (!res.ok) {
        setMsg(json.error ?? `Error ${res.status}`);
      } else {
        const results = json.results ?? [];
        const fetchErr = results.find((r) => r.error)?.error;
        const analyzeErr = results.find((r) => r.analyzeError)?.analyzeError;
        const analyzedOk = results.filter((r) => r.analyzed).length;
        const parts = [`Actualizado: ${json.totalUpserted ?? 0} avisos`];
        if (fetchErr) parts.push(`fetch falló: ${fetchErr}`);
        if (analyzeErr) parts.push(`análisis falló: ${analyzeErr}`);
        else parts.push(`análisis OK (${analyzedOk})`);
        setMsg(parts.join(" · "));
        router.refresh();
      }
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error al actualizar");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle
          title="Ads de Competidores"
          subtitle="Qué están comunicando los competidores en sus avisos (Meta Ad Library). Análisis on-demand."
        />
        <div className="flex flex-col items-end gap-1">
          {canRefresh ? (
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[var(--radius-s)] px-3.5 py-2 text-[13px] font-semibold transition",
                loading
                  ? "cursor-not-allowed bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]"
                  : "bg-[var(--color-brand-500)] text-white hover:opacity-90",
              )}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {loading ? "Actualizando…" : "Actualizar"}
            </button>
          ) : null}
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            Último refresh: {fmtDateTime(refreshedAt)}
          </span>
        </div>
      </div>

      {readError ? (
        <div className="rounded-[var(--radius-s)] border border-rose-300 bg-rose-50 px-3 py-2 text-[12px] text-rose-700">
          ⚠️ Error leyendo de la DB: <code className="font-mono">{readError}</code>
        </div>
      ) : null}

      {msg ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] px-3 py-2 text-[12px] text-[var(--color-brand-500)]">
          {msg}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <ChartCard>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Todavía no hay datos.{" "}
            {canRefresh
              ? "Tocá “Actualizar” para traer y analizar los avisos de los competidores."
              : "Pedile a un admin que corra el primer refresh."}
          </p>
        </ChartCard>
      ) : (
        groups.map((g) => (
          <ChartCard key={g.competitor} title={g.competitor}>
            <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
              <span className="font-semibold text-emerald-700">{g.active} avisos activos</span> ·{" "}
              {g.campaigns.length} campañas · {g.total} variantes
            </p>

            {g.synthesis ? <SynthesisBlock s={g.synthesis} /> : null}
            {g.synthesis ? <QuestionsBlock s={g.synthesis} campaigns={g.campaigns} /> : null}

            <CampaignGrid campaigns={g.campaigns} classByKey={g.classByKey} />
          </ChartCard>
        ))
      )}
    </div>
  );
}

// Grid de avisos con desplegable: muestra un preview y "Ver todos los anuncios".
function CampaignGrid({ campaigns, classByKey }: { campaigns: Campaign[]; classByKey: Map<string, PerAd> }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 6;
  const visible = expanded ? campaigns : campaigns.slice(0, PREVIEW);
  return (
    <>
      <p className="mb-2 mt-4 text-[12px] font-semibold text-[var(--color-text-default)]">
        Avisos (por campaña)
      </p>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visible.map((c) => (
          <AdCard key={campaignKey(c.lead)} c={c} cls={classByKey.get(campaignKey(c.lead)) ?? null} />
        ))}
      </div>
      {campaigns.length > PREVIEW ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-3 inline-flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-default)] transition hover:bg-[var(--color-neutral-100)]"
        >
          <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
          {expanded ? "Ver menos" : `Ver todos los anuncios (${campaigns.length})`}
        </button>
      ) : null}
    </>
  );
}

function SynthesisBlock({ s }: { s: Synthesis }) {
  return (
    <div className="rounded-[var(--radius-m)] border border-[var(--color-brand-200)] bg-gradient-to-b from-[var(--color-brand-50)] to-[var(--color-bg-card)] p-4">
      <div className="mb-2 flex items-center gap-2 text-[13px] font-semibold text-[var(--color-text-default)]">
        <Sparkles size={14} className="text-[var(--color-brand-500)]" />
        Qué está comunicando
        {s.ads_analyzed ? (
          <span className="font-normal text-[var(--color-text-secondary)]">· {s.ads_analyzed} campañas analizadas</span>
        ) : null}
      </div>
      {s.summary ? <p className="mb-3 text-[13px] leading-snug">{s.summary}</p> : null}

      <div className="space-y-2.5">
        {(s.angles ?? []).map((a, i) => (
          <div key={i} className="border-l-2 border-[var(--color-brand-200)] pl-3">
            <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
              <span className="font-semibold">{a.label}</span>
              {typeof a.weight === "number" ? (
                <span className="text-[11px] text-[var(--color-text-secondary)]">{a.weight} campañas</span>
              ) : null}
            </div>
            {a.description ? (
              <p className="text-[12px] text-[var(--color-text-secondary)]">{a.description}</p>
            ) : null}
            {a.related_pains?.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {a.related_pains.map((p) => (
                  <span
                    key={p}
                    className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600"
                    title="Pain de nuestra taxonomía al que apunta"
                  >
                    🎯 {p}
                  </span>
                ))}
              </div>
            ) : null}
            {a.example_copies?.length ? (
              <p className="mt-1 text-[11px] italic text-[var(--color-text-secondary)]">
                “{a.example_copies[0]}”
              </p>
            ) : null}
          </div>
        ))}
      </div>

      {s.offer_types?.length ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="text-[var(--color-text-secondary)]">Ofertas:</span>
          {s.offer_types.map((o) => (
            <span key={o} className="rounded-full border border-[var(--color-neutral-200)] px-1.5 py-0.5">
              {o}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// Bloque "qué responde esta data" — agregados que pidió el equipo:
// distribución por objetivo (CTA), por tipo de contenido y los avisos más
// longevos (proxy de "ad ganador": si lleva mucho corriendo, funciona).
function QuestionsBlock({ s, campaigns }: { s: Synthesis; campaigns: Campaign[] }) {
  const byGoal = s.by_goal ?? [];
  const byContent = (s.by_content_type ?? []).filter((t) => t.key !== "generico" || (s.by_content_type ?? []).length === 1);

  const veterans = [...campaigns]
    .filter((c) => c.lead.is_active && c.lead.ad_start_date)
    .sort((a, b) => (a.lead.ad_start_date ?? "").localeCompare(b.lead.ad_start_date ?? ""))
    .slice(0, 3);

  if (!byGoal.length && !byContent.length && !veterans.length) return null;

  return (
    <div className="mt-3 grid gap-3 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-4 md:grid-cols-3">
      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Por objetivo (CTA)
        </p>
        <div className="flex flex-wrap gap-1">
          {byGoal.length ? (
            byGoal.map((t) => (
              <span key={t.key} className="rounded-full bg-[var(--color-brand-50)] px-2 py-0.5 text-[11px] text-[var(--color-brand-500)]">
                {goalLabel(t.key)} <span className="font-semibold">{t.count}</span>
              </span>
            ))
          ) : (
            <span className="text-[11px] text-[var(--color-text-secondary)]">—</span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Tipos de contenido
        </p>
        <div className="flex flex-wrap gap-1">
          {byContent.length ? (
            byContent.map((t) => (
              <span key={t.key} className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px]">
                {contentLabel(t.key)} <span className="font-semibold">{t.count}</span>
              </span>
            ))
          ) : (
            <span className="text-[11px] text-[var(--color-text-secondary)]">—</span>
          )}
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
          Más longevos (probables ganadores)
        </p>
        <div className="space-y-0.5">
          {veterans.length ? (
            veterans.map((c) => (
              <p key={campaignKey(c.lead)} className="truncate text-[11px] text-[var(--color-text-default)]">
                <span className="text-[var(--color-text-secondary)]">desde {fmtDate(c.lead.ad_start_date)}</span>
                {" · "}
                {c.lead.title || c.lead.body_text?.slice(0, 40) || "(sin título)"}
              </p>
            ))
          ) : (
            <span className="text-[11px] text-[var(--color-text-secondary)]">—</span>
          )}
        </div>
      </div>
    </div>
  );
}

function AdCard({ c, cls }: { c: Campaign; cls: PerAd | null }) {
  const ad = c.lead;
  const thumb = ad.media?.images?.[0] ?? null;
  const platforms = ad.publisher_platform ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-3">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 font-medium",
            ad.is_active ? "bg-emerald-50 text-emerald-700" : "bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]",
          )}
        >
          {ad.is_active ? "Activo" : "Inactivo"}
        </span>
        <span className="text-[var(--color-text-secondary)]">
          {c.variants > 1 ? `${c.variants} variantes · ` : ""}desde {fmtDate(ad.ad_start_date)}
        </span>
      </div>

      {thumb ? (
        // Creativo completo (sin crop), centrado sobre fondo neutro, como en
        // Meta Ad Library. object-contain + tope de altura para que un retrato
        // muy alto no domine la tarjeta.
        <div className="overflow-hidden rounded-[var(--radius-s)] bg-[var(--color-neutral-100)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/competitor-ads/img?u=${encodeURIComponent(thumb)}`}
            alt=""
            className="mx-auto block max-h-[400px] w-full object-contain"
            loading="lazy"
          />
        </div>
      ) : null}

      {cls ? (
        <div className="flex flex-wrap gap-1">
          <span className="rounded-full bg-[var(--color-brand-50)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-brand-500)]">
            {goalLabel(cls.goal)}
          </span>
          {cls.content_type !== "generico" ? (
            <span className="rounded-full bg-[var(--color-neutral-100)] px-1.5 py-0.5 text-[10px] font-medium">
              {contentLabel(cls.content_type)}
            </span>
          ) : null}
          {cls.related_pains.map((p) => (
            <span
              key={p}
              className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600"
              title="Pain de nuestra taxonomía al que apunta"
            >
              🎯 {p}
            </span>
          ))}
        </div>
      ) : null}

      {ad.body_text ? (
        <p className="line-clamp-5 text-[12px] leading-snug text-[var(--color-text-default)]">{ad.body_text}</p>
      ) : (
        <p className="text-[12px] italic text-[var(--color-text-secondary)]">(sin copy)</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
        {platforms.map((p) => (
          <span key={p} className="rounded-full bg-[var(--color-neutral-100)] px-1.5 py-0.5">
            {p.toLowerCase()}
          </span>
        ))}
        {ad.cta_text ? (
          <span className="rounded-full border border-[var(--color-neutral-200)] px-1.5 py-0.5">{ad.cta_text}</span>
        ) : null}
      </div>

      {ad.link_url ? (
        <a
          href={ad.link_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-brand-500)] hover:underline"
        >
          <ExternalLink size={11} /> destino
        </a>
      ) : null}
    </div>
  );
}
