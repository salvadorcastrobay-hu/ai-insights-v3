"use client";

import { ChevronDown, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { PageTitle } from "@/components/pages/common";
import type { AdInsight, StoredAd } from "@/lib/competitor-ads/store";
import type { AdSource } from "@/lib/competitor-ads/types";
import type { StoredPost, OrganicInsight, OrganicSynthesis, OrganicProfile } from "@/lib/competitor-ads/organic-store";
import { cn } from "@/lib/utils";
import { useTaxonomyLabel } from "@/lib/taxonomy-labels";

type Angle = {
  label: string;
  description: string;
  weight: number;
  related_pains: string[];
  example_copies: string[];
  oldest_start?: string | null;
};
type Tally = { key: string; count: number };
type PerAd = {
  ad_archive_id: string;
  collation_id: string | null;
  goal: string;
  content_type: string;
  related_pains: string[];
  creative_text?: string | null;
  persona?: string | null;
  modules?: string[];
};
type SynthesisTranslation = {
  summary: string;
  angles: { label: string; description: string; example_copies: string[] }[];
  offer_types: string[];
};

type Synthesis = {
  summary: string;
  angles: Angle[];
  offer_types: string[];
  ads_analyzed: number;
  per_ad?: PerAd[];
  by_goal?: Tally[];
  by_content_type?: Tally[];
  by_module?: Tally[];
  by_persona?: Tally[];
  i18n?: Record<string, SynthesisTranslation>;
};

type Props = {
  ads: StoredAd[];
  insights: AdInsight[];
  refreshedAt: string | null;
  canRefresh: boolean;
  /** LinkedIn/Google Ads son WIP: solo habilitados para ciertos usuarios. */
  canRefreshWipSources?: boolean;
  readError?: string | null;
  organicPosts?: StoredPost[];
  organicInsights?: OrganicInsight[];
  organicProfiles?: OrganicProfile[];
};

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
  /** Síntesis IA por canal — cada fuente se analiza y guarda por separado. */
  synthesisBySource: Partial<Record<AdSource, Synthesis>>;
  /** Fuentes con al menos 1 aviso para este competidor, en orden de despliegue. */
  sourcesPresent: AdSource[];
  classByKey: Map<string, PerAd>;
};

const SOURCE_ORDER: AdSource[] = ["meta_ads", "linkedin_ads", "google_ads"];
const SOURCE_LABEL: Record<AdSource, string> = { meta_ads: "Meta", linkedin_ads: "LinkedIn", google_ads: "Google Ads" };

const campaignKey = (a: StoredAd) => a.collation_id ?? a.ad_archive_id;

/** URL a la ad library de origen (Meta/LinkedIn/Google), según `source`. */
function adLibraryUrl(a: StoredAd): string {
  if (a.source === "linkedin_ads") return `https://www.linkedin.com/ad-library/detail/${a.ad_archive_id}`;
  if (a.source === "google_ads") return `https://adstransparency.google.com/advertiser/${a.page_id}/creative/${a.ad_archive_id}`;
  return `https://www.facebook.com/ads/library/?id=${a.ad_archive_id}`;
}

function hasMedia(a: StoredAd): boolean {
  return (a.media?.images?.length ?? 0) > 0 || (a.media?.videos?.length ?? 0) > 0;
}

function mediaUrl(kind: "img" | "video", url: string, adArchiveId: string): string {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith(".fbcdn.net") || host.endsWith(".facebook.com")) {
      return `/api/competitor-ads/${kind}?u=${encodeURIComponent(url)}&ad=${encodeURIComponent(adArchiveId)}`;
    }
  } catch {
    return url;
  }
  return url;
}

function dedupeCampaigns(ads: StoredAd[]): Campaign[] {
  const map = new Map<string, Campaign>();
  for (const a of ads) {
    const key = campaignKey(a);
    const existing = map.get(key);
    if (existing) {
      existing.variants += 1;
      if (!hasMedia(existing.lead) && hasMedia(a)) existing.lead = a;
    } else {
      map.set(key, { lead: a, variants: 1 });
    }
  }
  return [...map.values()];
}

function campaignHasContent(c: Campaign, cls: PerAd | null): boolean {
  if (hasMedia(c.lead)) return true;
  if (c.lead.body_text && c.lead.body_text.trim()) return true;
  if (cls?.creative_text && cls.creative_text.trim()) return true;
  return false;
}

type TimeBucket = { label: string; count: number };
function campaignTimeStats(campaigns: Campaign[]): { oldest: string | null; new30: number; buckets: TimeBucket[] } {
  const now = Date.now();
  const DAY = 86_400_000;
  const active = campaigns.filter((c) => c.lead.is_active && c.lead.ad_start_date);
  let oldest: string | null = null;
  let new30 = 0;
  const b = { "≥6 meses": 0, "3–6 meses": 0, "1–3 meses": 0, "<1 mes": 0 };
  for (const c of active) {
    const iso = c.lead.ad_start_date as string;
    if (!oldest || iso < oldest) oldest = iso;
    const days = (now - new Date(iso).getTime()) / DAY;
    if (days <= 30) new30 += 1;
    if (days >= 182) b["≥6 meses"] += 1;
    else if (days >= 91) b["3–6 meses"] += 1;
    else if (days >= 30) b["1–3 meses"] += 1;
    else b["<1 mes"] += 1;
  }
  const buckets = (Object.entries(b) as [string, number][])
    .filter(([, count]) => count > 0)
    .map(([label, count]) => ({ label, count }));
  return { oldest, new30, buckets };
}

function ageBucketOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const days = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (Number.isNaN(days)) return null;
  if (days >= 182) return "≥6 meses";
  if (days >= 91) return "3–6 meses";
  if (days >= 30) return "1–3 meses";
  return "<1 mes";
}

type AdFilter = { kind: "goal" | "content_type" | "module" | "persona" | "age" | "format"; value: string };

function campaignMatches(c: Campaign, cls: PerAd | null, f: AdFilter): boolean {
  switch (f.kind) {
    case "goal":        return cls?.goal === f.value;
    case "content_type":return cls?.content_type === f.value;
    case "module":      return (cls?.modules ?? []).includes(f.value);
    case "persona":     return cls?.persona === f.value;
    case "age":         return ageBucketOf(c.lead.ad_start_date) === f.value;
    case "format":      return f.value === "video" ? Boolean(c.lead.media?.videos?.[0]) : !c.lead.media?.videos?.[0];
  }
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] transition",
        active
          ? "bg-[var(--color-brand-500)] text-white"
          : "bg-[var(--color-neutral-100)] hover:bg-[var(--color-neutral-200)]",
      )}
    >
      {children}
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function CompetitorAdsView({ ads, insights, refreshedAt, canRefresh, canRefreshWipSources = false, readError, organicPosts = [], organicInsights = [], organicProfiles = [] }: Props) {
  const router = useRouter();
  const t = useTranslations("competitorAds");
  const [loadingSource, setLoadingSource] = useState<"meta_ads" | "linkedin_ads" | "google_ads" | null>(null);
  const [organicLoading, setOrganicLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [organicMsg, setOrganicMsg] = useState<string | null>(null);
  const [view, setView] = useState<"inteligencia" | "organico" | "creativos">("inteligencia");
  const [selectedCompetitor, setSelectedCompetitor] = useState<string | null>(null);
  const [filter, setFilter] = useState<AdFilter | null>(null);

  const GOAL_LABELS: Record<string, string> = {
    lead_gen: t("goal.lead_gen"), demo: t("goal.demo"), descarga: t("goal.descarga"),
    contenido: t("goal.contenido"), trafico: t("goal.trafico"), otro: t("goal.otro"),
  };
  const CONTENT_LABELS: Record<string, string> = {
    caso_exito: t("contentType.caso_exito"), webinar: t("contentType.webinar"),
    evento: t("contentType.evento"), demo_producto: t("contentType.demo_producto"),
    guia_descargable: t("contentType.guia_descargable"), calculadora: t("contentType.calculadora"),
    blog_articulo: t("contentType.blog_articulo"), lanzamiento_feature: t("contentType.lanzamiento_feature"),
    generico: t("contentType.generico"),
  };
  const goalLabel = (k: string) => GOAL_LABELS[k] ?? k;
  const contentLabel = (k: string) => CONTENT_LABELS[k] ?? k;

  const groups = useMemo<Group[]>(() => {
    const byComp = new Map<string, StoredAd[]>();
    for (const ad of ads) {
      const arr = byComp.get(ad.competitor) ?? [];
      arr.push(ad);
      byComp.set(ad.competitor, arr);
    }
    return [...byComp.entries()]
      .map(([competitor, list]) => {
        const compInsights = insights.filter((i) => i.competitor === competitor);
        const synthesisBySource: Partial<Record<AdSource, Synthesis>> = {};
        const classByKey = new Map<string, PerAd>();
        for (const ins of compInsights) {
          const synthesis = ins.payload as Synthesis | undefined;
          if (!synthesis) continue;
          synthesisBySource[ins.source] = synthesis;
          for (const p of synthesis.per_ad ?? []) {
            classByKey.set(p.collation_id ?? p.ad_archive_id, p);
          }
        }
        const sourcesPresent = SOURCE_ORDER.filter((s) => list.some((a) => a.source === s));
        return {
          competitor,
          active: list.filter((a) => a.is_active).length,
          total: list.length,
          campaigns: dedupeCampaigns(list),
          synthesisBySource,
          sourcesPresent,
          classByKey,
        };
      })
      .sort((a, b) => b.active - a.active || b.total - a.total);
  }, [ads, insights]);

  const visibleGroups = useMemo(
    () => selectedCompetitor ? groups.filter((g) => g.competitor === selectedCompetitor) : groups,
    [groups, selectedCompetitor],
  );

  // Flat campaigns for Creativos view
  type FlatCampaign = { campaign: Campaign; competitor: string; cls: PerAd | null };
  const allFlatCampaigns = useMemo<FlatCampaign[]>(() => {
    return visibleGroups.flatMap((g) =>
      g.campaigns
        .filter((c) => campaignHasContent(c, g.classByKey.get(campaignKey(c.lead)) ?? null))
        .map((c) => ({ campaign: c, competitor: g.competitor, cls: g.classByKey.get(campaignKey(c.lead)) ?? null })),
    );
  }, [visibleGroups]);

  const filteredCampaigns = useMemo<FlatCampaign[]>(() => {
    if (!filter) return allFlatCampaigns;
    return allFlatCampaigns.filter(({ campaign, cls }) => campaignMatches(campaign, cls, filter));
  }, [allFlatCampaigns, filter]);

  // Aggregated filter chips across all visible campaigns
  const aggGoal = useMemo(() => {
    const m = new Map<string, number>();
    for (const { cls } of allFlatCampaigns) if (cls?.goal) m.set(cls.goal, (m.get(cls.goal) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  }, [allFlatCampaigns]);

  const aggContent = useMemo(() => {
    const m = new Map<string, number>();
    for (const { cls } of allFlatCampaigns)
      if (cls?.content_type && cls.content_type !== "generico")
        m.set(cls.content_type, (m.get(cls.content_type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }));
  }, [allFlatCampaigns]);

  const aggFormat = useMemo(() => {
    let video = 0, estatico = 0;
    for (const { campaign } of allFlatCampaigns) {
      if (campaign.lead.media?.videos?.[0]) video++; else estatico++;
    }
    return [
      ...(video ? [{ key: "video", label: "Video", count: video }] : []),
      ...(estatico ? [{ key: "estatico", label: "Estático", count: estatico }] : []),
    ];
  }, [allFlatCampaigns]);

  const aggAge = useMemo(
    () => campaignTimeStats(allFlatCampaigns.map((x) => x.campaign)).buckets,
    [allFlatCampaigns],
  );

  const pick = (kind: AdFilter["kind"], value: string) =>
    setFilter((f) => (f && f.kind === kind && f.value === value ? null : { kind, value }));

  const filterLabel = (f: AdFilter): string => {
    if (f.kind === "goal") return goalLabel(f.value);
    if (f.kind === "content_type") return contentLabel(f.value);
    if (f.kind === "format") return f.value === "video" ? t("video") : t("static");
    return f.value;
  };

  async function refresh(source: "meta_ads" | "linkedin_ads" | "google_ads") {
    setLoadingSource(source);
    setMsg(null);
    try {
      const res = await fetch(`/api/competitor-ads/refresh?source=${source}`, { method: "POST" });
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
      setLoadingSource(null);
    }
  }

  type OrganicJobResult = {
    competitor: string;
    fetched?: number;
    skipped?: number;
    archived?: number;
    upserted?: number;
    error?: string;
    analyzeError?: string;
    analyzed?: boolean;
  };
  type OrganicJob = {
    id: string;
    state: "queued" | "running" | "completed" | "failed";
    current?: string | null;
    totalUpserted?: number;
    results?: OrganicJobResult[];
    error?: string;
  };
  type OrganicJobResponse = { job?: OrganicJob; error?: string };

  const parseOrganicJobResponse = (rawText: string, fallback: string): OrganicJobResponse => {
    try {
      return JSON.parse(rawText) as OrganicJobResponse;
    } catch {
      return { error: rawText.trim().slice(0, 180) || fallback };
    }
  };

  const organicJobMessage = (job: OrganicJob): string => {
    const results = job.results ?? [];
    const fetched = results.reduce((acc, item) => acc + (item.fetched ?? 0), 0);
    const skipped = results.reduce((acc, item) => acc + (item.skipped ?? 0), 0);
    const archived = results.reduce((acc, item) => acc + (item.archived ?? 0), 0);
    const analyzedOk = results.filter((r) => r.analyzed).length;
    const fetchErr = results.find((r) => r.error)?.error;
    const analyzeErr = results.find((r) => r.analyzeError)?.analyzeError;
    const stateLabel =
      job.state === "completed"
        ? t("organic.jobCompleted")
        : job.state === "failed"
          ? t("organic.jobFailed")
          : t("organic.jobRunning", { current: job.current ?? "…" });
    const parts = [stateLabel, t("organic.updated", { upserted: job.totalUpserted ?? 0, fetched })];
    if (archived) parts.push(t("organic.archived", { count: archived }));
    if (skipped) parts.push(t("organic.skippedWithoutId", { count: skipped }));
    if (fetchErr) parts.push(t("organic.fetchFailed", { error: fetchErr }));
    if (analyzeErr) parts.push(t("organic.analysisFailed", { error: analyzeErr }));
    if (job.state === "completed") parts.push(t("organic.analysisOk", { count: analyzedOk }));
    if (job.error) parts.push(job.error);
    return parts.join(" · ");
  };

  async function pollOrganicJob(jobId: string): Promise<void> {
    for (let attempt = 0; attempt < 180; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, attempt < 3 ? 2000 : 4000));
      const res = await fetch(`/api/competitor-ads/organic-refresh/status?jobId=${encodeURIComponent(jobId)}`, {
        cache: "no-store",
      });
      const rawText = await res.text();
      const json = parseOrganicJobResponse(rawText, `Error ${res.status}`);
      if (!res.ok || !json.job) throw new Error(json.error ?? `Error ${res.status}`);
      setOrganicMsg(organicJobMessage(json.job));
      if (json.job.state === "completed" || json.job.state === "failed") {
        router.refresh();
        return;
      }
    }
    throw new Error(t("organic.jobTimeout"));
  }

  async function refreshOrganic() {
    setOrganicLoading(true);
    setOrganicMsg(null);
    try {
      const res = await fetch("/api/competitor-ads/organic-refresh", { method: "POST" });
      const rawText = await res.text();
      const json = parseOrganicJobResponse(rawText, `Error ${res.status}`);
      if (!res.ok || !json.job) {
        setOrganicMsg(json.error ?? `Error ${res.status}`);
        return;
      }
      setOrganicMsg(t("organic.jobStarted"));
      await pollOrganicJob(json.job.id);
    } catch (e) {
      setOrganicMsg(e instanceof Error ? e.message : "Error al actualizar orgánico");
    } finally {
      setOrganicLoading(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={t("title")} subtitle={t("subtitle")} />
        <div className="flex flex-col items-end gap-1">
          {canRefresh ? (
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => refresh("meta_ads")}
                disabled={loadingSource !== null}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[var(--radius-s)] px-3.5 py-2 text-[13px] font-semibold transition",
                  loadingSource !== null
                    ? "cursor-not-allowed bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]"
                    : "bg-[var(--color-brand-500)] text-white hover:opacity-90",
                )}
              >
                {loadingSource === "meta_ads" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {loadingSource === "meta_ads" ? t("refreshing") : t("refresh")}
              </button>
              {canRefreshWipSources ? (
                <>
                  <button
                    type="button"
                    onClick={() => refresh("linkedin_ads")}
                    disabled={loadingSource !== null}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] px-3.5 py-2 text-[13px] font-semibold transition",
                      loadingSource !== null
                        ? "cursor-not-allowed bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]"
                        : "bg-white text-[var(--color-text-default)] hover:bg-[var(--color-neutral-100)]",
                    )}
                  >
                    {loadingSource === "linkedin_ads" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {loadingSource === "linkedin_ads" ? t("refreshingLinkedin") : t("refreshLinkedin")}
                  </button>
                  <button
                    type="button"
                    onClick={() => refresh("google_ads")}
                    disabled={loadingSource !== null}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] px-3.5 py-2 text-[13px] font-semibold transition",
                      loadingSource !== null
                        ? "cursor-not-allowed bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]"
                        : "bg-white text-[var(--color-text-default)] hover:bg-[var(--color-neutral-100)]",
                    )}
                  >
                    {loadingSource === "google_ads" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    {loadingSource === "google_ads" ? t("refreshingGoogle") : t("refreshGoogle")}
                  </button>
                </>
              ) : null}
              <button
                type="button"
                onClick={refreshOrganic}
                disabled={organicLoading}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] px-3.5 py-2 text-[13px] font-semibold transition",
                  organicLoading
                    ? "cursor-not-allowed bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]"
                    : "bg-white text-[var(--color-text-default)] hover:bg-[var(--color-neutral-100)]",
                )}
              >
                {organicLoading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {organicLoading ? t("organic.refreshing") : t("organic.refresh")}
              </button>
            </div>
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
      {organicMsg ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-white px-3 py-2 text-[12px] text-[var(--color-text-default)]">
          {organicMsg}
        </div>
      ) : null}

      {groups.length === 0 ? (
        <ChartCard>
          <p className="text-[13px] text-[var(--color-text-secondary)]">
            Todavía no hay datos.{" "}
            {canRefresh ? t("noAdsAdmin") : t("noAdsUser")}
          </p>
        </ChartCard>
      ) : (
        <>
          {/* Controls: competitor pills + view tabs */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {groups.length > 1 ? (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => { setSelectedCompetitor(null); setFilter(null); }}
                  className={cn(
                    "rounded-full px-3 py-1 text-[12px] font-medium transition",
                    selectedCompetitor === null
                      ? "bg-[var(--color-brand-500)] text-white"
                      : "border border-[var(--color-neutral-200)] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-500)]",
                  )}
                >
                  Todos
                </button>
                {groups.map((g) => (
                  <button
                    key={g.competitor}
                    type="button"
                    onClick={() => { setSelectedCompetitor(g.competitor); setFilter(null); }}
                    className={cn(
                      "rounded-full px-3 py-1 text-[12px] font-medium transition",
                      selectedCompetitor === g.competitor
                        ? "bg-[var(--color-brand-500)] text-white"
                        : "border border-[var(--color-neutral-200)] text-[var(--color-text-secondary)] hover:border-[var(--color-brand-400)] hover:text-[var(--color-brand-500)]",
                    )}
                  >
                    {g.competitor}
                    <span className="ml-1 opacity-60">{g.active}</span>
                  </button>
                ))}
              </div>
            ) : <div />}

            {/* Tab toggle */}
            <div className="flex overflow-hidden rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-100)]">
              {(["inteligencia", ...(canRefresh ? ["organico"] : []), "creativos"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => { setView(tab as typeof view); setFilter(null); }}
                  className={cn(
                    "px-4 py-1.5 text-[12px] font-medium transition capitalize",
                    view === tab
                      ? "bg-white text-[var(--color-text-default)] shadow-[var(--shadow-4dp)]"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-default)]",
                  )}
                >
                  {tab === "inteligencia" ? "Inteligencia" : tab === "organico" ? "Orgánico" : "Creativos"}
                </button>
              ))}
            </div>
          </div>

          {view === "inteligencia" ? (
            <IntelligenceView groups={visibleGroups} />
          ) : view === "organico" ? (
            <OrganicView
              posts={organicPosts}
              insights={organicInsights}
              profiles={organicProfiles}
              selectedCompetitor={selectedCompetitor}
            />
          ) : (
            <CreativosView
              campaigns={filteredCampaigns}
              totalCount={allFlatCampaigns.length}
              filter={filter}
              filterLabel={filter ? filterLabel(filter) : null}
              onClear={() => setFilter(null)}
              aggGoal={aggGoal}
              aggContent={aggContent}
              aggFormat={aggFormat}
              aggAge={aggAge}
              onPick={pick}
              goalLabel={goalLabel}
              contentLabel={contentLabel}
            />
          )}
        </>
      )}
    </div>
  );
}

// ─── Intelligence view ────────────────────────────────────────────────────────

function IntelligenceView({ groups }: { groups: Group[] }) {
  if (!groups.length) return null;
  return (
    <div
      className={cn(
        "grid gap-4",
        groups.length === 1 && "grid-cols-1",
        groups.length === 2 && "grid-cols-2",
        groups.length >= 3 && "md:grid-cols-3",
      )}
    >
      {groups.map((g) => <IntelligenceColumn key={g.competitor} g={g} />)}
    </div>
  );
}

// Mapea el locale de next-intl al key guardado en i18n
const LOCALE_TO_I18N: Record<string, string> = {
  es: "es-AR",
  pt: "pt-BR",
  en: "en-US",
};

function IntelligenceColumn({ g }: { g: Group }) {
  const locale = useLocale();
  const ts = campaignTimeStats(g.campaigns);
  const i18nKey = LOCALE_TO_I18N[locale] ?? "es-AR";

  const [activeSource, setActiveSource] = useState<AdSource>(g.sourcesPresent[0] ?? "meta_ads");
  const source = g.sourcesPresent.includes(activeSource) ? activeSource : (g.sourcesPresent[0] ?? "meta_ads");
  const synthesis = g.synthesisBySource[source] ?? null;

  const tr = synthesis?.i18n?.[i18nKey];
  // summary, angles labels/descriptions/copies del idioma activo (fallback al original)
  const summary = tr?.summary ?? synthesis?.summary ?? null;
  const offerTypes = tr?.offer_types ?? synthesis?.offer_types ?? [];
  const angles = (synthesis?.angles ?? []).map((a, i) => ({
    ...a,
    label: tr?.angles[i]?.label ?? a.label,
    description: tr?.angles[i]?.description ?? a.description,
    example_copies: tr?.angles[i]?.example_copies ?? a.example_copies,
  }));
  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-4dp)]">
      {/* Header */}
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <h3 className="text-[16px] font-semibold text-[var(--color-text-default)]">{g.competitor}</h3>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
            {g.active} activos
          </span>
        </div>
        <p className="text-[11px] text-[var(--color-text-secondary)]">
          {g.total} avisos
          {ts.oldest ? <> · campaña más vieja desde {fmtDate(ts.oldest)}</> : null}
          {ts.new30 ? <> · {ts.new30} nuevas (30d)</> : null}
        </p>
      </div>

      {g.sourcesPresent.length > 1 ? (
        <div className="flex gap-1 border-b border-[var(--color-neutral-200)]">
          {g.sourcesPresent.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setActiveSource(s)}
              className={cn(
                "px-2 pb-1.5 text-[12px] font-medium transition",
                s === source
                  ? "border-b-2 border-[var(--color-brand-500)] text-[var(--color-brand-500)]"
                  : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-default)]",
              )}
            >
              {SOURCE_LABEL[s]}
            </button>
          ))}
        </div>
      ) : null}

      {synthesis ? (
        <>
          {summary ? (
            <p className="text-[12px] leading-snug text-[var(--color-text-secondary)]">{summary}</p>
          ) : null}

          {angles.length ? (
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                Ángulos de mensaje
              </p>
              {angles.map((a, i) => (
                <div key={i} className="border-l-2 border-[var(--color-brand-200)] pl-3">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-semibold text-[var(--color-text-default)]">{a.label}</span>
                    {typeof a.weight === "number" ? (
                      <span className="text-[11px] text-[var(--color-text-secondary)]">
                        {a.weight} campañas
                        {a.oldest_start ? <> · desde {fmtDate(a.oldest_start)}</> : null}
                      </span>
                    ) : null}
                  </div>
                  {a.description ? (
                    <p className="mt-0.5 text-[12px] leading-snug text-[var(--color-text-secondary)]">{a.description}</p>
                  ) : null}
                  {a.related_pains?.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {a.related_pains.map((p) => (
                        <span key={p} className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600">
                          🎯 {p}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {a.example_copies?.[0] ? (
                    <p className="mt-1 text-[11px] italic text-[var(--color-text-secondary)]">
                      &ldquo;{a.example_copies[0]}&rdquo;
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {offerTypes.length ? (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
              <span className="text-[var(--color-text-secondary)]">Offers:</span>
              {offerTypes.map((o) => (
                <span key={o} className="rounded-full border border-[var(--color-neutral-200)] px-1.5 py-0.5">{o}</span>
              ))}
            </div>
          ) : null}

          {synthesis.ads_analyzed ? (
            <p className="mt-auto text-[11px] text-[var(--color-text-secondary)]">
              <Sparkles size={10} className="mr-0.5 inline text-[var(--color-brand-500)]" />
              Basado en {synthesis.ads_analyzed} avisos analizados ({SOURCE_LABEL[source]})
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-[12px] italic text-[var(--color-text-secondary)]">
          Sin análisis disponible para {SOURCE_LABEL[source]}. Hacé un refresh para generar.
        </p>
      )}
    </div>
  );
}

// ─── Creativos view ───────────────────────────────────────────────────────────

type FlatCampaign = { campaign: Campaign; competitor: string; cls: PerAd | null };

function CreativosView({
  campaigns,
  totalCount,
  filter,
  filterLabel,
  onClear,
  aggGoal,
  aggContent,
  aggFormat,
  aggAge,
  onPick,
  goalLabel,
  contentLabel,
}: {
  campaigns: FlatCampaign[];
  totalCount: number;
  filter: AdFilter | null;
  filterLabel: string | null;
  onClear: () => void;
  aggGoal: Tally[];
  aggContent: Tally[];
  aggFormat: { key: string; label: string; count: number }[];
  aggAge: TimeBucket[];
  onPick: (kind: AdFilter["kind"], value: string) => void;
  goalLabel: (k: string) => string;
  contentLabel: (k: string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 9;
  const visible = expanded ? campaigns : campaigns.slice(0, PREVIEW);

  return (
    <div className="space-y-4">
      {/* Global filter chips */}
      <div className="rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-4">
        <div className="grid gap-4 md:grid-cols-4">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Objetivo
            </p>
            <div className="flex flex-wrap gap-1">
              {aggGoal.length ? aggGoal.map(({ key, count }) => (
                <Chip key={key} active={filter?.kind === "goal" && filter.value === key} onClick={() => onPick("goal", key)}>
                  {goalLabel(key)} <span className="font-semibold">{count}</span>
                </Chip>
              )) : <span className="text-[11px] text-[var(--color-text-secondary)]">—</span>}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Tipo de contenido
            </p>
            <div className="flex flex-wrap gap-1">
              {aggContent.length ? aggContent.map(({ key, count }) => (
                <Chip key={key} active={filter?.kind === "content_type" && filter.value === key} onClick={() => onPick("content_type", key)}>
                  {contentLabel(key)} <span className="font-semibold">{count}</span>
                </Chip>
              )) : <span className="text-[11px] text-[var(--color-text-secondary)]">—</span>}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Formato
            </p>
            <div className="flex flex-wrap gap-1">
              {aggFormat.length ? aggFormat.map(({ key, label, count }) => (
                <Chip key={key} active={filter?.kind === "format" && filter.value === key} onClick={() => onPick("format", key)}>
                  {label} <span className="font-semibold">{count}</span>
                </Chip>
              )) : <span className="text-[11px] text-[var(--color-text-secondary)]">—</span>}
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
              Antigüedad
            </p>
            <div className="flex flex-wrap gap-1">
              {aggAge.length ? aggAge.map(({ label, count }) => (
                <Chip key={label} active={filter?.kind === "age" && filter.value === label} onClick={() => onPick("age", label)}>
                  {label} <span className="font-semibold">{count}</span>
                </Chip>
              )) : <span className="text-[11px] text-[var(--color-text-secondary)]">—</span>}
            </div>
          </div>
        </div>
      </div>

      {/* Active filter */}
      {filter ? (
        <div className="flex items-center gap-2 text-[12px]">
          <span className="text-[var(--color-text-secondary)]">
            Filtro: <span className="font-semibold text-[var(--color-text-default)]">{filterLabel}</span>
            {" · "}{campaigns.length} de {totalCount} avisos
          </span>
          <button
            type="button"
            onClick={onClear}
            className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] px-2 py-0.5 text-[11px] font-medium hover:bg-[var(--color-neutral-100)]"
          >
            ✕ Limpiar
          </button>
        </div>
      ) : (
        <p className="text-[12px] text-[var(--color-text-secondary)]">
          {totalCount} avisos — filtrá haciendo click en los chips de arriba
        </p>
      )}

      {/* Flat grid */}
      {campaigns.length === 0 ? (
        <p className="rounded-[var(--radius-m)] border border-dashed border-[var(--color-neutral-200)] px-6 py-8 text-center text-[13px] text-[var(--color-text-secondary)]">
          Ningún aviso coincide con el filtro.
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visible.map(({ campaign, competitor, cls }) => (
              <AdCard key={campaignKey(campaign.lead)} c={campaign} cls={cls} competitor={competitor} />
            ))}
          </div>
          {campaigns.length > PREVIEW ? (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-text-default)] transition hover:bg-[var(--color-neutral-100)]"
            >
              <ChevronDown size={14} className={cn("transition-transform", expanded && "rotate-180")} />
              {expanded ? "Ver menos" : `Ver todos (${campaigns.length})`}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}

// ─── Ad card ──────────────────────────────────────────────────────────────────

function AdCard({ c, cls, competitor }: { c: Campaign; cls: PerAd | null; competitor?: string }) {
  const t = useTranslations("competitorAds");
  const tl = useTaxonomyLabel();
  const [showTranscript, setShowTranscript] = useState(false);
  const GOAL_LABELS: Record<string, string> = {
    lead_gen: t("goal.lead_gen"), demo: t("goal.demo"), descarga: t("goal.descarga"),
    contenido: t("goal.contenido"), trafico: t("goal.trafico"), otro: t("goal.otro"),
  };
  const CONTENT_LABELS: Record<string, string> = {
    caso_exito: t("contentType.caso_exito"), webinar: t("contentType.webinar"),
    evento: t("contentType.evento"), demo_producto: t("contentType.demo_producto"),
    guia_descargable: t("contentType.guia_descargable"), calculadora: t("contentType.calculadora"),
    blog_articulo: t("contentType.blog_articulo"), lanzamiento_feature: t("contentType.lanzamiento_feature"),
    generico: t("contentType.generico"),
  };
  const goalLabel = (k: string) => GOAL_LABELS[k] ?? k;
  const contentLabel = (k: string) => CONTENT_LABELS[k] ?? k;
  const ad = c.lead;
  const thumb = ad.media?.images?.[0] ?? null;
  const video = ad.media?.videos?.[0] ?? null;
  const platforms = ad.publisher_platform ?? [];
  return (
    <div className="flex flex-col gap-2 rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-3">
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <div className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 font-medium",
              ad.is_active ? "bg-emerald-50 text-emerald-700" : "bg-[var(--color-neutral-100)] text-[var(--color-text-secondary)]",
            )}
          >
            {ad.is_active ? t("active") : t("inactive")}
          </span>
          {competitor ? (
            <span className="rounded-full bg-[var(--color-brand-50)] px-1.5 py-0.5 font-medium text-[var(--color-brand-500)]">
              {competitor}
            </span>
          ) : null}
        </div>
        <span className="text-[var(--color-text-secondary)]">
          {c.variants > 1 ? `${c.variants} variantes · ` : ""}{t("since")} {fmtDate(ad.ad_start_date)}
        </span>
      </div>

      {video ? (
        <div className="overflow-hidden rounded-[var(--radius-s)] bg-[var(--color-neutral-100)]">
          <video
            controls
            preload="metadata"
            poster={thumb ? mediaUrl("img", thumb, ad.ad_archive_id) : undefined}
            className="mx-auto block max-h-[400px] w-full object-contain"
          >
            <source src={mediaUrl("video", video, ad.ad_archive_id)} />
          </video>
        </div>
      ) : thumb ? (
        <div className="overflow-hidden rounded-[var(--radius-s)] bg-[var(--color-neutral-100)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={mediaUrl("img", thumb, ad.ad_archive_id)}
            alt=""
            className="mx-auto block max-h-[400px] w-full object-contain"
            loading="lazy"
          />
        </div>
      ) : null}

      {cls?.creative_text ? (
        <>
          <button
            type="button"
            onClick={() => setShowTranscript(true)}
            className="self-start text-[10px] text-[var(--color-text-secondary)] underline hover:text-[var(--color-brand-500)]"
          >
            {t("transcription")}
          </button>
          {showTranscript && (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center"
              style={{ background: "rgba(0,0,0,0.25)" }}
              onClick={() => setShowTranscript(false)}
            >
              <div
                className="relative mx-4 w-full max-w-md rounded-[var(--radius-m)] bg-white p-5 shadow-[0_8px_32px_rgba(0,0,0,0.18)]"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[var(--color-text-default)]">{t("transcription")}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => navigator.clipboard.writeText(cls.creative_text ?? "")}
                      className="rounded p-1 text-[11px] text-[var(--color-text-secondary)] hover:bg-[var(--color-neutral-100)]"
                      title={t("copyToClipboard")}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowTranscript(false)}
                      className="rounded p-1 text-[var(--color-text-secondary)] hover:bg-[var(--color-neutral-100)]"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
                    </button>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-text-default)]">{cls.creative_text}</p>
              </div>
            </div>
          )}
        </>
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
          {cls.persona ? (
            <span
              className="rounded-full bg-[var(--color-neutral-100)] px-1.5 py-0.5 text-[10px] font-medium"
              title={t("personaTooltip")}
            >
              👤 {cls.persona}
            </span>
          ) : null}
          {(cls.modules ?? []).map((m) => (
            <span
              key={m}
              className="rounded-full bg-[var(--color-neutral-100)] px-1.5 py-0.5 text-[10px] text-[var(--color-text-secondary)]"
              title={t("moduleTooltip")}
            >
              {m}
            </span>
          ))}
          {cls.related_pains.map((p) => (
            <span
              key={p}
              className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] font-medium text-rose-600"
              title={t("painTooltip")}
            >
              🎯 {tl(p)}
            </span>
          ))}
        </div>
      ) : null}

      {ad.body_text ? (
        <p className="whitespace-pre-wrap text-[12px] leading-snug text-[var(--color-text-default)]">{ad.body_text}</p>
      ) : (
        <p className="text-[12px] italic text-[var(--color-text-secondary)]">{t("noCopy")}</p>
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

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <a
          href={adLibraryUrl(ad)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-brand-500)] hover:underline"
          title={t("adLibraryLink")}
        >
          <ExternalLink size={11} /> Ad Library
        </a>
        {ad.link_url ? (
          <a
            href={ad.link_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:underline"
            title={t("landingLink")}
          >
            <ExternalLink size={11} /> destino
          </a>
        ) : null}
      </div>
    </div>
  );
}

// ─── Organic view ─────────────────────────────────────────────────────────────

const DAY_ORDER = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
const JS_DAY_LABELS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const ORGANIC_TIMEZONE_LABEL = "GMT-3";
const ORGANIC_TIMEZONE_OFFSET_HOURS = -3;

type OrganicFilter = { kind: "format" | "pain" | "persona" | "module"; value: string };

function organicEngagement(post: StoredPost): number {
  return (post.likes_count ?? 0) + (post.comments_count ?? 0);
}

function postMatchesOrganicFilter(post: StoredPost, filter: OrganicFilter | null): boolean {
  if (!filter) return true;
  if (filter.kind === "format") return post.format === filter.value;
  if (filter.kind === "pain") return (post.analysis?.related_pains ?? []).includes(filter.value);
  if (filter.kind === "persona") return post.analysis?.persona === filter.value;
  if (filter.kind === "module") return (post.analysis?.modules ?? []).includes(filter.value);
  return true;
}

function topTallyValues(posts: StoredPost[], kind: OrganicFilter["kind"]): string[] {
  const values =
    kind === "format"
      ? posts.map((p) => p.format).filter((v): v is string => Boolean(v))
      : kind === "pain"
        ? posts.flatMap((p) => p.analysis?.related_pains ?? [])
        : kind === "persona"
          ? posts.map((p) => p.analysis?.persona).filter((v): v is string => Boolean(v))
          : posts.flatMap((p) => p.analysis?.modules ?? []);
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([value]) => value);
}

function tallyTextValues(values: string[], limit = 8): Tally[] {
  const counts = new Map<string, number>();
  for (const raw of values) {
    const value = raw.trim();
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => ({ key, count }));
}

function topTextValues(values: string[], limit = 8): string[] {
  return tallyTextValues(values, limit).map((item) => item.key);
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function organicPostHref(post: Pick<StoredPost, "post_id" | "post_url">): string {
  return post.post_url ?? `https://www.instagram.com/p/${post.post_id}/`;
}

function postHrefForId(posts: StoredPost[], postId: string): string {
  const post = posts.find((p) => p.post_id === postId);
  return post ? organicPostHref(post) : `https://www.instagram.com/p/${postId}/`;
}

function firstCaptionLine(post: StoredPost): string | null {
  const caption = post.caption?.replace(/\s+/g, " ").trim();
  if (!caption) return null;
  const sentence = caption.split(/(?<=[.!?])\s+/)[0]?.trim() || caption;
  return sentence.slice(0, 80);
}

function inferredHook(post: StoredPost): string | null {
  return post.analysis?.hook || firstCaptionLine(post);
}

function inferredTone(post: StoredPost): string | null {
  if (post.analysis?.tone) return post.analysis.tone;
  const text = `${post.caption ?? ""} ${post.analysis?.creative_text ?? ""}`.toLowerCase();
  if (!text.trim()) return null;
  if (/(meme|humor|jaja|😂|🤣|divertid|emoji|juego|jugando)/.test(text)) return "humorístico";
  if (/(guía|guia|tip|tips|aprend|cómo|como |claves|checklist|tutorial|manual)/.test(text)) return "educativo";
  if (/(hoy|ahora|últim|ultimo|alerta|urgente|no esperes|cupos)/.test(text)) return "urgente";
  if (/(futuro|transform|crec|mejor|logr|construy|potenci|inspir)/.test(text)) return "aspiracional";
  return "conversacional";
}

function inferredCtaStrength(post: StoredPost): string | null {
  if (post.analysis?.cta_strength && post.analysis.cta_strength !== "none") return post.analysis.cta_strength;
  const text = post.caption?.toLowerCase() ?? "";
  if (/(agenda|agendá|solicita|solicitá|descarga|descargá|inscríbete|inscribite|registr|compra|reserva|demo)/.test(text)) return "strong";
  if (/(conoce|conocé|lee|mira|mirá|descubre|descubrí|comenta|cuéntanos|contanos|link en bio|bio)/.test(text)) return "soft";
  return null;
}

function inferredOfferType(post: StoredPost): string | null {
  if (post.analysis?.offer_type) return post.analysis.offer_type;
  const text = post.caption?.toLowerCase() ?? "";
  if (/(webinar|masterclass)/.test(text)) return "webinar";
  if (/(evento|charla|encuentro|conferencia|feria)/.test(text)) return "evento";
  if (/(guía|guia|manual|ebook|checklist|descarga)/.test(text)) return "guía";
  if (/(demo|llamada|reunión|reunion)/.test(text)) return "demo";
  if (/(curso|certificación|certificacion|training|taller)/.test(text)) return "curso";
  if (/(producto|feature|funcionalidad|plataforma|software|app)/.test(text)) return "producto";
  return null;
}

type MentionCategory = "news" | "community" | "person" | "company" | "other";
type MentionSignal = { handle: string; count: number; category: MentionCategory };

function normalizeMention(value: string): string | null {
  const clean = value.replace(/^@/, "").trim().toLowerCase();
  return clean ? clean : null;
}

function classifyMentionHandle(handle: string): MentionCategory {
  const clean = handle.toLowerCase();
  if (/(news|noticias|diario|revista|magazine|radio|tv|medio|forbes|bloomberg|mercurio|emol|pulso|americaeconomia|exame|valor|infomoney)/.test(clean)) {
    return "news";
  }
  if (/(rrhh|hr|people|talent|recurso|human|work|empleo|labor|startup|saas|tech|comunidad|community)/.test(clean)) {
    return "community";
  }
  if (/(consult|partner|agency|agencia|studio|software|app|global|group|company|corp|empresa|[._](co|cl|br|mx|es|latam)$)/.test(clean)) {
    return "company";
  }
  if (/^[a-z]+[._][a-z]+/.test(clean)) return "person";
  return "other";
}

function organicMentionSignals(posts: StoredPost[]): {
  mentionedPosts: number;
  paidPartnershipPosts: number;
  signals: MentionSignal[];
} {
  const counts = new Map<string, number>();
  let mentionedPosts = 0;
  let paidPartnershipPosts = 0;
  for (const post of posts) {
    if (post.is_paid_partnership) paidPartnershipPosts += 1;
    const handles = [...new Set(post.mentions.map(normalizeMention).filter((value): value is string => Boolean(value)))];
    if (handles.length) mentionedPosts += 1;
    for (const handle of handles) counts.set(handle, (counts.get(handle) ?? 0) + 1);
  }
  const signals = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([handle, count]) => ({ handle, count, category: classifyMentionHandle(handle) }));
  return { mentionedPosts, paidPartnershipPosts, signals };
}

function postDayLabel(post: StoredPost): string | null {
  const date = organicTimezoneDate(post);
  if (!date) return null;
  return JS_DAY_LABELS[date.getUTCDay()] ?? null;
}

function postHourKey(post: StoredPost): string | null {
  const date = organicTimezoneDate(post);
  if (!date) return null;
  return `${String(date.getUTCHours()).padStart(2, "0")}:00`;
}

function organicTimezoneDate(post: StoredPost): Date | null {
  if (!post.posted_at) return null;
  const date = new Date(post.posted_at);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + ORGANIC_TIMEZONE_OFFSET_HOURS * 60 * 60 * 1000);
}

function profileFor(profiles: OrganicProfile[], competitor: string): OrganicProfile | null {
  return profiles.find((p) => p.competitor === competitor) ?? null;
}

function avgEngagementRate(posts: StoredPost[], profile: OrganicProfile | null): number | null {
  const followers = profile?.followers_count;
  if (!followers || followers <= 0 || !posts.length) return null;
  const avgEng = posts.reduce((sum, post) => sum + organicEngagement(post), 0) / posts.length;
  return avgEng / followers;
}

function pct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`;
}

function organicImgSrc(url: string | null): string | null {
  if (!url) return null;
  try {
    const host = new URL(url).hostname;
    if (host.endsWith(".cdninstagram.com") || host === "cdninstagram.com") {
      return `/api/competitor-ads/organic-img?u=${encodeURIComponent(url)}`;
    }
  } catch { /* noop */ }
  return url;
}

// Keyword → content_type mapping to find posts matching a pillar
function pillarContentType(pillar: string): string | null {
  const l = pillar.toLowerCase();
  if (/educac|tip|guía|aprendiz|mercado laboral|cumpli|lega/.test(l)) return "educativo";
  if (/testimon|caso.*(éxito|exito)|resultado|cliente/.test(l)) return "caso_exito";
  if (/comunidad|equipo|cultura|intern|gente|personas/.test(l)) return "comunidad";
  if (/product|feature|softwar|plataform|herramien|actuali/.test(l)) return "producto";
  if (/event|webinar|lanzam|feria|confer/.test(l)) return "evento";
  if (/entret|humor|lifestyle|estilo de vida/.test(l)) return "entretenimiento";
  if (/salud|bienestar|mental/.test(l)) return "comunidad";
  if (/benefici|remuner|pago|sueldo/.test(l)) return "educativo";
  return null;
}

function OrganicView({
  posts,
  insights,
  profiles,
  selectedCompetitor,
}: {
  posts: StoredPost[];
  insights: OrganicInsight[];
  profiles: OrganicProfile[];
  selectedCompetitor: string | null;
}) {
  const locale = useLocale();
  const i18nKey = LOCALE_TO_I18N[locale] ?? "es-AR";

  const competitors = useMemo(() => {
    const names = [...new Set(posts.map((p) => p.competitor))].sort();
    return selectedCompetitor ? names.filter((n) => n === selectedCompetitor) : names;
  }, [posts, selectedCompetitor]);

  if (!competitors.length) {
    return (
      <div className="rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] p-8 text-center">
        <p className="text-[13px] text-[var(--color-text-secondary)]">
          Sin datos orgánicos. Ejecutá POST /api/competitor-ads/organic-refresh para cargar posts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <OrganicBenchmark posts={posts} profiles={profiles} competitors={competitors} />
      <div
        className={cn(
          "grid gap-4",
          competitors.length === 1 && "grid-cols-1",
          competitors.length === 2 && "grid-cols-2",
          competitors.length >= 3 && "md:grid-cols-3",
        )}
      >
        {competitors.map((name) => {
          const compPosts = posts.filter((p) => p.competitor === name);
          const insight = insights.find((i) => i.competitor === name);
          const synth: OrganicSynthesis | undefined = insight?.payload;
          const tr = synth?.i18n?.[i18nKey];
          const summary = tr?.summary ?? synth?.summary ?? null;
          const pillars = tr?.content_pillars ?? synth?.content_pillars ?? [];
          const recommendations = tr?.recommendations ?? synth?.recommendations ?? [];
          return (
            <OrganicColumn
              key={name}
              name={name}
              posts={compPosts}
              profile={profileFor(profiles, name)}
              synth={synth}
              summary={summary}
              pillars={pillars}
              recommendations={recommendations}
            />
          );
        })}
      </div>
    </div>
  );
}

function OrganicBenchmark({
  posts,
  profiles,
  competitors,
}: {
  posts: StoredPost[];
  profiles: OrganicProfile[];
  competitors: string[];
}) {
  const own = profiles.find((p) => p.is_own_brand);
  const visible = competitors.map((name) => {
    const compPosts = posts.filter((p) => p.competitor === name);
    const profile = profileFor(profiles, name);
    return {
      name,
      own: Boolean(profile?.is_own_brand),
      posts: compPosts.length,
      followers: profile?.followers_count ?? null,
      avgEr: avgEngagementRate(compPosts, profile),
      topFormat: topTallyValues(compPosts, "format")[0] ?? "—",
      topPain: topTallyValues(compPosts, "pain")[0] ?? "—",
    };
  });
  if (!visible.length) return null;
  return (
    <div className="rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-4dp)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[13px] font-semibold text-[var(--color-text-default)]">Baseline orgánico</p>
          <p className="text-[11px] text-[var(--color-text-secondary)]">
            {own ? `Humand se usa como marca propia (@${own.handle})` : "Sin baseline Humand cargado todavía"}
          </p>
        </div>
        <span className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
          Solo visible para admin
        </span>
      </div>
      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
        {visible.map((row) => (
          <div key={row.name} className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-[var(--color-text-default)]">{row.name}</span>
              {row.own ? <span className="rounded-full bg-[var(--color-brand-50)] px-1.5 py-0.5 text-[10px] text-[var(--color-brand-500)]">own</span> : null}
            </div>
            <div className="grid grid-cols-2 gap-1 text-[11px] text-[var(--color-text-secondary)]">
              <span>Posts</span><span className="text-right text-[var(--color-text-default)]">{row.posts}</span>
              <span>Followers</span><span className="text-right text-[var(--color-text-default)]">{row.followers?.toLocaleString() ?? "—"}</span>
              <span>ER prom.</span><span className="text-right text-[var(--color-text-default)]">{pct(row.avgEr)}</span>
              <span>Formato</span><span className="truncate text-right text-[var(--color-text-default)]">{row.topFormat}</span>
              <span>Pain top</span><span className="truncate text-right text-[var(--color-text-default)]">{row.topPain}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function OrganicPostThumb({ post }: { post: StoredPost }) {
  const t = useTranslations("competitorAds");
  const imageCandidates = useMemo(
    () => uniqueStrings([post.display_url, ...(post.media?.images ?? [])]),
    [post.display_url, post.media?.images],
  );
  const [imageIndex, setImageIndex] = useState(0);
  const src = imageIndex < imageCandidates.length ? organicImgSrc(imageCandidates[imageIndex]) : null;
  const href = organicPostHref(post);
  const signals = [
    inferredHook(post) ? { label: t("organic.hook"), value: inferredHook(post)! } : null,
    inferredTone(post) ? { label: t("organic.tone"), value: inferredTone(post)! } : null,
    inferredCtaStrength(post)
      ? { label: t("organic.ctaStrength"), value: inferredCtaStrength(post)! }
      : null,
    inferredOfferType(post) ? { label: t("organic.offerType"), value: inferredOfferType(post)! } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex flex-col gap-1 overflow-hidden rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-50)] p-1.5 transition hover:border-violet-300"
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          className="aspect-square w-full rounded-sm object-cover"
          loading="lazy"
          onError={() => setImageIndex((index) => index + 1)}
        />
      ) : (
        <div className="flex aspect-square w-full items-center justify-center rounded-sm bg-[var(--color-neutral-200)] text-[18px]">
          {post.format === "video" || post.format === "reel" ? "▶" : "🖼"}
        </div>
      )}
      <div className="flex gap-1.5 text-[10px] text-[var(--color-text-secondary)]">
        <span>❤️ {(post.likes_count ?? 0).toLocaleString()}</span>
        <span>💬 {post.comments_count ?? 0}</span>
      </div>
      {post.caption ? (
        <p className="line-clamp-2 text-[10px] text-[var(--color-text-secondary)]">{post.caption}</p>
      ) : null}
      {signals.length ? (
        <div className="flex flex-wrap gap-1">
          {signals.slice(0, 3).map((signal) => (
            <span
              key={`${signal.label}:${signal.value}`}
              className="max-w-full truncate rounded-full bg-white px-1.5 py-0.5 text-[9px] text-[var(--color-text-secondary)]"
              title={`${signal.label}: ${signal.value}`}
            >
              {signal.label}: {signal.value}
            </span>
          ))}
        </div>
      ) : null}
    </a>
  );
}

function OrganicColumn({
  name,
  posts,
  profile,
  synth,
  summary,
  pillars,
  recommendations,
}: {
  name: string;
  posts: StoredPost[];
  profile: OrganicProfile | null;
  synth: OrganicSynthesis | undefined;
  summary: string | null;
  pillars: string[];
  recommendations: string[];
}) {
  const t = useTranslations("competitorAds");
  const [expandedPillar, setExpandedPillar] = useState<number | null>(null);
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [hourTooltip, setHourTooltip] = useState<string | null>(null);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [organicFilter, setOrganicFilter] = useState<OrganicFilter | null>(null);

  const freq = synth?.posting_frequency;
  const fmtDist = synth?.format_distribution ?? {};
  const topHashtags = synth?.hashtag_strategy?.top_hashtags ?? [];
  const best = synth?.best_performing ?? [];
  const bestEr = synth?.best_by_engagement_rate ?? [];
  const momentum = synth?.top_momentum_posts ?? [];
  const overlap = synth?.overlap_with_ads;
  const gaps = synth?.gaps_vs_humand ?? [];

  const totalFmt = Object.values(fmtDist).reduce((a, b) => a + b, 0);
  const activeDay = hoveredDay ?? selectedDay;
  const dayData = DAY_ORDER.map((label) => ({
    label,
    count: posts.filter((post) => postDayLabel(post) === label).length,
  }));
  const activeDayCount = activeDay ? (dayData.find((d) => d.label === activeDay)?.count ?? 0) : 0;
  const hourData = Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, "0") + ":00";
    const count = posts.filter((post) => {
      if (postHourKey(post) !== key) return false;
      return activeDay ? postDayLabel(post) === activeDay : true;
    }).length;
    return { label: String(h), count };
  });
  const maxDay = Math.max(...dayData.map((d) => d.count), 1);
  const maxHour = Math.max(...hourData.map((d) => d.count), 1);

  // Posts for an expanded pillar: match by content_type first, then by keyword in caption
  const pillarPosts = (pillarIdx: number): StoredPost[] => {
    const pillar = pillars[pillarIdx] ?? "";
    const ct = pillarContentType(pillar);
    let matched = ct ? posts.filter((p) => p.analysis?.content_type === ct) : [];
    if (matched.length < 3) {
      const words = pillar.toLowerCase().split(/\s+/).filter((w) => w.length > 4);
      matched = posts.filter((p) =>
        words.some((w) => p.caption?.toLowerCase().includes(w)),
      );
    }
    // Sort by engagement, take 3
    return [...matched]
      .sort((a, b) => (b.likes_count ?? 0) + (b.comments_count ?? 0) - ((a.likes_count ?? 0) + (a.comments_count ?? 0)))
      .slice(0, 3);
  };

  const sortedPosts = useMemo(
    () =>
      [...posts]
        .filter((post) => postMatchesOrganicFilter(post, organicFilter))
        .sort((a, b) => organicEngagement(b) - organicEngagement(a)),
    [posts, organicFilter],
  );
  const filterLabels: Record<OrganicFilter["kind"], string> = {
    format: t("organic.filterFormat"),
    pain: t("organic.filterPain"),
    persona: t("organic.filterPersona"),
    module: t("organic.filterModule"),
  };
  const activeFilterLabel = organicFilter ? `${filterLabels[organicFilter.kind]}: ${organicFilter.value}` : null;
  const creativeSignals = useMemo(() => ({
    hooks: topTextValues(posts.map(inferredHook).filter((value): value is string => Boolean(value)), 4),
    tones: tallyTextValues(posts.map(inferredTone).filter((value): value is string => Boolean(value)), 5),
    ctas: tallyTextValues(posts.map(inferredCtaStrength).filter((value): value is string => Boolean(value)), 3),
    offers: tallyTextValues(posts.map(inferredOfferType).filter((value): value is string => Boolean(value)), 5),
  }), [posts]);
  const mentionSignals = useMemo(() => organicMentionSignals(posts), [posts]);
  const mentionCategoryLabel = (category: MentionCategory) => t(`organic.mentionCategory.${category}`);
  const filterChips: Array<{ kind: OrganicFilter["kind"]; label: string; values: string[] }> = [
    { kind: "format", label: filterLabels.format, values: topTallyValues(posts, "format") },
    { kind: "pain", label: filterLabels.pain, values: topTallyValues(posts, "pain") },
    { kind: "persona", label: filterLabels.persona, values: topTallyValues(posts, "persona") },
    { kind: "module", label: filterLabels.module, values: topTallyValues(posts, "module") },
  ].filter((group): group is { kind: OrganicFilter["kind"]; label: string; values: string[] } => group.values.length > 0);

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-4dp)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-[var(--color-text-default)]">{name}</h3>
        <div className="flex items-center gap-1.5">
          {profile?.followers_count ? (
            <span className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {profile.followers_count.toLocaleString()} followers
            </span>
          ) : null}
          {freq ? (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
              {freq.posts_per_week}× / sem
            </span>
          ) : null}
          <span className="text-[11px] text-[var(--color-text-secondary)]">{posts.length} posts</span>
        </div>
      </div>

      {/* Summary */}
      {summary ? (
        <p className="text-[12px] leading-snug text-[var(--color-text-secondary)]">{summary}</p>
      ) : null}

      {recommendations.length ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-brand-200)] bg-[var(--color-brand-50)] p-3">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-500)]">
            {t("organic.responseTitle")}
          </p>
          <ul className="space-y-1 text-[12px] text-[var(--color-text-default)]">
            {recommendations.slice(0, 3).map((item, idx) => <li key={idx}>• {item}</li>)}
          </ul>
        </div>
      ) : null}

      {(creativeSignals.hooks.length || creativeSignals.tones.length || creativeSignals.ctas.length || creativeSignals.offers.length) ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            {t("organic.creativeSignals")}
          </p>
          {creativeSignals.hooks.length ? (
            <div className="mb-2">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
                {t("organic.hooks")}
              </p>
              <ul className="space-y-1 text-[11px] text-[var(--color-text-default)]">
                {creativeSignals.hooks.map((hook) => <li key={hook}>“{hook}”</li>)}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-1">
            {creativeSignals.tones.map(({ key, count }) => (
              <span key={`tone:${key}`} className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                {t("organic.tone")}: {key} · {count}
              </span>
            ))}
            {creativeSignals.ctas.map(({ key, count }) => (
              <span key={`cta:${key}`} className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                {t("organic.ctaStrength")}: {key} · {count}
              </span>
            ))}
            {creativeSignals.offers.map(({ key, count }) => (
              <span key={`offer:${key}`} className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
                {t("organic.offerType")}: {key} · {count}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {(mentionSignals.mentionedPosts || mentionSignals.paidPartnershipPosts || mentionSignals.signals.length) ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-3">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            {t("organic.mentionsTitle")}
          </p>
          <div className="mb-2 flex flex-wrap gap-1">
            <span className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {t("organic.mentionedPosts")}: {mentionSignals.mentionedPosts}
            </span>
            <span className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {t("organic.paidPartnerships")}: {mentionSignals.paidPartnershipPosts}
            </span>
            <span className="rounded-full bg-[var(--color-neutral-100)] px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)]">
              {t("organic.uniqueMentions")}: {mentionSignals.signals.length}
            </span>
          </div>
          {mentionSignals.signals.length ? (
            <div className="space-y-1">
              {mentionSignals.signals.slice(0, 6).map((signal) => (
                <p key={signal.handle} className="text-[11px] text-[var(--color-text-secondary)]">
                  <span className="font-semibold text-[var(--color-text-default)]">@{signal.handle}</span>
                  {" · "}
                  {signal.count} {t("organic.postsLabel")}
                  {" · "}
                  {mentionCategoryLabel(signal.category)}
                </p>
              ))}
              <p className="text-[10px] italic text-[var(--color-text-secondary)]">{t("organic.mentionHeuristic")}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {filterChips.length ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">{t("organic.filters")}</p>
            {organicFilter ? (
              <button
                type="button"
                onClick={() => setOrganicFilter(null)}
                className="text-[11px] text-[var(--color-text-secondary)] underline hover:text-[var(--color-brand-500)]"
              >
                {t("organic.clear")}
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {filterChips.flatMap((group) =>
              group.values.slice(0, group.kind === "format" ? 4 : 5).map((value) => (
                <Chip
                  key={`${group.kind}:${value}`}
                  active={organicFilter?.kind === group.kind && organicFilter.value === value}
                  onClick={() => setOrganicFilter((current) =>
                    current?.kind === group.kind && current.value === value ? null : { kind: group.kind, value },
                  )}
                >
                  {group.label}: {value}
                </Chip>
              )),
            )}
          </div>
        </div>
      ) : null}

      {organicFilter ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-brand-200)] bg-white p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-brand-500)]">
              {t("organic.filteredPosts")}
            </p>
            <span className="text-[11px] text-[var(--color-text-secondary)]">
              {activeFilterLabel} · {sortedPosts.length}/{posts.length}
            </span>
          </div>
          {sortedPosts.length ? (
            <div className="grid grid-cols-3 gap-1.5">
              {sortedPosts.slice(0, 6).map((sp) => <OrganicPostThumb key={sp.post_id} post={sp} />)}
            </div>
          ) : (
            <p className="text-[11px] italic text-[var(--color-text-secondary)]">{t("organic.noFilteredPosts")}</p>
          )}
        </div>
      ) : null}

      {/* Content pillars — clickable */}
      {pillars.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Pilares de contenido
          </p>
          <ul className="space-y-1">
            {pillars.map((p, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => setExpandedPillar(expandedPillar === i ? null : i)}
                  className="flex w-full items-start gap-1.5 rounded-sm px-0.5 py-0.5 text-left text-[12px] text-[var(--color-text-default)] transition hover:bg-violet-50"
                >
                  <span className={cn("mt-0.5 text-[10px] transition-transform", expandedPillar === i ? "rotate-90 text-violet-500" : "text-violet-400")}>▸</span>
                  {p}
                </button>
                {expandedPillar === i ? (
                  <div className="mt-1.5 grid grid-cols-3 gap-1.5 pl-4">
                    {pillarPosts(i).length ? (
                      pillarPosts(i).map((sp) => <OrganicPostThumb key={sp.post_id} post={sp} />)
                    ) : (
                      <p className="col-span-3 text-[11px] italic text-[var(--color-text-secondary)]">Sin posts clasificados en este pilar.</p>
                    )}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* Format distribution */}
      {totalFmt > 0 ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Formatos
          </p>
          <div className="space-y-1">
            {Object.entries(fmtDist)
              .sort((a, b) => b[1] - a[1])
              .map(([fmt, count]) => (
                <div key={fmt} className="flex items-center gap-2">
                  <div className="w-[56px] shrink-0 text-right text-[11px] text-[var(--color-text-secondary)] capitalize">{fmt}</div>
                  <div className="flex-1 overflow-hidden rounded-full bg-[var(--color-neutral-100)]">
                    <div className="h-2 rounded-full bg-violet-400" style={{ width: `${Math.round((count / totalFmt) * 100)}%` }} />
                  </div>
                  <div className="w-[28px] text-right text-[11px] text-[var(--color-text-secondary)]">{Math.round((count / totalFmt) * 100)}%</div>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {(gaps.length || overlap?.pains_in_both?.length || overlap?.organic_only_pains?.length) ? (
        <div className="rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] p-3">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Orgánico × Ads / gaps
          </p>
          {overlap?.pains_in_both?.length ? (
            <p className="text-[11px] text-[var(--color-text-default)]">
              En ambos canales: {overlap.pains_in_both.slice(0, 4).join(", ")}
            </p>
          ) : null}
          {overlap?.organic_only_pains?.length ? (
            <p className="mt-1 text-[11px] text-[var(--color-text-secondary)]">
              Solo orgánico: {overlap.organic_only_pains.slice(0, 4).join(", ")}
            </p>
          ) : null}
          {gaps.length ? (
            <ul className="mt-2 space-y-1 text-[11px] text-[var(--color-text-secondary)]">
              {gaps.slice(0, 3).map((gap, idx) => <li key={idx}>• {gap}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      {/* Posting patterns */}
      {(dayData.some((d) => d.count > 0) || hourData.some((d) => d.count > 0)) ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Cuándo postean
          </p>
          {/* By day — 1.5× taller, hover tooltip */}
          {dayData.some((d) => d.count > 0) ? (
            <div className="mb-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] text-[var(--color-text-secondary)]">{t("organic.weekday")}</p>
                {activeDay ? (
                  <span className="text-[10px] font-medium text-violet-600">
                    {activeDay}: {activeDayCount} {t("organic.postsLabel")}
                    {selectedDay === activeDay ? ` · ${t("organic.pinned")}` : ""}
                  </span>
                ) : null}
              </div>
              <div className="flex items-end gap-0.5" style={{ height: 42 }}>
                {dayData.map(({ label, count }) => (
                  <div
                    key={label}
                    className="flex flex-1 flex-col items-center gap-0.5"
                    onMouseEnter={() => setHoveredDay(label)}
                    onMouseLeave={() => setHoveredDay(null)}
                    onClick={() => setSelectedDay((current) => current === label ? null : label)}
                  >
                    <div
                      className={cn(
                        "w-full cursor-pointer rounded-sm transition-colors",
                        count > 0 ? "bg-violet-400 hover:bg-violet-500" : "bg-[var(--color-neutral-100)]",
                        selectedDay === label && "ring-2 ring-violet-700 ring-offset-1",
                      )}
                      style={{ height: `${Math.round((count / maxDay) * 34)}px`, minHeight: count ? 2 : 0 }}
                    />
                    <span className="text-[9px] text-[var(--color-text-secondary)]">{label.slice(0, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {/* By hour — 1.5× taller, hover tooltip */}
          {hourData.some((d) => d.count > 0) ? (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <p className="text-[10px] text-[var(--color-text-secondary)]">
                  {activeDay ? `${t("organic.hoursForDay")} ${activeDay} (${ORGANIC_TIMEZONE_LABEL})` : t("organic.hourOfDay")}
                </p>
                {hourTooltip ? <span className="text-[10px] font-medium text-violet-600">{hourTooltip}</span> : null}
              </div>
              <div className="flex items-end gap-px" style={{ height: 30 }}>
                {hourData.map(({ label, count }) => (
                  <div
                    key={label}
                    className={cn("flex-1 rounded-sm transition-colors", count > 0 ? "bg-violet-400 hover:bg-violet-500" : "bg-[var(--color-neutral-100)]")}
                    style={{ height: `${Math.round((count / maxHour) * 24)}px`, minHeight: count ? 2 : 0 }}
                    onMouseEnter={() => setHourTooltip(`${label}:00 ${ORGANIC_TIMEZONE_LABEL} — ${count} ${t("organic.postsLabel")}`)}
                    onMouseLeave={() => setHourTooltip(null)}
                  />
                ))}
              </div>
              <div className="mt-0.5 flex justify-between text-[9px] text-[var(--color-text-secondary)]">
                <span>0h</span><span>12h</span><span>23h</span>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Top hashtags */}
      {topHashtags.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Top hashtags
          </p>
          <div className="flex flex-wrap gap-1">
            {topHashtags.map((h) => (
              <span key={h} className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700">
                #{h}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Best performing posts */}
      {best.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Posts destacados
          </p>
          <div className="grid grid-cols-2 gap-2">
            {best.slice(0, 4).map((b) => {
              const sp = posts.find((p) => p.post_id === b.post_id);
              if (!sp) return null;
              return <OrganicPostThumb key={b.post_id} post={sp} />;
            })}
          </div>
        </div>
      ) : null}

      {bestEr.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Top engagement rate
          </p>
          <div className="space-y-1">
            {bestEr.slice(0, 3).map((item) => (
              <p key={item.post_id} className="text-[11px] text-[var(--color-text-secondary)]">
                <span className="font-semibold text-[var(--color-text-default)]">{pct(item.engagement_rate)}</span>
                {" · "}
                {item.caption_snippet || item.post_id}
                {" · "}
                <a
                  href={postHrefForId(posts, item.post_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--color-brand-500)] underline underline-offset-2"
                >
                  {t("organic.postLink")}
                </a>
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {momentum.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Momentum
          </p>
          <div className="space-y-1">
            {momentum.slice(0, 3).map((item) => (
              <p key={item.post_id} className="text-[11px] text-[var(--color-text-secondary)]">
                +{item.likes_growth} likes · +{item.comments_growth} comments · +{item.views_growth} views
                {item.caption_snippet ? ` — ${item.caption_snippet}` : ""}
                {" · "}
                <a
                  href={postHrefForId(posts, item.post_id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-[var(--color-brand-500)] underline underline-offset-2"
                >
                  {t("organic.postLink")}
                </a>
              </p>
            ))}
          </div>
        </div>
      ) : null}

      {/* All posts grid */}
      {posts.length ? (
        <div>
          <button
            type="button"
            onClick={() => setShowAllPosts((v) => !v)}
            className="flex w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)] transition hover:text-violet-600"
          >
            <span>Todos los posts ({posts.length})</span>
            <span className={cn("transition-transform", showAllPosts ? "rotate-180" : "")}>▾</span>
          </button>
          {showAllPosts ? (
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {sortedPosts.map((sp) => <OrganicPostThumb key={sp.post_id} post={sp} />)}
              {!sortedPosts.length ? (
                <p className="col-span-3 text-[11px] italic text-[var(--color-text-secondary)]">
                  Sin posts para el filtro actual.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
