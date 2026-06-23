"use client";

import { ChevronDown, ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState, type ReactNode } from "react";

import { ChartCard } from "@/components/charts/ChartCard";
import { PageTitle } from "@/components/pages/common";
import type { AdInsight, StoredAd } from "@/lib/competitor-ads/store";
import type { StoredPost, OrganicInsight, OrganicSynthesis } from "@/lib/competitor-ads/organic-store";
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
  readError?: string | null;
  organicPosts?: StoredPost[];
  organicInsights?: OrganicInsight[];
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
  synthesis: Synthesis | null;
  classByKey: Map<string, PerAd>;
};

const campaignKey = (a: StoredAd) => a.collation_id ?? a.ad_archive_id;

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

export function CompetitorAdsView({ ads, insights, refreshedAt, canRefresh, readError, organicPosts = [], organicInsights = [] }: Props) {
  const router = useRouter();
  const t = useTranslations("competitorAds");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle title={t("title")} subtitle={t("subtitle")} />
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
              {loading ? t("refreshing") : t("refresh")}
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
  const tr = g.synthesis?.i18n?.[i18nKey];
  // summary, angles labels/descriptions/copies del idioma activo (fallback al original)
  const summary = tr?.summary ?? g.synthesis?.summary ?? null;
  const offerTypes = tr?.offer_types ?? g.synthesis?.offer_types ?? [];
  const angles = (g.synthesis?.angles ?? []).map((a, i) => ({
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

      {g.synthesis ? (
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

          {g.synthesis.ads_analyzed ? (
            <p className="mt-auto text-[11px] text-[var(--color-text-secondary)]">
              <Sparkles size={10} className="mr-0.5 inline text-[var(--color-brand-500)]" />
              Basado en {g.synthesis.ads_analyzed} avisos analizados
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-[12px] italic text-[var(--color-text-secondary)]">
          Sin análisis disponible. Hacé un refresh para generar.
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
          href={`https://www.facebook.com/ads/library/?id=${ad.ad_archive_id}`}
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

function OrganicView({
  posts,
  insights,
  selectedCompetitor,
}: {
  posts: StoredPost[];
  insights: OrganicInsight[];
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
        return (
          <OrganicColumn
            key={name}
            name={name}
            posts={compPosts}
            synth={synth}
            summary={summary}
            pillars={pillars}
            i18nKey={i18nKey}
          />
        );
      })}
    </div>
  );
}

function OrganicColumn({
  name,
  posts,
  synth,
  summary,
  pillars,
}: {
  name: string;
  posts: StoredPost[];
  synth: OrganicSynthesis | undefined;
  summary: string | null;
  pillars: string[];
  i18nKey: string;
}) {
  const freq = synth?.posting_frequency;
  const fmtDist = synth?.format_distribution ?? {};
  const topHashtags = synth?.hashtag_strategy?.top_hashtags ?? [];
  const best = synth?.best_performing ?? [];
  const byDay = synth?.posting_patterns?.by_day ?? {};
  const byHour = synth?.posting_patterns?.by_hour ?? {};

  const totalFmt = Object.values(fmtDist).reduce((a, b) => a + b, 0);

  // Build day/hour sparkline data sorted by order
  const dayData = DAY_ORDER.map((d) => ({ label: d, count: byDay[d] ?? 0 }));
  const hourData = Array.from({ length: 24 }, (_, h) => {
    const key = String(h).padStart(2, "0") + ":00";
    return { label: String(h), count: byHour[key] ?? 0 };
  });
  const maxDay = Math.max(...dayData.map((d) => d.count), 1);
  const maxHour = Math.max(...hourData.map((d) => d.count), 1);

  return (
    <div className="flex flex-col gap-4 rounded-[var(--radius-m)] border border-[var(--color-neutral-200)] bg-[var(--color-bg-card)] p-4 shadow-[var(--shadow-4dp)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[16px] font-semibold text-[var(--color-text-default)]">{name}</h3>
        <div className="flex items-center gap-1.5">
          {freq ? (
            <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700">
              {freq.posts_per_week}× / semana
            </span>
          ) : null}
          <span className="text-[11px] text-[var(--color-text-secondary)]">{posts.length} posts</span>
        </div>
      </div>

      {/* Summary */}
      {summary ? (
        <p className="text-[12px] leading-snug text-[var(--color-text-secondary)]">{summary}</p>
      ) : null}

      {/* Content pillars */}
      {pillars.length ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Pilares de contenido
          </p>
          <ul className="space-y-1">
            {pillars.map((p, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] text-[var(--color-text-default)]">
                <span className="mt-0.5 text-[10px] text-violet-400">▸</span>
                {p}
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
                  <div className="w-[56px] shrink-0 text-right text-[11px] text-[var(--color-text-secondary)] capitalize">
                    {fmt}
                  </div>
                  <div className="flex-1 overflow-hidden rounded-full bg-[var(--color-neutral-100)]">
                    <div
                      className="h-2 rounded-full bg-violet-400"
                      style={{ width: `${Math.round((count / totalFmt) * 100)}%` }}
                    />
                  </div>
                  <div className="w-[28px] text-right text-[11px] text-[var(--color-text-secondary)]">
                    {Math.round((count / totalFmt) * 100)}%
                  </div>
                </div>
              ))}
          </div>
        </div>
      ) : null}

      {/* Posting patterns */}
      {(dayData.some((d) => d.count > 0) || hourData.some((d) => d.count > 0)) ? (
        <div>
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-text-secondary)]">
            Cuándo postean
          </p>
          {/* By day */}
          {dayData.some((d) => d.count > 0) ? (
            <div className="mb-2">
              <p className="mb-1 text-[10px] text-[var(--color-text-secondary)]">Día de semana</p>
              <div className="flex items-end gap-0.5 h-8">
                {dayData.map(({ label, count }) => (
                  <div key={label} className="flex flex-1 flex-col items-center gap-0.5">
                    <div
                      className="w-full rounded-sm bg-violet-300"
                      style={{ height: `${Math.round((count / maxDay) * 28)}px`, minHeight: count ? 2 : 0 }}
                    />
                    <span className="text-[9px] text-[var(--color-text-secondary)]">{label.slice(0, 2)}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {/* By hour */}
          {hourData.some((d) => d.count > 0) ? (
            <div>
              <p className="mb-1 text-[10px] text-[var(--color-text-secondary)]">Hora del día (UTC)</p>
              <div className="flex items-end gap-px h-6">
                {hourData.map(({ label, count }) => (
                  <div
                    key={label}
                    title={`${label}h: ${count} posts`}
                    className="flex-1 rounded-sm bg-violet-300"
                    style={{ height: `${Math.round((count / maxHour) * 20)}px`, minHeight: count ? 2 : 0 }}
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
              <span
                key={h}
                className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] text-violet-700"
              >
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
            {best.slice(0, 4).map((p) => {
              const stored = posts.find((sp) => sp.post_id === p.post_id);
              return (
                <a
                  key={p.post_id}
                  href={stored?.post_url ?? `https://www.instagram.com/p/${p.post_id}/`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group flex flex-col gap-1 overflow-hidden rounded-[var(--radius-s)] border border-[var(--color-neutral-200)] bg-[var(--color-neutral-50)] p-2 transition hover:border-violet-300"
                >
                  {stored?.display_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={stored.display_url}
                      alt=""
                      className="aspect-square w-full rounded-sm object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="aspect-square w-full rounded-sm bg-[var(--color-neutral-200)]" />
                  )}
                  <div className="flex gap-2 text-[10px] text-[var(--color-text-secondary)]">
                    <span>❤️ {p.likes.toLocaleString()}</span>
                    <span>💬 {p.comments}</span>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
