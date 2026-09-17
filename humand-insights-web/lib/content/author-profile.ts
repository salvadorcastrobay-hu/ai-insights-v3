/**
 * Perfil de cuenta — la quinta fila de la sección 4 del brief:
 * "calendario de contenidos, ejes temáticos, estrategia de comunicación,
 * biografía, descripción de cuenta".
 *
 * Esto ya existía para competidores de Instagram en `organic-analyze.ts`
 * (posting_frequency, posting_patterns, content_pillars). Acá se reconstruye
 * para cualquier autor de discovery, en cualquier red, y sin LLM: todo sale de
 * agregar lo que el clasificador ya extrajo post a post.
 *
 * Sin modelo a propósito — son cuentas, no juicios. Dos corridas sobre los
 * mismos datos tienen que dar lo mismo.
 */
import type { PostAnalysis } from "./classify";

/** Zona horaria de referencia para los patrones de publicación. */
export const REPORT_UTC_OFFSET = -3; // GMT-3: Argentina y Brasil

export type ProfilablePost = {
  post_id: string;
  post_url: string | null;
  posted_at: string | null;
  format: string | null;
  viral_score: number | null;
  outlier_factor: number | null;
  analysis: PostAnalysis | null;
};

export type AuthorProfile = {
  handle: string;
  platform: string;
  full_name: string | null;
  /** Bio en Instagram, headline en LinkedIn. */
  description: string | null;
  followers_count: number | null;
  posts_analyzed: number;

  calendar: {
    posts_per_week: number;
    posts_per_month: number;
    /** 0 = domingo. Solo los días en que efectivamente publica. */
    by_weekday: Array<{ day: number; count: number }>;
    by_hour: Array<{ hour: number; count: number }>;
    first_post: string | null;
    last_post: string | null;
  };

  /** Ejes temáticos, por volumen. */
  content_pillars: Array<{ key: string; count: number; share: number }>;
  format_mix: Array<{ key: string; count: number; share: number }>;
  hook_mix: Array<{ key: string; count: number; share: number }>;
  tone_mix: Array<{ key: string; count: number; share: number }>;
  audience_profiles: Array<{ key: string; count: number; share: number }>;

  /** Cómo comunica, derivado de lo anterior. */
  strategy: {
    /** Qué proporción de lo que publica es relevante para RRHH. */
    hr_focus: number;
    /** Qué proporción lleva CTA. */
    cta_rate: number;
    /** Largo mediano del texto. */
    median_copy_length: number | null;
    dominant_hashtag_strategy: string | null;
  };

  best_posts: Array<{
    post_id: string;
    post_url: string | null;
    hook: string | null;
    outlier_factor: number | null;
  }>;
};

function tally(values: Array<string | null | undefined>): Array<{ key: string; count: number; share: number }> {
  const counts = new Map<string, number>();
  let total = 0;
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
    total += 1;
  }
  if (!total) return [];
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count, share: Number((count / total).toFixed(3)) }))
    .sort((a, b) => b.count - a.count);
}

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Desplaza a la zona de reporte antes de leer día y hora. */
function localParts(iso: string): { day: number; hour: number } | null {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return null;
  const shifted = new Date(ts + REPORT_UTC_OFFSET * 3_600_000);
  return { day: shifted.getUTCDay(), hour: shifted.getUTCHours() };
}

export function buildAuthorProfile(
  input: {
    handle: string;
    platform: string;
    full_name: string | null;
    description: string | null;
    followers_count: number | null;
  },
  posts: ProfilablePost[],
): AuthorProfile {
  const dated = posts
    .map((p) => ({ post: p, ts: p.posted_at ? Date.parse(p.posted_at) : NaN }))
    .filter((x) => !Number.isNaN(x.ts))
    .sort((a, b) => a.ts - b.ts);

  const first = dated[0]?.ts ?? null;
  const last = dated[dated.length - 1]?.ts ?? null;
  // Se mide sobre la ventana observada, no sobre un mes calendario: si solo
  // tenemos dos semanas de una cuenta, decir "posts por mes" sería inventar.
  const spanDays = first && last && last > first ? (last - first) / 86_400_000 : null;
  const perWeek = spanDays && spanDays >= 7 ? (dated.length / spanDays) * 7 : dated.length;

  const byWeekday = new Map<number, number>();
  const byHour = new Map<number, number>();
  for (const { post } of dated) {
    const parts = post.posted_at ? localParts(post.posted_at) : null;
    if (!parts) continue;
    byWeekday.set(parts.day, (byWeekday.get(parts.day) ?? 0) + 1);
    byHour.set(parts.hour, (byHour.get(parts.hour) ?? 0) + 1);
  }

  const analyses = posts.map((p) => p.analysis).filter((a): a is PostAnalysis => Boolean(a));
  const relevant = analyses.filter((a) => a.is_relevant_to_hr);

  return {
    handle: input.handle,
    platform: input.platform,
    full_name: input.full_name,
    description: input.description,
    followers_count: input.followers_count,
    posts_analyzed: posts.length,

    calendar: {
      posts_per_week: Number(perWeek.toFixed(1)),
      posts_per_month: Number((perWeek * 4.35).toFixed(1)),
      by_weekday: [...byWeekday.entries()]
        .map(([day, count]) => ({ day, count }))
        .sort((a, b) => b.count - a.count),
      by_hour: [...byHour.entries()]
        .map(([hour, count]) => ({ hour, count }))
        .sort((a, b) => b.count - a.count),
      first_post: first ? new Date(first).toISOString() : null,
      last_post: last ? new Date(last).toISOString() : null,
    },

    content_pillars: tally(analyses.map((a) => a.theme)),
    format_mix: tally(posts.map((p) => p.format)),
    hook_mix: tally(analyses.map((a) => a.hook_pattern)),
    tone_mix: tally(analyses.map((a) => a.tone)),
    audience_profiles: tally(analyses.flatMap((a) => a.target_profiles ?? [])),

    strategy: {
      hr_focus: analyses.length ? Number((relevant.length / analyses.length).toFixed(2)) : 0,
      cta_rate: analyses.length
        ? Number((analyses.filter((a) => a.cta).length / analyses.length).toFixed(2))
        : 0,
      median_copy_length: median(analyses.map((a) => a.copy_length ?? 0).filter((n) => n > 0)),
      dominant_hashtag_strategy: tally(analyses.map((a) => a.hashtag_strategy))[0]?.key ?? null,
    },

    best_posts: [...posts]
      .filter((p) => p.viral_score !== null)
      .sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0))
      .slice(0, 5)
      .map((p) => ({
        post_id: p.post_id,
        post_url: p.post_url,
        hook: p.analysis?.hook ?? null,
        outlier_factor: p.outlier_factor,
      })),
  };
}
