/**
 * Ranking de contenido "viral".
 *
 * El problema: ninguna métrica sola sirve para comparar cuentas de tamaños
 * distintos. El engagement absoluto siempre gana con las cuentas grandes; el
 * engagement rate crudo (likes/followers) siempre gana con las chicas, porque
 * el ER baja monótonamente con el tamaño de la cuenta. Rankear por cualquiera
 * de los dos da un feed sesgado y sin nada para aprender.
 *
 * La señal que sí se aprende es cuánto sobre-performó un post RESPECTO DE LA
 * LÍNEA BASE DE SU PROPIA CUENTA. Eso es naturalmente invariante al tamaño: es
 * lo que hace comparable a la influencer de 500k con la marca de 5k.
 *
 * Tres capas + decaimiento temporal:
 *   1. outlier_factor — eng / mediana del autor. La que más pesa.
 *   2. er_pct         — percentil del ER dentro de (tier de followers × región).
 *                       Neutraliza tanto la caída de ER por tamaño como la
 *                       diferencia de engagement medio entre mercados.
 *                       Ojo: la cohorte se arma con posts, así que una cuenta
 *                       con muchos posts y pocos pares infla su propio
 *                       percentil. Con varias cuentas por tier se diluye; si
 *                       en producción se ve sesgo, pasar a percentil sobre la
 *                       mediana por autor en vez de post a post.
 *   3. reach          — piso de alcance absoluto. Un post con outlier 8x y 40
 *                       likes no es viral, es ruido.
 *
 * Todo determinístico y sin LLM: se valida en un CSV antes de gastar un token.
 */

/** El comentario cuesta ~2 órdenes de magnitud más que el like. */
export const COMMENT_WEIGHT = 2;

/** Antes de las 48h las métricas no maduraron: el post no compite todavía. */
export const MIN_AGE_HOURS = 48;

/** Vida media del decaimiento, en días. */
export const DECAY_HALFLIFE_DAYS = 45;

/** El outlier satura acá: 8x y 30x son "explotó", no hace falta distinguirlos. */
/** Debajo de esto el ratio de comentarios es ruido, no señal. */
export const MIN_ENGAGEMENT_FOR_DEBATE = 20;

/** Mismo techo que el outlier: 8x ya es "muchísimo" y más no agrega. */
export const DEBATE_CAP = 8;

export const OUTLIER_CAP = 8;

/** Sin esta cantidad de posts previos del autor no hay mediana confiable. */
export const MIN_BASELINE_SAMPLE = 5;

export const WEIGHTS = { outlier: 0.45, cohort: 0.35, reach: 0.2 } as const;

export type Platform = "instagram" | "linkedin";

export type PlatformScoring = {
  weights: { outlier: number; cohort: number; reach: number };
  engagement: (post: ScorablePost) => number;
  minAgeHours: number;
  decayHalflifeDays: number;
  /** Si es false, no hay follower count y el percentil de cohorte no aplica. */
  useFollowerCohort: boolean;
};

/**
 * LinkedIn no expone followersCount en ninguno de los dos actores (medido), así
 * que la capa de percentil por cohorte de tamaño no existe ahí. No uso la
 * redistribución automática de pesos —que daría 0.69/0.31— porque esa está
 * pensada para cuando a UN post le falta baseline, donde castigarlo sería
 * injusto. Acá falta una capa entera en toda la plataforma: con el outlier sin
 * contrapeso, el autor de mediana 20 que hizo 160 le gana al de mediana 800 que
 * hizo 2400. 0.55/0.45 es donde un 3x sobre base decente le gana a un 8x sobre
 * base irrelevante.
 *
 * Pesos del engagement en LinkedIn: el share pesa más que el comentario porque
 * redistribuye a una red nueva — es la única de las tres que genera alcance y
 * no solo interacción. El comentario sube de 2 a 3 porque acá es texto
 * profesional firmado con nombre y cargo, no un emoji.
 */
export const SCORING: Record<Platform, PlatformScoring> = {
  instagram: {
    weights: WEIGHTS,
    engagement: (p) => (p.likes_count ?? 0) + COMMENT_WEIGHT * (p.comments_count ?? 0),
    minAgeHours: MIN_AGE_HOURS,
    decayHalflifeDays: DECAY_HALFLIFE_DAYS,
    useFollowerCohort: true,
  },
  linkedin: {
    weights: { outlier: 0.55, cohort: 0, reach: 0.45 },
    engagement: (p) =>
      (p.likes_count ?? 0) + 3 * (p.comments_count ?? 0) + 5 * (p.shares_count ?? 0),
    // LinkedIn distribuye en oleadas de 24-72h: antes de eso no maduró.
    minAgeHours: 72,
    // El contenido B2B envejece más lento que el de Instagram.
    decayHalflifeDays: 60,
    useFollowerCohort: false,
  },
};

export type FollowerTier = "micro" | "mid" | "macro" | "mega";

export type ScorablePost = {
  post_id: string;
  author_handle: string;
  likes_count: number | null;
  comments_count: number | null;
  video_views: number | null;
  /** Followers del autor CONGELADOS al momento del fetch, no los de hoy. */
  author_followers_at_fetch: number | null;
  /** LinkedIn: shares. Instagram no tiene equivalente. */
  shares_count?: number | null;
  posted_at: string | null;
  is_pinned?: boolean | null;
  region?: string | null;
  /**
   * Si el post viene de una muestra cronológica del autor (scrape de perfil) y
   * por lo tanto puede alimentar su mediana. Los resultados de búsqueda vienen
   * ordenados por relevancia — son el techo del autor — y si entran, la mediana
   * se pega al máximo y outlier_factor colapsa a ~1 para todos.
   */
  baseline_eligible?: boolean;
  /**
   * Collab de Instagram: se publica en dos perfiles y suma las dos audiencias.
   * No entra a la mediana del autor —la subiría con alcance prestado— pero sí
   * se puntúa: que explotó es un dato, solo que no del contenido.
   */
  is_collab?: boolean;
  /**
   * Pide comentar una palabra a cambio de algo. Sus comentarios son pedidos,
   * no fricción: no tiene debate_factor ni alimenta el del autor.
   */
  comment_bait?: boolean;
};

export type PostScore = {
  post_id: string;
  engagement_total: number;
  engagement_rate: number | null;
  outlier_factor: number | null;
  viral_score: number | null;
  /**
   * Cuánto MÁS discutido fue este post que lo normal de su autor.
   *
   * `viral_score` mide atención: un post con 500 likes y 2 comentarios y otro
   * con 500 likes y 200 comentarios puntúan casi igual, y no son lo mismo. El
   * segundo tocó un nervio. Para contenido B2B la fricción es mejor señal que
   * el asentimiento: un post que se discute marca un tema sobre el que el
   * mercado no se puso de acuerdo, y eso es material para escribir.
   *
   * Se mide contra la propia base del autor por la misma razón que
   * outlier_factor: hay autores que siempre generan debate y autores que no.
   */
  debate_factor: number | null;
  /** Por qué quedó fuera del ranking, si quedó fuera. */
  excluded_reason: "immature" | "pinned" | null;
};

export function followerTier(followers: number | null | undefined): FollowerTier | null {
  if (!followers || followers <= 0) return null;
  if (followers < 10_000) return "micro";
  if (followers < 100_000) return "mid";
  if (followers < 1_000_000) return "macro";
  return "mega";
}

export function engagementTotal(post: ScorablePost, platform: Platform = "instagram"): number {
  return SCORING[platform].engagement(post);
}

export function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function ageInDays(postedAt: string | null, now: Date = new Date()): number | null {
  if (!postedAt) return null;
  const ts = Date.parse(postedAt);
  if (Number.isNaN(ts)) return null;
  return (now.getTime() - ts) / 86_400_000;
}

/** Comprime el outlier a 0..1 saturando en OUTLIER_CAP. */
export function squash(factor: number): number {
  if (!(factor > 0)) return 0;
  return Math.min(1, Math.log2(1 + factor) / Math.log2(1 + OUTLIER_CAP));
}

/**
 * Cohorte mínima para que el percentil signifique algo. Con menos que esto, un
 * post se compara contra un puñado de pares (a veces contra sí mismo) y el
 * resultado es ruido: el único post de su tier saca percentil 0, no 0.5.
 */
export const MIN_COHORT_SIZE = 5;

/**
 * Fracción de valores de la cohorte por debajo de `value`. 0..1.
 * Devuelve 0.5 (neutro) si la cohorte es demasiado chica para ser informativa.
 */
export function percentileRank(value: number, cohort: number[]): number {
  if (cohort.length < MIN_COHORT_SIZE) return 0.5;
  const below = cohort.reduce((acc, v) => acc + (v < value ? 1 : 0), 0);
  return below / cohort.length;
}

export function percentile(values: number[], p: number): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[index];
}

/** Piso de alcance: log del engagement contra el P95 global. */
export function reachFactor(engagement: number, p95: number | null): number {
  if (!p95 || p95 <= 0) return 0;
  if (engagement <= 0) return 0;
  return Math.min(1, Math.log10(1 + engagement) / Math.log10(1 + p95));
}

/** Un post cuenta para la baseline solo si sus métricas ya maduraron. */
export function isMature(
  post: ScorablePost,
  now: Date = new Date(),
  platform: Platform = "instagram",
): boolean {
  const age = ageInDays(post.posted_at, now);
  return age === null || age * 24 >= SCORING[platform].minAgeHours;
}

/**
 * Baseline por autor: mediana del engagement de sus posts conocidos.
 * Mediana y no promedio, para que un viral previo no aplaste la línea base y
 * haga parecer normales a los posts que sí sobresalen.
 *
 * Solo cuentan los posts maduros. Los scrapes por hashtag traen posts de hace
 * minutos con likesCount 0 (Instagram devuelve lo más reciente, no lo más
 * popular): incluirlos hunde la mediana y hace que cualquier post normal
 * parezca un outlier gigante.
 */
export function authorBaselines(
  posts: ScorablePost[],
  now: Date = new Date(),
  platform: Platform = "instagram",
): Map<string, { median: number; sample: number }> {
  const byAuthor = new Map<string, number[]>();
  for (const post of posts) {
    if (!isMature(post, now, platform)) continue;
    // Los posts que no vienen de una muestra cronológica del autor quedan
    // afuera: ver el comentario de baseline_eligible en ScorablePost.
    if (post.baseline_eligible === false) continue;
    if (post.is_collab) continue;
    const list = byAuthor.get(post.author_handle) ?? [];
    list.push(engagementTotal(post, platform));
    byAuthor.set(post.author_handle, list);
  }

  const out = new Map<string, { median: number; sample: number }>();
  for (const [handle, values] of byAuthor) {
    const med = median(values);
    if (med !== null) out.set(handle, { median: med, sample: values.length });
  }
  return out;
}

/** Proporción de la interacción que fue comentario, no like. */
function commentRatio(post: ScorablePost): number | null {
  const likes = post.likes_count ?? 0;
  const comments = post.comments_count ?? 0;
  const total = likes + comments;
  // Sin volumen el ratio es puro ruido: 1 comentario y 1 like da 0,5.
  if (total < MIN_ENGAGEMENT_FOR_DEBATE) return null;
  return comments / total;
}

/**
 * Ratio de comentarios habitual de cada autor.
 *
 * Mismas exclusiones que authorBaselines: solo posts maduros y de muestra
 * cronológica, porque un resultado de búsqueda es el techo del autor y no su
 * comportamiento normal.
 */
export function authorDebateBaselines(
  posts: ScorablePost[],
  now: Date = new Date(),
  platform: Platform = "instagram",
): Map<string, { median: number; sample: number }> {
  const byAuthor = new Map<string, number[]>();
  for (const post of posts) {
    if (!isMature(post, now, platform)) continue;
    if (post.baseline_eligible === false) continue;
    if (post.is_collab || post.comment_bait) continue;
    const ratio = commentRatio(post);
    if (ratio === null) continue;
    const list = byAuthor.get(post.author_handle) ?? [];
    list.push(ratio);
    byAuthor.set(post.author_handle, list);
  }

  const out = new Map<string, { median: number; sample: number }>();
  for (const [handle, values] of byAuthor) {
    const med = median(values);
    // Un autor cuyo ratio mediano es 0 no da denominador: se omite en vez de
    // dividir por cero y fabricar un debate infinito.
    if (med !== null && med > 0) out.set(handle, { median: med, sample: values.length });
  }
  return out;
}

/**
 * Puntúa un conjunto de posts. Se corre sobre TODO el set (no post por post)
 * porque las capas 2 y 3 son relativas al resto: el percentil necesita la
 * cohorte y el piso de alcance necesita el P95 global.
 */
export function scorePosts(
  posts: ScorablePost[],
  now: Date = new Date(),
  platform: Platform = "instagram",
): PostScore[] {
  const cfg = SCORING[platform];
  const baselines = authorBaselines(posts, now, platform);

  const enriched = posts.map((post) => {
    const engagement = engagementTotal(post, platform);
    const followers = post.author_followers_at_fetch;
    const rate =
      cfg.useFollowerCohort && followers && followers > 0 ? engagement / followers : null;
    const age = ageInDays(post.posted_at, now);
    const baseline = baselines.get(post.author_handle);
    const outlier =
      baseline && baseline.sample >= MIN_BASELINE_SAMPLE && baseline.median > 0
        ? engagement / baseline.median
        : null;
    return { post, engagement, rate, age, outlier, tier: followerTier(followers) };
  });

  // El piso de alcance y las cohortes se calculan solo sobre los posts que
  // compiten; incluir los inmaduros correría los percentiles hacia abajo.
  const eligible = enriched.filter(
    (e) => !e.post.is_pinned && (e.age === null || e.age * 24 >= cfg.minAgeHours),
  );

  // El P95 del alcance va por MERCADO, no global. Con Brasil y España en la
  // misma tabla, España perdía siempre: el volumen absoluto de engagement no es
  // comparable entre mercados. Es el trabajo que hacía el percentil de cohorte
  // y que en LinkedIn, sin followers, hay que recuperar por acá.
  const marketKey = (post: ScorablePost) => post.region ?? "unknown";
  const p95ByMarket = new Map<string, number | null>();
  for (const key of new Set(eligible.map((e) => marketKey(e.post)))) {
    p95ByMarket.set(
      key,
      percentile(
        eligible.filter((e) => marketKey(e.post) === key).map((e) => e.engagement),
        0.95,
      ),
    );
  }

  const cohorts = new Map<string, number[]>();
  for (const item of eligible) {
    if (item.rate === null || !item.tier) continue;
    const key = `${item.tier}|${marketKey(item.post)}`;
    const list = cohorts.get(key) ?? [];
    list.push(item.rate);
    cohorts.set(key, list);
  }

  // Ratio de comentarios habitual por autor. Es el denominador de debate_factor.
  const debateBase = authorDebateBaselines(posts, now, platform);

  return enriched.map(({ post, engagement, rate, age, outlier, tier }) => {
    const ratio = post.comment_bait ? null : commentRatio(post);
    const authorRatio = debateBase.get(post.author_handle);
    const debate =
      ratio !== null && authorRatio && authorRatio.sample >= MIN_BASELINE_SAMPLE
        ? Math.min(DEBATE_CAP, ratio / authorRatio.median)
        : null;

    const base: Omit<PostScore, "viral_score" | "excluded_reason"> = {
      post_id: post.post_id,
      engagement_total: engagement,
      engagement_rate: rate,
      outlier_factor: outlier,
      debate_factor: debate === null ? null : Number(debate.toFixed(2)),
    };

    if (post.is_pinned) {
      // El pineado acumula engagement por posición en el perfil, no por calidad.
      return { ...base, viral_score: null, excluded_reason: "pinned" };
    }
    if (age !== null && age * 24 < cfg.minAgeHours) {
      return { ...base, viral_score: null, excluded_reason: "immature" };
    }

    // Sin followers no hay percentil posible: neutro en 0.5 para no premiar ni
    // castigar al post por un dato que nos falta a nosotros.
    const cohortKey = tier ? `${tier}|${marketKey(post)}` : null;
    const erPct =
      rate !== null && cohortKey
        ? percentileRank(rate, cohorts.get(cohortKey) ?? [])
        : 0.5;

    // Sin baseline del autor (cuenta recién descubierta, <5 posts conocidos) el
    // término de outlier no aporta información. Redistribuimos su peso entre
    // las otras dos capas en vez de multiplicar por 0, que equivaldría a
    // castigar al post por algo que nos falta a nosotros — y que hacía que una
    // cuenta chica con 13% de engagement quedara debajo de una grande con 0.1%.
    const reach = reachFactor(engagement, p95ByMarket.get(marketKey(post)) ?? null);
    const w = cfg.weights;
    const raw =
      outlier !== null
        ? w.outlier * squash(outlier) + w.cohort * erPct + w.reach * reach
        : (w.cohort * erPct + w.reach * reach) / (w.cohort + w.reach);

    const decay = age !== null ? Math.exp(-age / cfg.decayHalflifeDays) : 1;

    return { ...base, viral_score: raw * decay, excluded_reason: null };
  });
}
