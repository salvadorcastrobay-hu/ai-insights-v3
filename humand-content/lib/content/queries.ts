/**
 * Lecturas de Supabase.
 *
 * La app lee las tablas directo con service role desde el servidor — no pasa
 * por el motor. El motor solo se usa para disparar trabajo (ver engine.ts).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { createHash } from "crypto";

import type {
  ApprovalMetrics,
  ContentCalendar,
  ContentPost,
  ContentSource,
  CoverageSnapshot,
  FeedbackState,
  MarketPosition,
  OwnBrandComparison,
  RefreshJob,
  RegionSynthesis,
  SuggestionFeedback,
} from "./types";

let cached: SupabaseClient | undefined;

function sb(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }
  cached = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

export type PostFilters = {
  region?: string;
  platform?: string;
  audience?: string;
  /** Solo posts que el clasificador marcó como relevantes para RRHH. */
  onlyRelevant?: boolean;
  /**
   * Solo posts con outlier_factor, o sea de cuentas de las que conocemos su
   * línea base. Sin eso no se puede afirmar que un post haya funcionado: los
   * descubiertos por búsqueda traen 1-2 posts por autor y sin baseline se
   * apoyan solo en volumen — así trepaban anuncios de cambio de trabajo de
   * cuentas cualquiera por encima de los referentes.
   */
  onlyMeasured?: boolean;
  /**
   * Por qué eje ordenar. `viral` es alcance; `debate` es fricción — cuánto más
   * se discutió el post que lo normal de su autor. Son independientes: medido
   * sobre los datos reales, la correlación entre los dos es -0,08.
   */
  sortBy?: "viral" | "debate";
  limit?: number;
};

const POST_COLUMNS =
  "id, platform, post_id, author_handle, post_url, format, caption, posted_at," +
  " likes_count, comments_count, shares_count, outlier_factor, debate_factor," +
  " viral_score, analysis, features," +
  // display_url y media estaban guardados desde la primera corrida y nunca se
  // pedían acá: por eso la app no mostraba una sola foto.
  " display_url, media, stored_media, visual_analysis";

/** El bucket de imágenes es privado; la URL firmada se emite por request. */
const MEDIA_BUCKET = "content-media";
const SIGNED_URL_TTL = 3600;

/**
 * Resuelve las imágenes archivadas a URLs firmadas, en una sola llamada.
 *
 * No se usa `display_url` para mostrar: esa es la URL del CDN y viene firmada
 * por ellos con vencimiento corto (4,4 días en Instagram). Sirve para archivar,
 * no para pintar. Lo que se muestra sale siempre de `stored_media`.
 */
async function signMediaFor(posts: ContentPost[]): Promise<void> {
  const paths = posts.flatMap((p) => p.stored_media?.images?.slice(0, 1) ?? []);
  if (!paths.length) return;

  const { data, error } = await sb()
    .storage.from(MEDIA_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_TTL);
  // Una firma que falla degrada a tarjeta sin foto, que es un estado previsto.
  if (error || !data) return;

  const byPath = new Map(
    data.filter((d) => d.signedUrl).map((d) => [d.path as string, d.signedUrl]),
  );
  for (const post of posts) {
    const path = post.stored_media?.images?.[0];
    post.image_url = path ? (byPath.get(path) ?? null) : null;
  }
}

/**
 * Trae los autores de un conjunto de posts y los indexa por platform+handle.
 *
 * Se une por handle y no por la FK `author_id` porque esa columna está en cero:
 * la ingesta nunca la llena (el scoring también une por handle). Mientras siga
 * así, un embed de PostgREST devuelve null para todos.
 */
async function loadAuthorsFor(posts: ContentPost[]): Promise<void> {
  const handles = [...new Set(posts.map((p) => p.author_handle))];
  if (!handles.length) return;

  const rows: Array<Record<string, unknown>> = [];
  for (const batch of chunk(handles)) {
    const { data, error } = await sb()
      .from("content_authors")
      .select("platform, handle, avatar_url, full_name, followers_count, is_verified")
      .in("handle", batch);
    if (error) throw error;
    rows.push(...((data ?? []) as Array<Record<string, unknown>>));
  }

  const byKey = new Map(rows.map((r) => [`${r.platform}:${r.handle}`, r]));
  for (const post of posts) {
    const row = byKey.get(`${post.platform}:${post.author_handle}`);
    post.author = row
      ? {
          avatar_url: (row.avatar_url as string) ?? null,
          full_name: (row.full_name as string) ?? null,
          followers_count: (row.followers_count as number) ?? null,
          is_verified: (row.is_verified as boolean) ?? null,
        }
      : null;
  }
}

/**
 * PostgREST manda los filtros en la URL y el server corta los headers en ~16KB.
 * Un `.in()` con cientos de UUIDs lo revienta — y falla con "fetch failed", no
 * con un error de query, así que es fácil de diagnosticar mal.
 */
const IN_CHUNK = 100;

/**
 * El builder de PostgREST tipa cada `.eq()`/`.not()` encadenado, así que armar
 * la query en un loop hace explotar la inferencia. Este alias la corta.
 */
type PostgrestQuery = {
  not: (column: string, operator: string, value: unknown) => PostgrestQuery;
  eq: (column: string, value: unknown) => PostgrestQuery;
  in: (column: string, values: readonly unknown[]) => PostgrestQuery;
  order: (column: string, opts: { ascending: boolean }) => PostgrestQuery;
  limit: (count: number) => PromiseLike<{ data: unknown[] | null; error: unknown }>;
};

function chunk<T>(items: T[], size = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Ids de posts de una región. La región vive en content_post_sources. */
async function postIdsForRegion(region: string): Promise<string[]> {
  const { data, error } = await sb()
    .from("content_post_sources")
    .select("post_id")
    .eq("region", region)
    .limit(5000);
  if (error) throw error;
  return [...new Set((data ?? []).map((r) => r.post_id as string))];
}

/**
 * Feed rankeado.
 *
 * Los filtros van en SQL, no en memoria: filtrar después de aplicar el `limit`
 * devolvía dos posts cuando había cientos — el limit se comía el resultado
 * antes de que el filtro corriera.
 */
export async function loadRankedPosts(filters: PostFilters = {}): Promise<ContentPost[]> {
  const limit = filters.limit ?? 60;

  // Los filtros se arman como lista y se aplican en un loop: encadenarlos
  // directo hace que TypeScript infiera un tipo cada vez más profundo y termine
  // en "Type instantiation is excessively deep".
  const eqFilters: Array<[string, string]> = [];
  if (filters.platform) eqFilters.push(["platform", filters.platform]);
  // Filtros sobre el jsonb de análisis, resueltos por Postgres.
  if (filters.onlyRelevant) eqFilters.push(["analysis->>is_relevant_to_hr", "true"]);
  if (filters.audience) eqFilters.push(["analysis->>audience_signal", filters.audience]);

  const notNull = ["viral_score", ...(filters.onlyMeasured ? ["outlier_factor"] : [])];

  const base = () => {
    let q = sb().from("content_posts").select(POST_COLUMNS) as unknown as PostgrestQuery;
    for (const column of notNull) q = q.not(column, "is", null);
    for (const [column, value] of eqFilters) q = q.eq(column, value);
    // Ordenar por debate exige tenerlo medido: sin eso el orden lo definen los
    // nulls y el feed se llena de posts sin señal.
    if (filters.sortBy === "debate") {
      return q.not("debate_factor", "is", null).order("debate_factor", { ascending: false });
    }
    return q.order("viral_score", { ascending: false });
  };

  if (!filters.region) {
    const { data, error } = await base().limit(limit);
    if (error) throw error;
    const posts = (data ?? []) as unknown as ContentPost[];
    await Promise.all([loadAuthorsFor(posts), signMediaFor(posts)]);
    return posts;
  }

  const sortKey = filters.sortBy === "debate" ? "debate_factor" : "viral_score";
  const ids = await postIdsForRegion(filters.region);
  if (!ids.length) return [];

  // Se consulta por lotes y se reordena al final: cada lote viene ordenado por
  // score, pero entre lotes no hay orden garantizado.
  const batches = await Promise.all(
    chunk(ids).map(async (batch) => {
      const { data, error } = await base().in("id", batch).limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as ContentPost[];
    }),
  );

  const posts = batches
    .flat()
    // Se reordena en memoria porque cada lote viene ordenado por su cuenta:
    // entre lotes no hay orden garantizado. Tiene que ser por el MISMO eje que
    // pidió el filtro — ordenar por viral cuando se pidió debate devuelve el
    // feed equivocado sin que nada falle.
    .sort((a, b) => ((b[sortKey] as number) ?? 0) - ((a[sortKey] as number) ?? 0))
    .slice(0, limit);
  await Promise.all([loadAuthorsFor(posts), signMediaFor(posts)]);
  return posts;
}

export async function loadSources(): Promise<ContentSource[]> {
  const { data, error } = await sb()
    .from("content_sources")
    .select(
      "id, platform, kind, value, label, region, language, audience, results_limit," +
        " is_active, approval_state, notes, last_run_at, last_run_status",
    )
    .order("approval_state", { ascending: true })
    .order("platform", { ascending: true })
    .order("kind", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as unknown as ContentSource[];
}

/**
 * Las posiciones del rubro: el debate que cruza los tres mercados.
 *
 * Se guardan aparte de las síntesis por mercado porque se calculan sobre el
 * corpus entero. Por mercado hay ~100 claims relevantes y ninguna práctica
 * junta los autores que hacen falta; agrupando los tres, sí.
 */
export async function loadMarketPositions(): Promise<MarketPosition[]> {
  const { data, error } = await sb()
    .from("content_insights")
    .select("payload")
    .eq("scope", "region")
    .eq("scope_key", "rubro")
    .limit(1);
  if (error) throw error;
  const payload = (data ?? [])[0]?.payload as { positions?: MarketPosition[] } | undefined;
  return payload?.positions ?? [];
}

export async function loadSyntheses(): Promise<RegionSynthesis[]> {
  const { data, error } = await sb()
    .from("content_insights")
    .select("payload, posts_analyzed")
    .eq("scope", "region")
    .neq("scope_key", "rubro")
    .order("posts_analyzed", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => r.payload as RegionSynthesis);
}

export async function loadOwnBrandComparisons(): Promise<
  Array<{ region: string; comparison: OwnBrandComparison }>
> {
  const { data, error } = await sb()
    .from("content_insights")
    .select("scope_key, payload")
    .eq("scope", "own_brand");
  if (error) throw error;
  return (data ?? []).map((r) => ({
    region: r.scope_key as string,
    comparison: r.payload as OwnBrandComparison,
  }));
}

export async function loadCalendars(): Promise<ContentCalendar[]> {
  const { data, error } = await sb()
    .from("content_insights")
    .select("payload")
    .eq("scope", "calendar")
    .order("scope_key", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r) => r.payload as ContentCalendar);
}

/**
 * Último job. El estado vive en Postgres, así que se lee de acá y no hace falta
 * pollear al motor por HTTP.
 */
export async function loadLatestJob(): Promise<RefreshJob | null> {
  const { data, error } = await sb()
    .from("content_refresh_jobs")
    .select("id, state, kind, current_label, progress, error, started_at, finished_at")
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return ((data ?? [])[0] as RefreshJob) ?? null;
}

export async function loadStats(): Promise<{
  posts: number;
  analyzed: number;
  sources: number;
  suggested: number;
}> {
  const counts = await Promise.all([
    sb().from("content_posts").select("*", { count: "exact", head: true }),
    sb().from("content_posts").select("*", { count: "exact", head: true }).not("analysis", "is", null),
    sb().from("content_sources").select("*", { count: "exact", head: true }).eq("approval_state", "approved"),
    sb().from("content_sources").select("*", { count: "exact", head: true }).eq("approval_state", "suggested"),
  ]);
  return {
    posts: counts[0].count ?? 0,
    analyzed: counts[1].count ?? 0,
    sources: counts[2].count ?? 0,
    suggested: counts[3].count ?? 0,
  };
}

/** Aprobar o rechazar una fuente sugerida. Es la curaduría que hace Content. */
export async function setSourceApproval(
  id: string,
  state: "approved" | "rejected",
): Promise<void> {
  const { error } = await sb()
    .from("content_sources")
    .update({ approval_state: state, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

// ─── Feedback y métricas (sección 10 del brief) ──────────────────────────────

/**
 * Misma clave que calcula el motor en metrics.ts. Se duplica a propósito: son
 * dos servicios distintos y compartir un paquete por una función de 4 líneas
 * costaría más que mantenerla en dos lados. Si divergen, el feedback deja de
 * matchear — está cubierto por test en el motor.
 */
export function suggestionKey(
  region: string,
  month: string,
  date: string,
  title: string,
): string {
  return createHash("sha1")
    .update([region, month, date, title.trim().toLowerCase()].join("|"))
    .digest("hex")
    .slice(0, 20);
}

export async function loadFeedback(): Promise<Map<string, SuggestionFeedback>> {
  const { data, error } = await sb()
    .from("content_suggestion_feedback")
    .select("entry_key, region, month, publish_date, state, edit_note, published_url, decided_by, decided_at");
  if (error) throw error;
  const rows = (data ?? []) as unknown as SuggestionFeedback[];
  return new Map(rows.map((r) => [r.entry_key, r]));
}

export async function setFeedback(
  entryKey: string,
  state: FeedbackState,
  decidedBy: string | null,
  editNote?: string | null,
  /**
   * Link de la pieza ya publicada. Es lo que habilita la cuarta métrica del
   * brief: comparar lo que publicamos contra nuestro propio baseline. Solo se
   * pisa cuando viene un valor, para que un "deshacer" no borre el link.
   */
  publishedUrl?: string | null,
): Promise<void> {
  const patch: Record<string, unknown> = {
    state,
    edit_note: editNote ?? null,
    decided_by: decidedBy,
    decided_at: new Date().toISOString(),
  };
  if (publishedUrl !== undefined) patch.published_url = publishedUrl;

  const { error } = await sb()
    .from("content_suggestion_feedback")
    .update(patch)
    .eq("entry_key", entryKey);
  if (error) throw error;
}

export async function loadApprovalMetrics(): Promise<ApprovalMetrics> {
  const { data, error } = await sb().from("content_suggestion_feedback").select("state");
  if (error) throw error;
  const rows = (data ?? []) as Array<{ state: string }>;
  const n = (s: string) => rows.filter((r) => r.state === s).length;
  const asIs = n("approved_as_is");
  const decided = asIs + n("approved_edited") + n("rejected") + n("published");
  return {
    total_decided: decided,
    approved_as_is: asIs,
    approved_edited: n("approved_edited"),
    rejected: n("rejected"),
    published: n("published"),
    approved_as_is_rate: decided ? Number((asIs / decided).toFixed(3)) : null,
    pending: n("pending"),
  };
}

export async function loadCoverage(limit = 6): Promise<CoverageSnapshot[]> {
  const { data, error } = await sb()
    .from("content_coverage_snapshots")
    .select("week, platforms_covered, sources_total, sources_ok, sources_failed, competitors_covered, posts_ingested, posts_analyzed")
    .order("week", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CoverageSnapshot[];
}
