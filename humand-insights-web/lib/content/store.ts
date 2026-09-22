/**
 * Persistencia de Content Discovery.
 *
 * Mismos patrones que competitor-ads/organic-store.ts (Supabase con service
 * role, upserts por constraint, lecturas defensivas), pero sobre las tablas
 * content_* — que no tienen el eje `competitor`.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { CalendarEntry } from "./calendar";
import type { FollowerTier } from "./scoring";

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type SourceKind = "hashtag" | "keyword" | "profile" | "competitor_profile" | "own_brand";
export type ApprovalState = "approved" | "suggested" | "rejected";

export type ContentSource = {
  id: string;
  platform: string;
  kind: SourceKind;
  value: string;
  label: string | null;
  region: string;
  language: string;
  audience: string | null;
  competitor_name: string | null;
  results_limit: number;
  priority: number;
  is_active: boolean;
  discovered_from: string | null;
  approval_state: ApprovalState;
};

export type ContentAuthorUpsert = {
  platform: string;
  handle: string;
  full_name?: string | null;
  biography?: string | null;
  website?: string | null;
  followers_count?: number | null;
  following_count?: number | null;
  posts_count?: number | null;
  avatar_url?: string | null;
  author_kind?: string | null;
  /** urn opaco y estable: el handle puede cambiar y partir la mediana en dos. */
  platform_author_id?: string | null;
  raw?: unknown;
};

export type ContentPostUpsert = {
  platform: string;
  post_id: string;
  author_handle: string;
  post_url: string | null;
  format: string | null;
  caption: string | null;
  caption_length: number | null;
  hashtags: string[];
  mentions: string[];
  posted_at: string | null;
  duration_secs: number | null;
  likes_count: number | null;
  comments_count: number | null;
  video_views: number | null;
  author_followers_at_fetch: number | null;
  /** LinkedIn: shares. Instagram no tiene equivalente. */
  shares_count?: number | null;
  /** LinkedIn: desglose por tipo de reacción (LIKE, PRAISE, EMPATHY...). */
  reactions?: unknown;
  is_pinned: boolean;
  is_paid_partnership: boolean;
  display_url: string | null;
  media: { images: string[]; videos: string[] };
  recent_comments: Array<{ text: string; timestamp: string }>;
  raw: unknown;
};

export type StoredContentPost = ContentPostUpsert & {
  id: string;
  baseline_eligible: boolean;
  /** Región de la fuente que lo trajo. Se resuelve en loadPostsForAuthors. */
  region?: string | null;
  engagement_total: number | null;
  engagement_rate: number | null;
  outlier_factor: number | null;
  viral_score: number | null;
  analysis: unknown | null;
  fetched_at: string;
};

export type JobKind = "discovery" | "analyze" | "hydrate_authors" | "rescore";
export type JobState = "queued" | "running" | "completed" | "failed" | "cancelled";

export type RefreshJob = {
  id: string;
  state: JobState;
  kind: JobKind;
  requested_by: string | null;
  options: Record<string, unknown>;
  source_ids: string[];
  current_label: string | null;
  progress: Record<string, number>;
  results: unknown[];
  cancel_requested: boolean;
  error: string | null;
  started_at: string;
  updated_at: string;
  finished_at: string | null;
};

// ─── Cliente ─────────────────────────────────────────────────────────────────

let _sb: SupabaseClient | null = null;
/** Mismo cliente, expuesto para los módulos que consultan tablas propias. */
export function getSupabaseAdmin(): SupabaseClient {
  return getSupabase();
}

function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  _sb = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(20_000) }),
    },
  });
  return _sb;
}

/**
 * PostgREST manda los filtros en la URL y el server corta los headers en ~16KB.
 * Un `.in("post_id", [...])` con unos cientos de UUIDs lo revienta —falla con
 * HeadersOverflowError, no con un error de query— así que hay que cortarlo.
 * 100 ids son ~3,7KB: entra cómodo.
 */
const IN_CHUNK = 100;

function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Resuelve la región de cada post desde content_post_sources, por lotes. */
async function loadRegionsByPost(postIds: string[]): Promise<Map<string, string>> {
  const regionByPost = new Map<string, string>();
  for (const ids of chunk(postIds)) {
    const { data, error } = await getSupabase()
      .from("content_post_sources")
      .select("post_id, region")
      .in("post_id", ids);
    if (error) throw error;
    for (const link of data ?? []) {
      const id = link.post_id as string;
      const region = link.region as string | null;
      if (region && !regionByPost.has(id)) regionByPost.set(id, region);
    }
  }
  return regionByPost;
}

async function safeRead<T>(label: string, fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[content-store.${label}] fallback:`, err);
    return fallback;
  }
}

// ─── Fuentes ─────────────────────────────────────────────────────────────────

/**
 * Fuentes que entran a una corrida. Solo las aprobadas — las sugeridas esperan
 * curaduría antes de gastar cupo.
 *
 * El filtro de keywords es por plataforma, no global: en Instagram un keyword
 * no se scrapea (no hay búsqueda full-text de posts, hay que resolverlo antes a
 * hashtags o cuentas candidatas), pero en LinkedIn el keyword ES la query de
 * búsqueda y se ejecuta directo.
 */
export async function loadRunnableSources(sourceIds?: string[]): Promise<ContentSource[]> {
  return safeRead("loadRunnableSources", [], async () => {
    let query = getSupabase()
      .from("content_sources")
      .select("*")
      .eq("is_active", true)
      .eq("approval_state", "approved")
      .order("priority", { ascending: true });

    if (sourceIds?.length) query = query.in("id", sourceIds);

    const { data, error } = await query;
    if (error) throw error;
    return ((data ?? []) as ContentSource[]).filter(
      (s) => !(s.platform === "instagram" && s.kind === "keyword"),
    );
  });
}

export async function insertSuggestedSources(
  rows: Array<Omit<ContentSource, "id" | "approval_state"> & { approval_state?: ApprovalState }>,
): Promise<number> {
  if (!rows.length) return 0;
  const { error, count } = await getSupabase()
    .from("content_sources")
    .upsert(
      rows.map((r) => ({ ...r, approval_state: r.approval_state ?? "suggested" })),
      { onConflict: "platform,kind,value,region", ignoreDuplicates: true, count: "exact" },
    );
  if (error) throw error;
  return count ?? 0;
}

export async function markSourceRun(sourceId: string, status: string): Promise<void> {
  await getSupabase()
    .from("content_sources")
    .update({ last_run_at: new Date().toISOString(), last_run_status: status })
    .eq("id", sourceId);
}

// ─── Autores ─────────────────────────────────────────────────────────────────

export async function upsertAuthors(authors: ContentAuthorUpsert[]): Promise<void> {
  if (!authors.length) return;
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("content_authors")
    .upsert(
      authors.map((a) => ({ ...a, fetched_at: now })),
      { onConflict: "platform,handle" },
    );
  if (error) throw error;
}

/**
 * Handles que necesitan hidratación: los que no conocemos, o cuyo perfil está
 * vencido. Sin followers no se puede normalizar engagement, así que este paso
 * es requisito del scoring, no un extra.
 */
export async function handlesNeedingHydration(
  platform: string,
  handles: string[],
  maxAgeDays = 7,
): Promise<string[]> {
  const unique = [...new Set(handles.filter(Boolean))];
  if (!unique.length) return [];

  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  const { data, error } = await getSupabase()
    .from("content_authors")
    .select("handle, followers_count, fetched_at")
    .eq("platform", platform)
    .in("handle", unique);
  if (error) throw error;

  const fresh = new Set(
    (data ?? [])
      .filter((row) => row.followers_count != null && (row.fetched_at ?? "") > cutoff)
      .map((row) => row.handle as string),
  );
  return unique.filter((h) => !fresh.has(h));
}

export async function loadAuthorFollowers(
  platform: string,
  handles: string[],
): Promise<Map<string, number | null>> {
  const unique = [...new Set(handles.filter(Boolean))];
  if (!unique.length) return new Map();

  const { data, error } = await getSupabase()
    .from("content_authors")
    .select("handle, followers_count")
    .eq("platform", platform)
    .in("handle", unique);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.handle as string, (r.followers_count ?? null) as number | null]));
}

export async function updateAuthorBaseline(
  platform: string,
  handle: string,
  baseline: { median: number; sample: number; tier: FollowerTier | null },
): Promise<void> {
  await getSupabase()
    .from("content_authors")
    .update({
      median_engagement: baseline.median,
      median_sample_size: baseline.sample,
      follower_tier: baseline.tier,
    })
    .eq("platform", platform)
    .eq("handle", handle);
}

// ─── Posts ───────────────────────────────────────────────────────────────────

export async function upsertPosts(posts: ContentPostUpsert[]): Promise<number> {
  if (!posts.length) return 0;
  const now = new Date().toISOString();
  const { error } = await getSupabase()
    .from("content_posts")
    .upsert(
      posts.map((p) => ({ ...p, fetched_at: now })),
      { onConflict: "platform,post_id" },
    );
  if (error) throw error;
  return posts.length;
}

/**
 * Vincula los posts con su autor por (platform, handle).
 *
 * La FK `content_posts.author_id` existía desde la migración inicial y nunca se
 * llenaba: el mapper no la produce y el upsert no la calcula, así que estuvo en
 * cero sobre mil posts. El scoring nunca lo notó porque agrupa por handle, pero
 * cualquier lectura que quiera datos del autor —avatar, seguidores, si está
 * verificado— se queda sin nada.
 *
 * Se resuelve acá y no en el upsert porque el autor puede insertarse DESPUÉS
 * que sus posts (en LinkedIn se persiste desde el propio post).
 */
export async function linkPostsToAuthors(platform: string): Promise<number> {
  const { data: authors, error: authorsError } = await getSupabase()
    .from("content_authors")
    .select("id, handle")
    .eq("platform", platform);
  if (authorsError) throw authorsError;

  const rows = (authors ?? []) as Array<{ id: string; handle: string }>;
  if (!rows.length) return 0;

  let linked = 0;
  for (const author of rows) {
    const { error, count } = await getSupabase()
      .from("content_posts")
      .update({ author_id: author.id }, { count: "exact" })
      .eq("platform", platform)
      .eq("author_handle", author.handle)
      .is("author_id", null);
    if (error) throw error;
    linked += count ?? 0;
  }
  return linked;
}

/** Vincula posts a la fuente que los trajo. Un post puede venir de varias. */
export async function linkPostsToSource(
  source: ContentSource,
  postKeys: Array<{ platform: string; post_id: string }>,
  runId: string,
): Promise<void> {
  if (!postKeys.length) return;

  const found: Array<{ id: string; post_id: string }> = [];
  for (const batch of chunk(postKeys.map((k) => k.post_id))) {
    const { data, error } = await getSupabase()
      .from("content_posts")
      .select("id, post_id")
      .eq("platform", source.platform)
      .in("post_id", batch);
    if (error) throw error;
    found.push(...((data ?? []) as Array<{ id: string; post_id: string }>));
  }

  const rows = found.map((row) => ({
    post_id: row.id as string,
    source_id: source.id,
    run_id: runId,
    region: source.region,
    language: source.language,
  }));
  if (!rows.length) return;

  const { error: linkError } = await getSupabase()
    .from("content_post_sources")
    .upsert(rows, { onConflict: "post_id,source_id", ignoreDuplicates: true });
  if (linkError) throw linkError;
}

/**
 * Marca posts como aptos para alimentar la mediana del autor.
 *
 * Solo el scrape de perfil califica: devuelve una muestra cronológica contigua.
 * Los resultados de búsqueda vienen ordenados por relevancia — son el techo del
 * autor — y si entraran, la mediana se pegaría al máximo y outlier_factor
 * colapsaría a ~1 para todos.
 *
 * Es un UPDATE aparte del upsert a propósito: así un re-upsert del mismo post
 * llegando por búsqueda no lo vuelve a poner en false.
 */
export async function markBaselineEligible(
  keys: Array<{ platform: string; post_id: string }>,
): Promise<void> {
  if (!keys.length) return;
  const byPlatform = new Map<string, string[]>();
  for (const k of keys) {
    const list = byPlatform.get(k.platform) ?? [];
    list.push(k.post_id);
    byPlatform.set(k.platform, list);
  }
  for (const [platform, ids] of byPlatform) {
    for (const batch of chunk(ids)) {
      const { error } = await getSupabase()
        .from("content_posts")
        .update({ baseline_eligible: true })
        .eq("platform", platform)
        .in("post_id", batch);
      if (error) throw error;
    }
  }
}

/** Posts de los autores dados — necesario para calcular la baseline por autor. */
export async function loadPostsForAuthors(
  platform: string,
  handles: string[],
): Promise<StoredContentPost[]> {
  const unique = [...new Set(handles.filter(Boolean))];
  if (!unique.length) return [];
  return safeRead("loadPostsForAuthors", [], async () => {
    const { data, error } = await getSupabase()
      .from("content_posts")
      .select("*")
      .eq("platform", platform)
      .in("author_handle", unique);
    if (error) throw error;
    const posts = (data ?? []) as StoredContentPost[];
    if (!posts.length) return posts;

    // La región vive en content_post_sources, no en content_posts. Sin este
    // join el scoring recibía region: null para todo y la cohorte de mercado
    // quedaba muerta — con Brasil y España en la misma bolsa.
    const regionByPost = await loadRegionsByPost(posts.map((p) => p.id));
    return posts.map((p) => ({ ...p, region: regionByPost.get(p.id) ?? null }));
  });
}

export async function saveScores(
  scores: Array<{
    platform: string;
    post_id: string;
    engagement_total: number;
    engagement_rate: number | null;
    outlier_factor: number | null;
    viral_score: number | null;
  }>,
): Promise<void> {
  if (!scores.length) return;
  const scoredAt = new Date().toISOString();
  const sb = getSupabase();
  // Update y no upsert: no queremos crear filas si el post desapareció.
  for (const score of scores) {
    const { error } = await sb
      .from("content_posts")
      .update({
        engagement_total: score.engagement_total,
        engagement_rate: score.engagement_rate,
        outlier_factor: score.outlier_factor,
        viral_score: score.viral_score,
        scored_at: scoredAt,
      })
      .eq("platform", score.platform)
      .eq("post_id", score.post_id);
    if (error) throw error;
  }
}

/**
 * Posts sin clasificar, priorizados por score: se analiza primero lo que ya
 * sabemos que funcionó. Clasificar todo sería gastar tokens en el ruido.
 */
/**
 * Handles con posts sin puntuar que ya pasaron la ventana de madurez.
 *
 * Es la entrada de `rescoreStragglers`. El corte de 72h cubre el umbral más
 * alto de las dos plataformas, así que no re-puntúa nada prematuramente.
 */
export async function loadHandlesWithUnscoredPosts(platform: string): Promise<string[]> {
  return safeRead("loadHandlesWithUnscoredPosts", [], async () => {
    const cutoff = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabase()
      .from("content_posts")
      .select("author_handle")
      .eq("platform", platform)
      .is("viral_score", null)
      .lt("posted_at", cutoff)
      .limit(2000);
    if (error) throw error;
    return [...new Set((data ?? []).map((r) => r.author_handle as string))];
  });
}

export async function loadUnanalyzedPosts(
  platform: string,
  limit = 100,
): Promise<StoredContentPost[]> {
  return safeRead("loadUnanalyzedPosts", [], async () => {
    const { data, error } = await getSupabase()
      .from("content_posts")
      .select("*")
      .eq("platform", platform)
      .is("analysis", null)
      .not("viral_score", "is", null)
      .order("viral_score", { ascending: false })
      .limit(limit);
    if (error) throw error;
    return (data ?? []) as StoredContentPost[];
  });
}

export async function savePostAnalyses(
  platform: string,
  analyses: Array<{ post_id: string; analysis: unknown }>,
  model: string,
): Promise<number> {
  if (!analyses.length) return 0;
  const analyzedAt = new Date().toISOString();
  const sb = getSupabase();
  let saved = 0;
  for (const item of analyses) {
    const { error } = await sb
      .from("content_posts")
      .update({ analysis: item.analysis, analysis_model: model, analyzed_at: analyzedAt })
      .eq("platform", platform)
      .eq("post_id", item.post_id);
    if (error) throw error;
    saved += 1;
  }
  return saved;
}

export async function insertMetricSnapshots(
  rows: Array<{
    post_id: string;
    likes_count: number | null;
    comments_count: number | null;
    video_views: number | null;
    author_followers: number | null;
    engagement_rate: number | null;
  }>,
): Promise<void> {
  if (!rows.length) return;
  const { error } = await getSupabase().from("content_metric_snapshots").insert(rows);
  if (error) throw error;
}

/** Posts ya clasificados y puntuados, con su región, para sintetizar. */
export async function loadAnalyzedPosts(platform?: string): Promise<StoredContentPost[]> {
  return safeRead("loadAnalyzedPosts", [], async () => {
    let query = getSupabase()
      .from("content_posts")
      .select("*")
      .not("analysis", "is", null)
      .not("viral_score", "is", null);
    if (platform) query = query.eq("platform", platform);

    const { data, error } = await query;
    if (error) throw error;
    const posts = (data ?? []) as StoredContentPost[];
    if (!posts.length) return posts;

    const regionByPost = await loadRegionsByPost(posts.map((p) => p.id));
    return posts.map((p) => ({ ...p, region: regionByPost.get(p.id) ?? null }));
  });
}

export async function saveRegionInsight(
  region: string,
  payload: unknown,
  postsAnalyzed: number,
  model: string,
): Promise<void> {
  const { error } = await getSupabase().from("content_insights").upsert(
    {
      scope: "region",
      scope_key: region,
      payload,
      model,
      posts_analyzed: postsAnalyzed,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "scope,scope_key" },
  );
  if (error) throw error;
}

export async function saveCalendar(
  region: string,
  month: string,
  payload: unknown,
  model: string,
): Promise<void> {
  const { error } = await getSupabase().from("content_insights").upsert(
    {
      scope: "calendar",
      scope_key: `${region}:${month}`,
      payload,
      model,
      generated_at: new Date().toISOString(),
    },
    { onConflict: "scope,scope_key" },
  );
  if (error) throw error;
}

/** Handles de las cuentas propias de Humand, en todas las redes. */
export async function loadOwnBrandHandles(): Promise<string[]> {
  return safeRead("loadOwnBrandHandles", [], async () => {
    const { data, error } = await getSupabase()
      .from("content_sources")
      .select("value")
      .eq("kind", "own_brand");
    if (error) throw error;
    // El value de LinkedIn viene como "company/humand" pero el author_handle de
    // los posts es solo "humand": se guarda el último segmento.
    return (data ?? []).map((r) => (r.value as string).split("/").pop() as string);
  });
}

export async function saveOwnBrandComparison(region: string, payload: unknown): Promise<void> {
  const { error } = await getSupabase().from("content_insights").upsert(
    {
      scope: "own_brand",
      scope_key: region,
      payload,
      model: "deterministic-v1",
      generated_at: new Date().toISOString(),
    },
    { onConflict: "scope,scope_key" },
  );
  if (error) throw error;
}

/**
 * Deja cada pieza sugerida como 'pending' para que alguien la decida.
 *
 * ignoreDuplicates a propósito: si el calendario se regenera y una pieza se
 * repite igual, no puede pisar una decisión que ya se tomó.
 */
/**
 * Borra el feedback PENDIENTE de piezas que ya no existen.
 *
 * El calendario se regenera cada semana y los títulos cambian, así que las
 * claves cambian con ellos. Sin esta limpieza cada corrida dejaba atrás una
 * tanda entera de filas apuntando a piezas muertas: después de una sola
 * regeneración la app decía "78 sin revisar" cuando las vivas eran 39, y el
 * número seguía creciendo cada lunes.
 *
 * Solo se borra lo que está en `pending`. Una pieza que alguien aprobó,
 * descartó o publicó es historia de una decisión real y se conserva aunque el
 * calendario ya no la incluya — es la base de la métrica del brief.
 */
/**
 * Las piezas de un mes sobre las que ya hay una decisión tomada.
 *
 * Se lee del snapshot guardado en `content_suggestion_feedback.entry`, no del
 * calendario: el calendario se reescribe y el snapshot es justamente lo que la
 * persona vio cuando decidió.
 */
export async function loadDecidedEntries(
  region: string,
  month: string,
): Promise<CalendarEntry[]> {
  return safeRead("loadDecidedEntries", [], async () => {
    const { data, error } = await getSupabase()
      .from("content_suggestion_feedback")
      .select("entry")
      .eq("region", region)
      .eq("month", month)
      .neq("state", "pending");
    if (error) throw error;
    return (data ?? [])
      .map((r) => r.entry as CalendarEntry)
      .filter((e) => e && e.date && e.title);
  });
}

export async function pruneStaleSuggestions(
  region: string,
  month: string,
  liveKeys: string[],
): Promise<number> {
  let query = getSupabase()
    .from("content_suggestion_feedback")
    .delete({ count: "exact" })
    .eq("region", region)
    .eq("month", month)
    .eq("state", "pending");

  // `not in ()` con lista vacía es SQL inválido; sin piezas vivas se borra todo
  // lo pendiente de ese mes, que es justamente lo correcto.
  if (liveKeys.length) {
    query = query.not("entry_key", "in", `(${liveKeys.join(",")})`);
  }

  const { error, count } = await query;
  if (error) throw error;
  return count ?? 0;
}

export async function seedSuggestionFeedback(
  rows: Array<{
    entry_key: string;
    region: string;
    month: string;
    publish_date: string | null;
    entry: unknown;
  }>,
): Promise<number> {
  if (!rows.length) return 0;
  const { error, count } = await getSupabase()
    .from("content_suggestion_feedback")
    .upsert(
      rows.map((r) => ({ ...r, state: "pending" })),
      { onConflict: "entry_key", ignoreDuplicates: true, count: "exact" },
    );
  if (error) throw error;
  return count ?? 0;
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export async function createJob(input: {
  kind: JobKind;
  requestedBy: string | null;
  options: Record<string, unknown>;
  sourceIds: string[];
}): Promise<RefreshJob> {
  const { data, error } = await getSupabase()
    .from("content_refresh_jobs")
    .insert({
      kind: input.kind,
      state: "queued",
      requested_by: input.requestedBy,
      options: input.options,
      source_ids: input.sourceIds,
      progress: {},
      results: [],
    })
    .select()
    .single();
  if (error) throw error;
  return data as RefreshJob;
}

export async function getJob(jobId: string): Promise<RefreshJob | null> {
  return safeRead("getJob", null, async () => {
    const { data, error } = await getSupabase()
      .from("content_refresh_jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (error) throw error;
    return (data as RefreshJob) ?? null;
  });
}

/** Job activo del mismo kind, para no lanzar dos corridas en paralelo. */
export async function findActiveJob(kind: JobKind): Promise<RefreshJob | null> {
  return safeRead("findActiveJob", null, async () => {
    const { data, error } = await getSupabase()
      .from("content_refresh_jobs")
      .select("*")
      .eq("kind", kind)
      .in("state", ["queued", "running"])
      .order("started_at", { ascending: false })
      .limit(1);
    if (error) throw error;
    return ((data ?? [])[0] as RefreshJob) ?? null;
  });
}

/** Cada update mueve updated_at, que hace de heartbeat. */
export async function updateJob(jobId: string, patch: Partial<RefreshJob>): Promise<void> {
  const { error } = await getSupabase()
    .from("content_refresh_jobs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", jobId);
  if (error) console.warn("[content-store.updateJob]", error);
}

export const STALE_JOB_MS = 5 * 60_000;

/**
 * Marca como fallidos los jobs que dejaron de latir. Pasa cuando Railway
 * redeploya a mitad de una corrida: el proceso muere y nadie cierra la fila.
 */
export async function reapStaleJobs(): Promise<number> {
  return safeRead("reapStaleJobs", 0, async () => {
    const cutoff = new Date(Date.now() - STALE_JOB_MS).toISOString();
    const { data, error } = await getSupabase()
      .from("content_refresh_jobs")
      .update({
        state: "failed",
        error: "Sin heartbeat: el proceso murió (probable redeploy).",
        finished_at: new Date().toISOString(),
      })
      .in("state", ["queued", "running"])
      .lt("updated_at", cutoff)
      .select("id");
    if (error) throw error;
    return (data ?? []).length;
  });
}
