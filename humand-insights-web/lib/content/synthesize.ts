/**
 * Síntesis de patrones por mercado.
 *
 * Responde la pregunta que motivó todo el proyecto: no "cuántas veces postean"
 * sino "qué tienen en común los posts que funcionan en este mercado".
 *
 * Es determinístico y sin LLM: agrega lo que el clasificador ya extrajo post a
 * post. Mismo criterio que `src/agents/marketing_advisor.py` — el modelo razona
 * sobre datos ya recuperados, la agregación se resuelve en código para que no
 * haya drift entre corridas.
 */
import type { PostAnalysis } from "./classify";

/** Fracción superior que se considera "lo que funcionó". */
export const TOP_FRACTION = 0.2;

/** Mínimo de posts en el corte superior para que un patrón signifique algo. */
export const MIN_TOP_POSTS = 8;

/**
 * Apariciones mínimas de un patrón para reportarlo.
 *
 * Con 2 el lift es ruido: España marcaba "onboarding 4.95x" sobre dos posts.
 * Un número grande sobre una muestra diminuta se lee como hallazgo y no lo es.
 */
export const MIN_PATTERN_COUNT = 3;

export type AnalyzedPost = {
  post_id: string;
  post_url: string | null;
  author_handle: string;
  region: string | null;
  viral_score: number | null;
  outlier_factor: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count?: number | null;
  analysis: PostAnalysis;
};

export type PatternLift = {
  key: string;
  /** Cuántos del corte superior lo usan. */
  top_count: number;
  /** Qué proporción del corte superior representa. */
  top_share: number;
  /** Qué proporción del total representa. */
  base_share: number;
  /**
   * top_share / base_share. Un lift de 1 significa que el patrón aparece arriba
   * tanto como abajo: es común, no ganador. Lo que importa es > 1.
   */
  lift: number;
};

export type RegionSynthesis = {
  region: string;
  posts_considered: number;
  top_posts_count: number;
  /** null cuando no hay muestra suficiente para afirmar nada. */
  winning_hooks: PatternLift[] | null;
  winning_themes: PatternLift[] | null;
  top_topics: Array<{ key: string; count: number }>;
  tone_mix: Array<{ key: string; count: number }>;
  replicable_ideas: Array<{
    post_url: string | null;
    author_handle: string;
    hook: string | null;
    hook_pattern: string;
    theme: string;
    humand_angle: string;
    outlier_factor: number | null;
  }>;
  insufficient_sample?: string;
};

function tally(values: Array<string | null | undefined>): Map<string, number> {
  const out = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    out.set(value, (out.get(value) ?? 0) + 1);
  }
  return out;
}

function toSortedList(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

/**
 * Lift de un patrón: cuánto más frecuente es arriba que en el total.
 *
 * Contar a secas no sirve: si `pregunta` es el hook más usado en general, va a
 * liderar el corte superior por volumen y no porque funcione. El lift separa
 * "lo que se usa mucho" de "lo que gana".
 */
export function computeLift(
  top: Array<string | null | undefined>,
  all: Array<string | null | undefined>,
  minTopCount = MIN_PATTERN_COUNT,
): PatternLift[] {
  const topCounts = tally(top);
  const allCounts = tally(all);
  const topTotal = [...topCounts.values()].reduce((a, b) => a + b, 0);
  const allTotal = [...allCounts.values()].reduce((a, b) => a + b, 0);
  if (!topTotal || !allTotal) return [];

  return [...topCounts.entries()]
    .filter(([, count]) => count >= minTopCount)
    .map(([key, count]) => {
      const topShare = count / topTotal;
      const baseShare = (allCounts.get(key) ?? 0) / allTotal;
      return {
        key,
        top_count: count,
        top_share: Number(topShare.toFixed(3)),
        base_share: Number(baseShare.toFixed(3)),
        lift: baseShare > 0 ? Number((topShare / baseShare).toFixed(2)) : 0,
      };
    })
    .sort((a, b) => b.lift - a.lift || b.top_count - a.top_count);
}

/**
 * Sintetiza un mercado.
 *
 * Solo entran posts relevantes para RRHH y dirigidos a quien gestiona personas:
 * un post que explota entre candidatos enseña formato, pero su tema no sirve
 * para el calendario de Humand.
 */
export function synthesizeRegion(region: string, posts: AnalyzedPost[]): RegionSynthesis {
  const relevant = posts.filter(
    (p) =>
      p.analysis.is_relevant_to_hr &&
      p.analysis.audience_signal === "hr_leader" &&
      p.viral_score !== null,
  );

  const ranked = [...relevant].sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0));
  const topCount = Math.max(MIN_TOP_POSTS, Math.ceil(ranked.length * TOP_FRACTION));
  const top = ranked.slice(0, Math.min(topCount, ranked.length));

  const base: RegionSynthesis = {
    region,
    posts_considered: relevant.length,
    top_posts_count: top.length,
    winning_hooks: null,
    winning_themes: null,
    top_topics: toSortedList(tally(top.map((p) => p.analysis.topic)), 10),
    tone_mix: toSortedList(tally(top.map((p) => p.analysis.tone)), 6),
    replicable_ideas: top
      .filter((p) => p.analysis.replicability === "alta" && p.analysis.humand_angle)
      .slice(0, 8)
      .map((p) => ({
        post_url: p.post_url,
        author_handle: p.author_handle,
        hook: p.analysis.hook,
        hook_pattern: p.analysis.hook_pattern,
        theme: p.analysis.theme,
        humand_angle: p.analysis.humand_angle as string,
        outlier_factor: p.outlier_factor,
      })),
  };

  // Con pocos posts el lift es ruido: dos apariciones de un patrón darían un
  // "ganador" que no significa nada. Mejor decir que no alcanza la muestra.
  if (top.length < MIN_TOP_POSTS) {
    return {
      ...base,
      insufficient_sample: `Solo ${top.length} posts relevantes en el corte superior; hacen falta ${MIN_TOP_POSTS} para afirmar patrones.`,
    };
  }

  return {
    ...base,
    winning_hooks: computeLift(
      top.map((p) => p.analysis.hook_pattern),
      relevant.map((p) => p.analysis.hook_pattern),
    ),
    winning_themes: computeLift(
      top.map((p) => p.analysis.theme),
      relevant.map((p) => p.analysis.theme),
    ),
  };
}

/** Sintetiza todos los mercados presentes en el set. */
export function synthesizeAll(posts: AnalyzedPost[]): RegionSynthesis[] {
  const byRegion = new Map<string, AnalyzedPost[]>();
  for (const post of posts) {
    const key = post.region ?? "sin_region";
    const list = byRegion.get(key) ?? [];
    list.push(post);
    byRegion.set(key, list);
  }
  return [...byRegion.entries()]
    .map(([region, list]) => synthesizeRegion(region, list))
    .sort((a, b) => b.posts_considered - a.posts_considered);
}

// ─── Comparación con lo propio ───────────────────────────────────────────────

/**
 * Compara el contenido propio de Humand contra los patrones que funcionan.
 *
 * Es lo que pide el prompt maestro del brief: "Comparás el desempeño propio de
 * Humand contra los patrones detectados en el resto del research". Sin esto la
 * herramienta dice qué funciona en el mercado pero no si lo estamos aplicando.
 *
 * Determinístico: compara dos distribuciones que ya calculamos.
 */
export type OwnBrandComparison = {
  own_posts: number;
  own_median_engagement: number | null;
  reference_median_engagement: number | null;
  /** Patrones que funcionan y nosotros no usamos, o usamos poco. */
  missing_patterns: Array<{ key: string; lift: number; own_share: number }>;
  /** Patrones que usamos más de lo que su rendimiento justifica. */
  overused_patterns: Array<{ key: string; lift: number; own_share: number }>;
  /** Temas que funcionan y no estamos tocando. */
  missing_themes: Array<{ key: string; lift: number }>;
};

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

/** Cuánto de nuestro contenido usa cada patrón, para contrastar con el lift. */
function shareByKey(values: Array<string | null | undefined>): Map<string, number> {
  const counts = tally(values);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const out = new Map<string, number>();
  if (!total) return out;
  for (const [key, count] of counts) out.set(key, count / total);
  return out;
}

export function compareOwnBrand(
  ownPosts: AnalyzedPost[],
  synthesis: RegionSynthesis,
  referencePosts: AnalyzedPost[],
): OwnBrandComparison {
  const engagementOf = (p: AnalyzedPost) =>
    (p.likes_count ?? 0) + (p.comments_count ?? 0) + (p.shares_count ?? 0);

  const ownMedian = median(ownPosts.map(engagementOf));
  const refMedian = median(referencePosts.map(engagementOf));

  const ownHooks = shareByKey(ownPosts.map((p) => p.analysis.hook_pattern));
  const ownThemes = shareByKey(ownPosts.map((p) => p.analysis.theme));

  const winningHooks = (synthesis.winning_hooks ?? []).filter((h) => h.lift > 1);
  const winningThemes = (synthesis.winning_themes ?? []).filter((t) => t.lift > 1);

  // "Poco" es menos de la mitad de lo que su rendimiento sugeriría en un
  // reparto parejo entre los patrones ganadores.
  const fairShare = winningHooks.length ? 1 / winningHooks.length : 0;

  return {
    own_posts: ownPosts.length,
    own_median_engagement: ownMedian,
    reference_median_engagement: refMedian,
    missing_patterns: winningHooks
      .filter((h) => (ownHooks.get(h.key) ?? 0) < fairShare / 2)
      .map((h) => ({
        key: h.key,
        lift: h.lift,
        own_share: Number((ownHooks.get(h.key) ?? 0).toFixed(2)),
      })),
    overused_patterns: [...ownHooks.entries()]
      .filter(([key, share]) => {
        const winner = winningHooks.find((h) => h.key === key);
        // Sin lift medido no se puede decir que sobre: puede ser que no haya
        // muestra, no que rinda mal.
        return share > 0.25 && !winner;
      })
      .map(([key, share]) => ({ key, lift: 0, own_share: Number(share.toFixed(2)) })),
    missing_themes: winningThemes
      .filter((t) => (ownThemes.get(t.key) ?? 0) === 0)
      .map((t) => ({ key: t.key, lift: t.lift })),
  };
}
