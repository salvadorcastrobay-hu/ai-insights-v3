"use client";

import { ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
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
type Synthesis = {
  summary: string;
  angles: Angle[];
  offer_types: string[];
  ads_analyzed: number;
};

type Props = {
  ads: StoredAd[];
  insights: AdInsight[];
  refreshedAt: string | null;
  canRefresh: boolean;
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
};

function dedupeCampaigns(ads: StoredAd[]): Campaign[] {
  const map = new Map<string, Campaign>();
  for (const a of ads) {
    const key = a.collation_id ?? a.ad_archive_id;
    const existing = map.get(key);
    if (existing) existing.variants += 1;
    else map.set(key, { lead: a, variants: 1 });
  }
  return [...map.values()];
}

export function CompetitorAdsView({ ads, insights, refreshedAt, canRefresh }: Props) {
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
        return {
          competitor,
          active: list.filter((a) => a.is_active).length,
          total: list.length,
          campaigns: dedupeCampaigns(list),
          synthesis: (ins?.payload as Synthesis | undefined) ?? null,
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
        results?: Array<{ competitor: string; error?: string; analyzed?: boolean }>;
      };
      if (!res.ok) {
        setMsg(json.error ?? `Error ${res.status}`);
      } else {
        const failed = (json.results ?? []).filter((r) => r.error);
        setMsg(
          `Actualizado: ${json.totalUpserted ?? 0} avisos${failed.length ? ` · ${failed.length} con error` : ""}. Análisis IA regenerado.`,
        );
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

            <p className="mb-2 mt-4 text-[12px] font-semibold text-[var(--color-text-default)]">
              Avisos (por campaña)
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.campaigns.slice(0, 30).map((c) => (
                <AdCard key={c.lead.collation_id ?? c.lead.ad_archive_id} c={c} />
              ))}
            </div>
            {g.campaigns.length > 30 ? (
              <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
                Mostrando 30 de {g.campaigns.length} campañas.
              </p>
            ) : null}
          </ChartCard>
        ))
      )}
    </div>
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

function AdCard({ c }: { c: Campaign }) {
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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/competitor-ads/img?u=${encodeURIComponent(thumb)}`}
          alt=""
          className="h-28 w-full rounded-[var(--radius-s)] object-cover"
          loading="lazy"
        />
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
