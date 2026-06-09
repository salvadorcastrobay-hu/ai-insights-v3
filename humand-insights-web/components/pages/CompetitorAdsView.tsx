"use client";

import { ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { PageTitle } from "@/components/pages/common";
import type { StoredAd } from "@/lib/competitor-ads/store";
import { cn } from "@/lib/utils";

type Props = {
  ads: StoredAd[];
  refreshedAt: string | null;
  canRefresh: boolean;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-AR");
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "nunca";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "nunca" : d.toLocaleString("es-AR");
}

type Group = {
  competitor: string;
  total: number;
  active: number;
  ads: StoredAd[];
};

export function CompetitorAdsView({ ads, refreshedAt, canRefresh }: Props) {
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
      .map(([competitor, list]) => ({
        competitor,
        total: list.length,
        active: list.filter((a) => a.is_active).length,
        ads: list,
      }))
      .sort((a, b) => b.active - a.active || b.total - a.total);
  }, [ads]);

  async function refresh() {
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch("/api/competitor-ads/refresh", { method: "POST" });
      const json = (await res.json()) as {
        totalUpserted?: number;
        error?: string;
        results?: Array<{ competitor: string; fetched: number; error?: string }>;
      };
      if (!res.ok) {
        setMsg(json.error ?? `Error ${res.status}`);
      } else {
        const failed = (json.results ?? []).filter((r) => r.error);
        setMsg(
          `Actualizado: ${json.totalUpserted ?? 0} avisos${
            failed.length ? ` · ${failed.length} competidores con error` : ""
          }`,
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
          subtitle="Avisos activos de competidores en la Meta Ad Library (Facebook/Instagram). Monitoreo on-demand."
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
              ? "Tocá “Actualizar” para traer los avisos activos de los competidores."
              : "Pedile a un admin que corra el primer refresh."}
          </p>
        </ChartCard>
      ) : (
        groups.map((g) => (
          <ChartCard key={g.competitor} title={g.competitor}>
            <p className="mb-3 text-[12px] text-[var(--color-text-secondary)]">
              <span className="font-semibold text-emerald-700">{g.active} activos</span> · {g.total} totales
            </p>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {g.ads.slice(0, 30).map((ad) => (
                <AdCard key={ad.ad_archive_id} ad={ad} />
              ))}
            </div>
            {g.ads.length > 30 ? (
              <p className="mt-2 text-[11px] text-[var(--color-text-secondary)]">
                Mostrando 30 de {g.ads.length}.
              </p>
            ) : null}
          </ChartCard>
        ))
      )}
    </div>
  );
}

function AdCard({ ad }: { ad: StoredAd }) {
  const thumb = ad.media.images[0] ?? null;
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
        <span className="text-[var(--color-text-secondary)]">desde {fmtDate(ad.ad_start_date)}</span>
      </div>

      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumb}
          alt=""
          className="h-28 w-full rounded-[var(--radius-s)] object-cover"
          loading="lazy"
        />
      ) : null}

      {ad.body_text ? (
        <p className="line-clamp-5 text-[12px] leading-snug text-[var(--color-text-default)]">
          {ad.body_text}
        </p>
      ) : (
        <p className="text-[12px] italic text-[var(--color-text-secondary)]">(sin copy)</p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
        {ad.publisher_platform.map((p) => (
          <span key={p} className="rounded-full bg-[var(--color-neutral-100)] px-1.5 py-0.5">
            {p.toLowerCase()}
          </span>
        ))}
        {ad.cta_text ? (
          <span className="rounded-full border border-[var(--color-neutral-200)] px-1.5 py-0.5">
            {ad.cta_text}
          </span>
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
