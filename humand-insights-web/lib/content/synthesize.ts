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
import type { PostFeatures } from "./post-features";

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
export /** Un patrón necesita varias voces distintas, no varios posts de una. */
const MIN_PATTERN_AUTHORS = 3;

const MIN_PATTERN_COUNT = 3;

export type AnalyzedPost = {
  post_id: string;
  post_url: string | null;
  author_handle: string;
  region: string | null;
  viral_score: number | null;
  outlier_factor: number | null;
  debate_factor?: number | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count?: number | null;
  analysis: PostAnalysis;
  /** Qué se ve en el creativo. Lo tienen el corte superior y una muestra de control. */
  visual?: {
    visual_format: string;
    text_on_image: string;
    visual_text: string | null;
    production_level?: string;
    person_framing?: string;
    face_present?: boolean;
  } | null;
  /** Lo contable del post. Ver post-features.ts. */
  features?: PostFeatures | null;
  /** Viene de una muestra cronológica del autor (scrape de perfil). */
  baseline_eligible?: boolean;
};

/** Top contra el resto, para un eje donde "el total" no es representativo. */
export type PatternContrast = {
  key: string;
  top_count: number;
  top_authors: number;
  top_share: number;
  rest_count: number;
  rest_share: number;
  /** top_share / rest_share. */
  lift: number;
};

/** Una métrica de forma del copy: cómo es arriba contra cómo es el resto. */
export type CopyShapeRow = {
  metric:
    | "first_line_chars"
    | "paragraphs"
    | "emoji_count"
    | "copy_length"
    | "has_external_link"
    | "ends_with_question"
    | "slide_count";
  /** Mediana para las métricas numéricas, proporción para las booleanas. */
  top: number;
  rest: number;
  kind: "median" | "share";
  top_n: number;
  rest_n: number;
};

export type PatternLift = {
  key: string;
  /** Cuántos del corte superior lo usan. */
  top_count: number;
  /** Cuántos AUTORES distintos lo sostienen. Es la señal, no el conteo de posts. */
  top_authors: number;
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
  winning_structures: PatternLift[] | null;
  /**
   * Cómo se ve el creativo del corte superior.
   *
   * NO es un lift y no se puede presentar como tal: el análisis visual corre
   * solo sobre el corte superior, así que no hay denominador. Lo que sí es
   * válido es comparar DENTRO del corte — entre los posts que funcionaron,
   * cuáles formatos promedian más.
   */
  visual_mix: Array<{
    key: string;
    posts: number;
    authors: number;
    median_outlier: number | null;
  }> | null;
  /** Formato real (el de LinkedIn corregido), CTA y vigencia: lift como los demás. */
  winning_formats?: PatternLift[] | null;
  winning_ctas?: PatternLift[] | null;
  winning_timeliness?: PatternLift[] | null;
  /**
   * Lift visual de verdad: corte superior contra la muestra de control del
   * resto. null si el control no alcanza, y entonces se cae a `visual_mix`.
   */
  visual_lift?: {
    visual_format: PatternContrast[];
    production_level: PatternContrast[];
    person_framing: PatternContrast[];
    text_on_image: PatternContrast[];
    top_n: number;
    rest_n: number;
  } | null;
  /** Cómo está escrito lo que funciona contra el resto. Determinístico. */
  copy_shape?: CopyShapeRow[] | null;
  /**
   * Cuándo publican los que funcionan. Solo sobre muestras cronológicas de
   * perfil: un scrape de hashtag trae "lo último", o sea todo del mismo día, y
   * eso no es un hábito de publicación. Descriptivo, no causal.
   */
  timing?: { weekday: PatternLift[]; daypart: PatternLift[]; sample: number } | null;
  /**
   * Páginas de EMPRESA: Humand publica como empresa y casi todo el corpus son
   * personas. Con esta muestra no da para lift, así que son casos, no un %.
   */
  company_pages?: {
    posts: number;
    authors: number;
    median_outlier: number | null;
    person_median_outlier: number | null;
    examples: Array<{
      author_handle: string;
      post_url: string | null;
      hook: string | null;
      format: string | null;
      outlier_factor: number | null;
    }>;
  } | null;
  /** Cuántos collabs se dejaron fuera del corte: su alcance es prestado. */
  excluded_collabs?: number;
  top_topics: Array<{ key: string; count: number }>;
  tone_mix: Array<{ key: string; count: number }>;
  replicable_ideas: Array<{
    post_url: string | null;
    author_handle: string;
    hook: string | null;
    hook_pattern: string;
    theme: string;
    /**
     * Lo que el post AFIRMA. Reemplaza a humand_angle, que era una paráfrasis
     * y encima era el insumo creativo del calendario: gpt-4o no puede escribir
     * mejor que su brief, y su brief eran ocho frases que servían para
     * cualquier post.
     */
    claim: string;
    counterclaim: string | null;
    claim_object: string | null;
    claim_stance: string | null;
    mechanism: string;
    outlier_factor: number | null;
    debate_factor: number | null;
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
/** Una observación: qué valor tomó el patrón y quién lo publicó. */
export type LiftObservation = { key: string | null | undefined; author: string };

/**
 * Cuántos AUTORES distintos sostienen cada valor.
 *
 * Es la protección que faltaba: contando posts, un autor prolífico fabrica un
 * patrón solo. Con 983 posts sobre ~75 fuentes eso no es hipotético — hay
 * autores con veinte posts y autores con dos, y `MIN_PATTERN_COUNT` no
 * distingue "tres posts de tres personas" de "tres posts de la misma".
 */
function tallyAuthors(items: LiftObservation[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const item of items) {
    if (!item.key) continue;
    const set = out.get(item.key) ?? new Set<string>();
    set.add(item.author);
    out.set(item.key, set);
  }
  return out;
}

export function computeLift(
  top: LiftObservation[],
  all: LiftObservation[],
  minTopCount = MIN_PATTERN_COUNT,
): PatternLift[] {
  const topCounts = tally(top.map((t) => t.key));
  const allCounts = tally(all.map((a) => a.key));
  const topAuthors = tallyAuthors(top);
  const topTotal = [...topCounts.values()].reduce((a, b) => a + b, 0);
  const allTotal = [...allCounts.values()].reduce((a, b) => a + b, 0);
  if (!topTotal || !allTotal) return [];

  return [...topCounts.entries()]
    // Se exige el mínimo en AUTORES, no en posts: un patrón que sostiene una
    // sola persona no es un patrón del mercado.
    .filter(([key, count]) => count >= minTopCount && (topAuthors.get(key)?.size ?? 0) >= MIN_PATTERN_AUTHORS)
    .map(([key, count]) => {
      const topShare = count / topTotal;
      const baseShare = (allCounts.get(key) ?? 0) / allTotal;
      return {
        key,
        top_count: count,
        top_authors: topAuthors.get(key)?.size ?? 0,
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
  const eligible = posts.filter(
    (p) =>
      p.analysis.is_relevant_to_hr &&
      p.analysis.audience_signal === "hr_leader" &&
      p.viral_score !== null,
  );
  // Los collabs se publican en dos perfiles y suman las dos audiencias: su
  // rendimiento mide la distribución, no el contenido. En el feed se muestran
  // marcados; acá, donde se decide qué patrón gana, quedan afuera.
  const relevant = eligible.filter((p) => !p.features?.is_collab);

  const ranked = [...relevant].sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0));
  const topCount = Math.max(MIN_TOP_POSTS, Math.ceil(ranked.length * TOP_FRACTION));
  const top = ranked.slice(0, Math.min(topCount, ranked.length));

  const base: RegionSynthesis = {
    region,
    posts_considered: relevant.length,
    top_posts_count: top.length,
    winning_hooks: null,
    winning_themes: null,
    winning_structures: null,
    winning_formats: null,
    winning_ctas: null,
    winning_timeliness: null,
    visual_mix: null,
    visual_lift: null,
    copy_shape: null,
    timing: null,
    company_pages: companyPages(relevant),
    excluded_collabs: eligible.length - relevant.length,
    // Antes era `topic`, texto libre que produjo 907 valores distintos sobre
    // 983 posts: prácticamente uno por post, así que el ranking en pantalla era
    // arbitrario. `claim_object` es vocabulario acotado del rubro y sí agrega.
    top_topics: toSortedList(tally(top.map((p) => p.analysis.claim_object)), 10),
    tone_mix: toSortedList(tally(top.map((p) => p.analysis.tone)), 6),
    // Se filtra por tener CLAIM, no por replicability: un post sin afirmación
    // no le da al calendario nada sobre qué escribir, por replicable que sea
    // su formato.
    replicable_ideas: top
      .filter((p) => p.analysis.claim)
      .slice(0, 8)
      .map((p) => ({
        post_url: p.post_url,
        author_handle: p.author_handle,
        hook: p.analysis.hook,
        hook_pattern: p.analysis.hook_pattern,
        theme: p.analysis.theme,
        claim: p.analysis.claim as string,
        counterclaim: p.analysis.counterclaim ?? null,
        claim_object: p.analysis.claim_object ?? null,
        claim_stance: p.analysis.claim_stance ?? null,
        mechanism: p.analysis.transferable_mechanism ?? "ninguno",
        outlier_factor: p.outlier_factor,
        debate_factor: p.debate_factor ?? null,
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
      top.map((p) => ({ key: p.analysis.hook_pattern, author: p.author_handle })),
      relevant.map((p) => ({ key: p.analysis.hook_pattern, author: p.author_handle })),
    ),
    winning_themes: computeLift(
      top.map((p) => ({ key: p.analysis.theme, author: p.author_handle })),
      relevant.map((p) => ({ key: p.analysis.theme, author: p.author_handle })),
    ),
    visual_mix: visualMix(top),
    visual_lift: visualLift(top, relevant),
    winning_formats: computeLift(
      top.map((p) => ({ key: p.features?.format_detail, author: p.author_handle })),
      relevant.map((p) => ({ key: p.features?.format_detail, author: p.author_handle })),
    ),
    // Solo sobre posts clasificados con la versión que tiene cta_type: una
    // fila vieja sin el campo no es "ninguno", es "no sabemos".
    winning_ctas: computeLift(
      top.map((p) => ({ key: p.analysis.cta_type, author: p.author_handle })),
      relevant.map((p) => ({ key: p.analysis.cta_type, author: p.author_handle })),
    ),
    winning_timeliness: computeLift(
      top.map((p) => ({ key: p.analysis.timeliness, author: p.author_handle })),
      relevant.map((p) => ({ key: p.analysis.timeliness, author: p.author_handle })),
    ),
    copy_shape: copyShape(top, relevant),
    timing: timing(top, relevant),
    // structure ya se extraía y no la leía nadie. Es un eje bastante menos
    // superficial que el hook: el hook son las primeras quince palabras, la
    // estructura es la forma del argumento entero.
    winning_structures: computeLift(
      top.map((p) => ({ key: p.analysis.structure, author: p.author_handle })),
      relevant.map((p) => ({ key: p.analysis.structure, author: p.author_handle })),
    ),
  };
}

/**
 * Mezcla de formatos visuales dentro del corte superior.
 *
 * Se cuentan autores además de posts por la misma razón que en computeLift: un
 * autor que siempre usa el mismo formato no hace que ese formato funcione.
 */
function visualMix(
  top: AnalyzedPost[],
): Array<{ key: string; posts: number; authors: number; median_outlier: number | null }> | null {
  const conVisual = top.filter((p) => p.visual?.visual_format);
  // Con pocas piezas analizadas la mezcla es anecdótica, no un patrón.
  if (conVisual.length < 10) return null;

  const byFormat = new Map<string, AnalyzedPost[]>();
  for (const p of conVisual) {
    const key = p.visual!.visual_format;
    byFormat.set(key, [...(byFormat.get(key) ?? []), p]);
  }

  return [...byFormat.entries()]
    .map(([key, list]) => {
      const outliers = list
        .map((l) => l.outlier_factor)
        .filter((v): v is number => v !== null)
        .sort((a, b) => a - b);
      const mid = Math.floor(outliers.length / 2);
      return {
        key,
        posts: list.length,
        authors: new Set(list.map((l) => l.author_handle)).size,
        median_outlier: outliers.length
          ? Number(
              (outliers.length % 2
                ? outliers[mid]
                : (outliers[mid - 1] + outliers[mid]) / 2
              ).toFixed(2),
            )
          : null,
      };
    })
    .sort((a, b) => b.posts - a.posts);
}

/** Mínimo de piezas analizadas en cada lado para comparar lo visual. */
const MIN_VISUAL_TOP = 10;
const MIN_VISUAL_REST = 15;

/**
 * Corte superior contra el resto, sin pasar por "el total".
 *
 * `computeLift` compara contra el total, y para lo visual el total no existe:
 * el corte se analiza entero y el resto solo por muestra, así que sumarlos
 * sobre-representa el corte en la base. Acá se comparan los dos lados por
 * separado, y un valor tiene que tener voces en LOS DOS: con tres posts
 * arriba y cero en el control, el lift es infinito y no significa nada.
 */
export function computeContrast(
  top: LiftObservation[],
  rest: LiftObservation[],
  minTopCount = MIN_PATTERN_COUNT,
  minRestCount = 2,
): PatternContrast[] {
  const topCounts = tally(top.map((t) => t.key));
  const restCounts = tally(rest.map((r) => r.key));
  const topAuthors = tallyAuthors(top);
  const topTotal = [...topCounts.values()].reduce((a, b) => a + b, 0);
  const restTotal = [...restCounts.values()].reduce((a, b) => a + b, 0);
  if (!topTotal || !restTotal) return [];

  return [...topCounts.entries()]
    .filter(
      ([key, count]) =>
        count >= minTopCount &&
        (topAuthors.get(key)?.size ?? 0) >= MIN_PATTERN_AUTHORS &&
        (restCounts.get(key) ?? 0) >= minRestCount,
    )
    .map(([key, count]) => {
      const topShare = count / topTotal;
      const restCount = restCounts.get(key) ?? 0;
      const restShare = restCount / restTotal;
      return {
        key,
        top_count: count,
        top_authors: topAuthors.get(key)?.size ?? 0,
        top_share: Number(topShare.toFixed(3)),
        rest_count: restCount,
        rest_share: Number(restShare.toFixed(3)),
        lift: Number((topShare / restShare).toFixed(2)),
      };
    })
    .sort((a, b) => b.lift - a.lift || b.top_count - a.top_count);
}

function visualLift(top: AnalyzedPost[], relevant: AnalyzedPost[]): RegionSynthesis["visual_lift"] {
  const topIds = new Set(top.map((p) => p.post_id));
  const topV = top.filter((p) => p.visual?.visual_format);
  const restV = relevant.filter((p) => !topIds.has(p.post_id) && p.visual?.visual_format);
  if (topV.length < MIN_VISUAL_TOP || restV.length < MIN_VISUAL_REST) return null;

  const axis = (pick: (v: NonNullable<AnalyzedPost["visual"]>) => string | undefined) =>
    computeContrast(
      topV.map((p) => ({ key: pick(p.visual!), author: p.author_handle })),
      restV.map((p) => ({ key: pick(p.visual!), author: p.author_handle })),
    );

  return {
    visual_format: axis((v) => v.visual_format),
    production_level: axis((v) => v.production_level),
    person_framing: axis((v) => v.person_framing),
    text_on_image: axis((v) => v.text_on_image),
    top_n: topV.length,
    rest_n: restV.length,
  };
}

function medianOf(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Cómo está escrito lo que funciona, contra cómo está escrito el resto.
 *
 * Es lo que un copywriter copia de verdad y el clasificador no veía: la
 * longitud de la primera línea, el aire entre párrafos, si lleva link. Todo
 * contado, nada inferido.
 */
function copyShape(top: AnalyzedPost[], relevant: AnalyzedPost[]): CopyShapeRow[] | null {
  const topIds = new Set(top.map((p) => p.post_id));
  const topF = top.filter((p) => p.features);
  const restF = relevant.filter((p) => !topIds.has(p.post_id) && p.features);
  if (topF.length < MIN_TOP_POSTS || restF.length < MIN_TOP_POSTS) return null;

  const rows: CopyShapeRow[] = [];
  const numeric = (
    metric: CopyShapeRow["metric"],
    pick: (p: AnalyzedPost) => number | null | undefined,
  ) => {
    const t = topF.map(pick).filter((v): v is number => typeof v === "number");
    const r = restF.map(pick).filter((v): v is number => typeof v === "number");
    const tm = medianOf(t);
    const rm = medianOf(r);
    if (tm === null || rm === null || t.length < MIN_TOP_POSTS) return;
    rows.push({ metric, top: tm, rest: rm, kind: "median", top_n: t.length, rest_n: r.length });
  };
  const share = (metric: CopyShapeRow["metric"], pick: (p: AnalyzedPost) => boolean) => {
    const t = topF.filter(pick).length / topF.length;
    const r = restF.filter(pick).length / restF.length;
    rows.push({
      metric,
      top: Number(t.toFixed(3)),
      rest: Number(r.toFixed(3)),
      kind: "share",
      top_n: topF.length,
      rest_n: restF.length,
    });
  };

  numeric("first_line_chars", (p) => p.features!.first_line_chars);
  numeric("paragraphs", (p) => p.features!.paragraphs);
  numeric("emoji_count", (p) => p.features!.emoji_count);
  numeric("copy_length", (p) => p.analysis.copy_length);
  numeric("slide_count", (p) => p.features!.slide_count);
  share("has_external_link", (p) => p.features!.has_external_link);
  share("ends_with_question", (p) => p.features!.ends_with_question);
  return rows;
}

function timing(top: AnalyzedPost[], relevant: AnalyzedPost[]): RegionSynthesis["timing"] {
  // Solo la muestra cronológica de perfil: ver el comentario del tipo.
  const chrono = (p: AnalyzedPost) => p.baseline_eligible !== false && p.features?.weekday;
  const t = top.filter(chrono);
  const all = relevant.filter(chrono);
  if (t.length < MIN_TOP_POSTS) return null;
  return {
    weekday: computeLift(
      t.map((p) => ({ key: p.features!.weekday, author: p.author_handle })),
      all.map((p) => ({ key: p.features!.weekday, author: p.author_handle })),
    ),
    daypart: computeLift(
      t.map((p) => ({ key: p.features!.daypart, author: p.author_handle })),
      all.map((p) => ({ key: p.features!.daypart, author: p.author_handle })),
    ),
    sample: all.length,
  };
}

const MIN_COMPANY_POSTS = 3;

function companyPages(relevant: AnalyzedPost[]): RegionSynthesis["company_pages"] {
  const companies = relevant.filter((p) => p.features?.author_type === "empresa");
  // Con uno o dos posts no hay nada que mirar: "rinde 0,7×" sobre un post es
  // una anécdota con formato de dato.
  if (companies.length < MIN_COMPANY_POSTS) return null;
  const people = relevant.filter((p) => p.features?.author_type === "persona");
  const outliers = (list: AnalyzedPost[]) =>
    list.map((p) => p.outlier_factor).filter((v): v is number => v !== null);
  const round = (v: number | null) => (v === null ? null : Number(v.toFixed(2)));

  return {
    posts: companies.length,
    authors: new Set(companies.map((p) => p.author_handle)).size,
    median_outlier: round(medianOf(outliers(companies))),
    person_median_outlier: round(medianOf(outliers(people))),
    examples: [...companies]
      .sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0))
      .slice(0, 3)
      .map((p) => ({
        author_handle: p.author_handle,
        post_url: p.post_url,
        hook: p.analysis.hook,
        format: p.features?.format_detail ?? null,
        outlier_factor: p.outlier_factor,
      })),
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
  /** Formatos que ganan en el mercado y no publicamos, o casi. */
  missing_formats?: Array<{ key: string; lift: number; own_share: number }>;
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
  const ownFormats = shareByKey(ownPosts.map((p) => p.features?.format_detail));
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
    missing_formats: (synthesis.winning_formats ?? [])
      .filter((f) => f.lift > 1 && (ownFormats.get(f.key) ?? 0) < 0.1)
      .map((f) => ({
        key: f.key,
        lift: f.lift,
        own_share: Number((ownFormats.get(f.key) ?? 0).toFixed(2)),
      })),
  };
}
