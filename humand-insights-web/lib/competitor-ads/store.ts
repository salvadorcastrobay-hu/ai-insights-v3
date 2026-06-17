import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { AdSource, CompetitorAd } from "./types";
import { archiveCompetitorAdMedia } from "./media-archive";

// Análisis cacheado por aviso (se computa una vez y se reusa).
export type AdAnalysis = {
  creative_text: string | null;
  goal: string;
  content_type: string;
  related_pains: string[];
  persona: string | null;
  modules: string[];
};

export type StoredAd = CompetitorAd & {
  first_seen_at: string;
  last_seen_at: string;
  analysis: AdAnalysis | null;
};

// Cliente Supabase (PostgREST/HTTP, service_role). Reemplaza a getPg/postgres.js
// para competitor-ads: el pool de sockets directo sobre el pooler de Supavisor
// se volvía zombie en Railway (lecturas colgadas → timeouts). PostgREST es HTTP
// sin sockets persistentes (igual que el resto del dashboard) y además devuelve
// el jsonb ya parseado como objeto.
let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.");
  }
  _sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  });
  return _sb;
}

const AD_COLS =
  "source, competitor, ad_archive_id, collation_id, page_id, page_name, is_active, " +
  "ad_start_date, ad_end_date, publisher_platform, display_format, body_text, title, " +
  "cta_text, cta_type, link_url, categories, media, country, first_seen_at, last_seen_at, analysis";

// Último error de lectura, para diagnóstico en la propia página (admin).
let lastReadError: string | null = null;
export function consumeReadError(): string | null {
  const e = lastReadError;
  lastReadError = null;
  return e;
}

/**
 * Lectura defensiva: corre `fn` con un timeout duro y devuelve `fallback` ante
 * CUALQUIER error o demora. La página de ads es informativa → nunca debe quedar
 * en skeleton infinito.
 */
async function safeRead<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), 12_000)),
    ]);
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const msg = code ?? (err as Error)?.message ?? String(err);
    lastReadError = `${label}: ${msg}`;
    console.warn(`[competitor-ads.${label}] fallback (${msg}):`, err);
    return fallback;
  }
}

/** Upsert por (source, competitor, ad_archive_id). Actualiza last_seen_at. */
export async function upsertAds(ads: CompetitorAd[]): Promise<number> {
  if (!ads.length) return 0;
  const sb = getSupabase();
  const now = new Date().toISOString();
  const archivedAds: CompetitorAd[] = [];
  for (const ad of ads) {
    archivedAds.push({
      ...ad,
      media: await archiveCompetitorAdMedia(ad).catch(() => ad.media),
    });
  }
  // first_seen_at se omite a propósito: en INSERT toma el default de la tabla,
  // en UPDATE conserva su valor (PostgREST solo setea las columnas provistas).
  const rows = archivedAds.map((a) => ({
    source: a.source,
    competitor: a.competitor,
    ad_archive_id: a.ad_archive_id,
    collation_id: a.collation_id,
    page_id: a.page_id,
    page_name: a.page_name,
    is_active: a.is_active,
    ad_start_date: a.ad_start_date,
    ad_end_date: a.ad_end_date,
    publisher_platform: a.publisher_platform,
    display_format: a.display_format,
    body_text: a.body_text,
    title: a.title,
    cta_text: a.cta_text,
    cta_type: a.cta_type,
    link_url: a.link_url,
    categories: a.categories,
    media: a.media,
    country: a.country,
    raw: a.raw ?? null,
    last_seen_at: now,
    fetched_at: now,
  }));
  const { error } = await sb
    .from("competitor_ads")
    .upsert(rows, { onConflict: "source,competitor,ad_archive_id" });
  if (error) throw new Error(error.message);
  return rows.length;
}

type Row = {
  source: AdSource;
  competitor: string;
  ad_archive_id: string;
  collation_id: string | null;
  page_id: string | null;
  page_name: string | null;
  is_active: boolean | null;
  ad_start_date: string | null;
  ad_end_date: string | null;
  publisher_platform: unknown;
  display_format: string | null;
  body_text: string | null;
  title: string | null;
  cta_text: string | null;
  cta_type: string | null;
  link_url: string | null;
  categories: unknown;
  media: unknown;
  country: string | null;
  first_seen_at: string;
  last_seen_at: string;
  analysis: unknown;
};

function toIso(d: string | Date | null): string | null {
  return d ? new Date(d).toISOString() : null;
}

/**
 * Coacciona un valor jsonb a objeto/array. PostgREST ya lo devuelve parseado,
 * pero por las dudas (o si en algún lado vuelve como string) parseamos.
 */
function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

function mapRow(r: Row): StoredAd {
  const media = asJson<{ images?: string[]; videos?: string[] }>(r.media, {});
  const categories = asJson<string[]>(r.categories, []);
  const platforms = asJson<string[]>(r.publisher_platform, []);
  return {
    source: r.source,
    competitor: r.competitor,
    ad_archive_id: r.ad_archive_id,
    collation_id: r.collation_id,
    page_id: r.page_id,
    page_name: r.page_name,
    is_active: r.is_active,
    ad_start_date: toIso(r.ad_start_date),
    ad_end_date: toIso(r.ad_end_date),
    publisher_platform: Array.isArray(platforms) ? platforms : [],
    display_format: r.display_format,
    body_text: r.body_text,
    title: r.title,
    cta_text: r.cta_text,
    cta_type: r.cta_type,
    link_url: r.link_url,
    categories: Array.isArray(categories) ? categories : [],
    media: {
      images: Array.isArray(media?.images) ? media.images : [],
      videos: Array.isArray(media?.videos) ? media.videos : [],
    },
    country: r.country,
    raw: null,
    first_seen_at: toIso(r.first_seen_at)!,
    last_seen_at: toIso(r.last_seen_at)!,
    analysis: asJson<AdAnalysis | null>(r.analysis, null),
  };
}

/** Todos los avisos guardados, orden: competidor, más recientes primero. */
export async function loadStoredAds(): Promise<StoredAd[]> {
  return safeRead("loadStoredAds", [], async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_ads")
      .select(AD_COLS)
      .order("competitor", { ascending: true })
      .order("ad_start_date", { ascending: false, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => mapRow(r as unknown as Row));
  });
}

/** Avisos de un competidor (para el análisis IA). */
export async function loadAdsForCompetitor(competitor: string, source: AdSource): Promise<StoredAd[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("competitor_ads")
    .select(AD_COLS)
    .eq("competitor", competitor)
    .eq("source", source)
    .order("ad_start_date", { ascending: false, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((r) => mapRow(r as unknown as Row));
}

export async function lastRefreshedAt(): Promise<string | null> {
  return safeRead("lastRefreshedAt", null, async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_ads")
      .select("fetched_at")
      .order("fetched_at", { ascending: false })
      .limit(1);
    if (error) throw new Error(error.message);
    const v = (data?.[0] as { fetched_at?: string } | undefined)?.fetched_at ?? null;
    return toIso(v);
  });
}

// ─── Insights IA ────────────────────────────────────────────────────────────

export type AdInsight = {
  competitor: string;
  source: AdSource;
  payload: unknown;
  generated_at: string;
};

export async function loadAdInsights(): Promise<AdInsight[]> {
  return safeRead("loadAdInsights", [], async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_ad_insights")
      .select("competitor, source, payload, generated_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => {
      const row = r as { competitor: string; source: AdSource; payload: unknown; generated_at: string };
      return {
        competitor: row.competitor,
        source: row.source,
        payload: asJson<unknown>(row.payload, null),
        generated_at: toIso(row.generated_at)!,
      };
    });
  });
}

export async function saveAdInsight(
  competitor: string,
  source: AdSource,
  payload: unknown,
  model: string,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("competitor_ad_insights")
    .upsert(
      { competitor, source, payload, model, generated_at: new Date().toISOString() },
      { onConflict: "competitor,source" },
    );
  if (error) throw new Error(error.message);
}

/** Insight ya guardado de un competidor (para reusar la síntesis si no cambió). */
export async function loadAdInsight(competitor: string, source: AdSource): Promise<unknown | null> {
  return safeRead("loadAdInsight", null, async () => {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("competitor_ad_insights")
      .select("payload")
      .eq("competitor", competitor)
      .eq("source", source)
      .limit(1);
    if (error) throw new Error(error.message);
    return data?.length ? asJson<unknown>(data[0].payload, null) : null;
  });
}

/** Persiste el análisis cacheado de UN aviso (creative_text + clasificación). */
export async function saveAdAnalysis(
  adArchiveId: string,
  source: AdSource,
  analysis: AdAnalysis,
): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb
    .from("competitor_ads")
    .update({ analysis })
    .eq("ad_archive_id", adArchiveId)
    .eq("source", source);
  if (error) throw new Error(error.message);
}
