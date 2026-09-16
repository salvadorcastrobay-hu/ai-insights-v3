/**
 * Job de discovery de contenido.
 *
 * Pipeline por corrida:
 *   1. fetch     — trae posts de cada fuente activa, respetando su results_limit
 *   2. upsert    — persiste posts y los vincula a la fuente que los trajo
 *   3. suggest   — de los hashtags, extrae las cuentas que aparecen y las deja
 *                  como fuentes 'suggested' para que Content las apruebe
 *   4. hydrate   — completa followers de los autores que no conocemos
 *   5. rescore   — recalcula baselines y métricas de ranking sobre el set
 *
 * Por qué los hashtags NO son la fuente del ranking (verificado contra la API
 * real el 2026-09-09): el hashtag scraper devuelve los posts MÁS RECIENTES, no
 * los más populares, y no tiene modo "top". Los items vienen con likesCount 0
 * porque son de hace minutos, y sin ownerFollowersCount. O sea: sirven para
 * descubrir QUIÉN habla del tema, no para medir qué funcionó.
 *
 * El engagement real sale del scraper de perfil, que sí devuelve likes y
 * comments. Así que el hashtag alimenta un roster de cuentas por región —que es
 * lo que se pidió, "referentes"— y el ranking se calcula sobre los posts de las
 * cuentas aprobadas.
 *
 * A diferencia de organic-refresh-job.ts, el estado vive en Postgres y no en
 * globalThis: acá el que pollea es otra app, y un redeploy de Railway no puede
 * llevarse el job puesto.
 */
import { createHash, randomUUID } from "crypto";

import {
  fetchInstagramHashtag,
  fetchInstagramFeed,
  fetchInstagramProfiles,
  type RawInstagramPost,
} from "@/lib/competitor-ads/apify";
import {
  createJob,
  findActiveJob,
  handlesNeedingHydration,
  insertSuggestedSources,
  linkPostsToSource,
  loadAuthorFollowers,
  loadPostsForAuthors,
  loadRunnableSources,
  loadUnanalyzedPosts,
  markBaselineEligible,
  markSourceRun,
  savePostAnalyses,
  saveScores,
  updateAuthorBaseline,
  updateJob,
  upsertAuthors,
  upsertPosts,
  type ContentPostUpsert,
  type ContentSource,
  type RefreshJob,
} from "./store";
import { classifyPosts } from "./classify";
import {
  fetchLinkedInProfilePosts,
  searchLinkedInPosts,
  type RawLinkedInPost,
} from "./linkedin";
import {
  authorBaselines,
  followerTier,
  scorePosts,
  type Platform,
  type ScorablePost,
} from "./scoring";

const HEARTBEAT_MS = 10_000;

/** Fuentes que devuelven una muestra cronológica del autor, apta para baseline. */
const PROFILE_KINDS = new Set(["profile", "competitor_profile", "own_brand"]);

export type DiscoveryOptions = {
  /** Tope global por fuente. Si no viene, manda el results_limit de cada una. */
  maxItemsPerSource?: number;
  /** Corta la corrida entera. Red de seguridad contra un gasto inesperado. */
  maxTotalItems?: number;
};

export type SourceResult = {
  source_id: string;
  label: string;
  kind: string;
  region: string;
  fetched: number;
  upserted: number;
  /** Cuentas nuevas dejadas como 'suggested' (solo fuentes de tipo hashtag). */
  suggested_accounts?: number;
  error?: string;
};

// ─── Mapeo de items de Apify ─────────────────────────────────────────────────

function collectMedia(raw: RawInstagramPost): { images: string[]; videos: string[] } {
  const images: string[] = [];
  const videos: string[] = [];
  const add = (list: string[], value: string | null | undefined) => {
    if (value && !list.includes(value)) list.push(value);
  };
  add(images, raw.displayUrl);
  add(videos, raw.videoUrl);
  for (const image of raw.images ?? []) add(images, image);
  for (const child of raw.childPosts ?? []) {
    add(images, child.displayUrl);
    add(videos, child.videoUrl);
  }
  return { images, videos };
}

function normalizeFormat(type: string | undefined | null): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes("reel")) return "reel";
  if (t.includes("video")) return "video";
  if (t.includes("sidecar") || t.includes("carousel") || t.includes("album")) return "sidecar";
  if (t.includes("image") || t.includes("photo")) return "image";
  return t;
}

function postId(raw: RawInstagramPost): string | null {
  const direct = raw.shortCode ?? raw.id;
  if (direct && String(direct).trim()) return String(direct).trim();
  const media = collectMedia(raw);
  const fingerprint = [raw.url, raw.timestamp, media.images[0], media.videos[0], raw.caption?.slice(0, 200)]
    .filter(Boolean)
    .join("|");
  if (!fingerprint) return null;
  return `generated_${createHash("sha1").update(fingerprint).digest("hex").slice(0, 16)}`;
}

function authorHandle(raw: RawInstagramPost): string | null {
  return (raw.ownerUsername ?? raw.username ?? null)?.trim() || null;
}

function mapInstagramPost(raw: RawInstagramPost, platform: string): ContentPostUpsert | null {
  const id = postId(raw);
  const handle = authorHandle(raw);
  if (!id || !handle) return null;

  const caption = raw.caption ?? null;
  const media = collectMedia(raw);

  return {
    platform,
    post_id: id,
    author_handle: handle,
    post_url: raw.url ?? null,
    format: normalizeFormat(raw.type),
    caption,
    caption_length: caption ? caption.length : null,
    hashtags: Array.isArray(raw.hashtags) ? raw.hashtags : [],
    mentions: Array.isArray(raw.mentions) ? raw.mentions : [],
    posted_at: raw.timestamp ? new Date(raw.timestamp).toISOString() : null,
    duration_secs: raw.videoDuration ?? null,
    likes_count: raw.likesCount ?? null,
    comments_count: raw.commentsCount ?? null,
    video_views: raw.videoViewCount ?? null,
    // Puede venir null en items de hashtag; lo completa el paso de hidratación.
    author_followers_at_fetch: raw.ownerFollowersCount ?? raw.followersCount ?? null,
    is_pinned: Boolean(raw.isPinned),
    // El scraper de perfil lo llama isPaidPartnership; el de hashtag, paidPartnership.
    is_paid_partnership: Boolean(
      raw.isPaidPartnership ?? (raw as unknown as { paidPartnership?: boolean }).paidPartnership,
    ),
    display_url: media.images[0] ?? raw.displayUrl ?? null,
    media,
    recent_comments: (raw.latestComments ?? []).slice(0, 5).map((c) => ({
      text: c.text,
      timestamp: c.timestamp,
    })),
    raw,
  };
}


// ─── Mapeo de items de LinkedIn ──────────────────────────────────────────────

function linkedInPostId(raw: RawLinkedInPost): string | null {
  // `id` es el urn de la actividad. shareUrn queda EXCLUIDO a propósito: en
  // reposts apunta al share original, así que dos autores compartiendo el mismo
  // contenido colisionarían contra UNIQUE (platform, post_id) y se fusionarían
  // en una sola fila.
  const direct = raw.id ?? raw.entityId;
  if (direct && String(direct).trim()) return String(direct).trim();
  const url = raw.linkedinUrl;
  if (!url) return null;
  return `generated_${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
}

/**
 * Un repost puro no es contenido del autor: su engagement pertenece a quien lo
 * escribió, y mezclarlo arruina la mediana. El actor de perfil lo filtra con
 * includeReposts:false, pero el de búsqueda no expone ese flag — así que el
 * descarte se hace acá para los dos canales por igual.
 */
function isBareRepost(raw: RawLinkedInPost): boolean {
  if (!raw.repost && !raw.repostId) return false;
  return (raw.content ?? "").trim().length < 40;
}

function linkedInAuthorHandle(raw: RawLinkedInPost): string | null {
  const author = raw.author ?? {};
  // publicIdentifier es el slug de la URL y es estable para personas y
  // empresas. El nombre no sirve: cambia y se repite.
  const id = author.publicIdentifier ?? author.universalName ?? null;
  return id ? String(id).trim().toLowerCase() : null;
}

function linkedInPostedAt(raw: RawLinkedInPost): string | null {
  const posted = raw.postedAt;
  if (!posted) return null;
  if (typeof posted === "string") {
    const parsed = Date.parse(posted);
    return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
  }
  if (posted.date) {
    const parsed = Date.parse(posted.date);
    if (!Number.isNaN(parsed)) return new Date(parsed).toISOString();
  }
  return posted.timestamp ? new Date(posted.timestamp).toISOString() : null;
}

function mapLinkedInPost(raw: RawLinkedInPost): ContentPostUpsert | null {
  if (isBareRepost(raw)) return null;
  const id = linkedInPostId(raw);
  const handle = linkedInAuthorHandle(raw);
  if (!id || !handle) return null;

  const engagement = raw.engagement ?? {};
  const content = raw.content ?? null;
  const images = (raw.postImages ?? [])
    .map((img) => img?.url)
    .filter((u): u is string => Boolean(u));

  return {
    platform: "linkedin",
    post_id: id,
    author_handle: handle,
    post_url: raw.linkedinUrl ?? null,
    // LinkedIn no declara formato como Instagram; se infiere de lo que trae.
    format: images.length ? "image" : "text",
    caption: content,
    caption_length: content ? content.length : null,
    hashtags: [...(content ?? "").matchAll(/#([\p{L}\p{N}_]+)/gu)].map((m) => m[1]),
    mentions: [],
    posted_at: linkedInPostedAt(raw),
    duration_secs: null,
    // reactions es el desglose de likes, no un canal aparte: se toma el máximo
    // de los dos, nunca la suma.
    likes_count: Math.max(
      engagement.likes ?? 0,
      (engagement.reactions ?? []).reduce((acc, r) => acc + (r.count ?? 0), 0),
    ),
    comments_count: engagement.comments ?? null,
    video_views: null,
    shares_count: engagement.shares ?? null,
    reactions: engagement.reactions ?? null,
    // Medido: ninguno de los dos actores de LinkedIn expone followersCount.
    author_followers_at_fetch: null,
    is_pinned: false,
    is_paid_partnership: false,
    display_url: images[0] ?? null,
    media: { images, videos: [] },
    recent_comments: [],
    raw,
  };
}

// ─── Pasos ───────────────────────────────────────────────────────────────────

/**
 * Trae y mapea los posts de una fuente, sea de la red que sea.
 *
 * Cada plataforma difiere en algo que importa: en Instagram la búsqueda por
 * hashtag NO devuelve engagement (solo sirve para descubrir cuentas), mientras
 * que en LinkedIn la búsqueda ordena por relevancia y sí lo devuelve — así que
 * ahí los resultados se rankean directo.
 */
async function fetchSource(
  source: ContentSource,
  maxItems: number,
): Promise<ContentPostUpsert[]> {
  if (source.platform === "linkedin") {
    switch (source.kind) {
      case "profile":
      case "competitor_profile":
      case "own_brand": {
        const posts = await fetchLinkedInProfilePosts([source.value], { maxPosts: maxItems });
        return posts.map(mapLinkedInPost).filter((p): p is ContentPostUpsert => p !== null);
      }
      case "hashtag":
      case "keyword": {
        const posts = await searchLinkedInPosts(source.value, {
          // Se pide de más y se filtra duro por headline: a USD 0,00001 el post
          // el sobrecosto es nulo y la precisión sube mucho.
          maxPosts: Math.max(maxItems * 2, 40),
          sortBy: "relevance",
          language: source.language,
        });
        return posts.map(mapLinkedInPost).filter((p): p is ContentPostUpsert => p !== null);
      }
      default:
        return [];
    }
  }

  // Instagram
  switch (source.kind) {
    case "hashtag": {
      const raw = await fetchInstagramHashtag(source.value, { maxItems });
      return raw
        .map((item) => mapInstagramPost(item, source.platform))
        .filter((p): p is ContentPostUpsert => p !== null);
    }
    case "profile":
    case "competitor_profile":
    case "own_brand": {
      const feed = await fetchInstagramFeed(source.value, { maxItems });
      return feed.posts
        .map((item) => mapInstagramPost(item, source.platform))
        .filter((p): p is ContentPostUpsert => p !== null);
    }
    case "keyword":
      // En Instagram no se scrapea: se resuelve aparte con searchInstagram y
      // queda como sugerencias. loadRunnableSources ya lo filtra.
      return [];
    default:
      return [];
  }
}

/**
 * Persiste los autores de LinkedIn desde los propios posts.
 *
 * En Instagram los autores se completan con un paso de hidratación aparte
 * porque hay que pedir el perfil. En LinkedIn no existe ese endpoint —los dos
 * actores no exponen followersCount— pero cada post sí trae nombre y headline,
 * así que se aprovecha eso en vez de perderlo.
 */
async function persistLinkedInAuthors(raw: RawLinkedInPost[]): Promise<void> {
  const byHandle = new Map<string, { name: string | null; info: string | null; urn: string | null }>();
  for (const item of raw) {
    const author = item.author;
    const handle = (author?.publicIdentifier ?? author?.universalName ?? "").trim().toLowerCase();
    if (!handle || byHandle.has(handle)) continue;
    byHandle.set(handle, {
      name: author?.name ?? null,
      info: author?.info ?? null,
      urn: author?.urn ?? null,
    });
  }
  if (!byHandle.size) return;

  await upsertAuthors(
    [...byHandle.entries()].map(([handle, a]) => ({
      platform: "linkedin",
      handle,
      full_name: a.name,
      // El headline de LinkedIn cumple el rol de la bio: dice qué hace la
      // persona, que es lo que permite juzgar si es referente del rubro.
      biography: a.info,
      platform_author_id: a.urn,
      author_kind: "influencer",
    })),
  );
}

/**
 * De un scrape de hashtag saca las cuentas que aparecieron y las deja como
 * fuentes candidatas, en estado 'suggested'.
 *
 * No se scrapean solas: alguien de Content las aprueba primero. Con el plan
 * FREE de Apify eso no es burocracia, es la contención de gasto — un hashtag
 * activo puede devolver 30 cuentas distintas y scrapear los posts de todas
 * cuesta ~$0.005 cada una, por corrida, para siempre.
 */
async function suggestAccountsFromHashtag(
  source: ContentSource,
  posts: ContentPostUpsert[],
): Promise<number> {
  const handles = [...new Set(posts.map((p) => p.author_handle).filter(Boolean))];
  if (!handles.length) return 0;

  return insertSuggestedSources(
    handles.map((handle) => ({
      platform: source.platform,
      kind: "profile" as const,
      value: handle,
      label: handle,
      region: source.region,
      language: source.language,
      audience: source.audience,
      competitor_name: null,
      results_limit: 30,
      priority: 200,
      is_active: true,
      discovered_from: source.id,
    })),
  ).catch((err) => {
    console.warn("[discovery-job] no pude sugerir cuentas:", err);
    return 0;
  });
}

/**
 * Completa followers de los autores que no conocemos. Sin esto, los posts que
 * vienen de hashtag quedan sin engagement rate y el ranking se degrada.
 */
async function hydrateAuthors(platform: string, handles: string[]): Promise<number> {
  const pending = await handlesNeedingHydration(platform, handles);
  if (!pending.length) return 0;

  // Un solo run para todos los handles: mucho más barato que uno por cuenta.
  const profiles = await fetchInstagramProfiles(pending);
  if (!profiles.length) return 0;

  await upsertAuthors(
    profiles.map((p) => ({
      platform,
      handle: p.handle,
      full_name: p.full_name,
      biography: p.biography,
      website: p.website,
      followers_count: p.followers_count,
      following_count: p.following_count,
      posts_count: p.posts_count,
      avatar_url: p.avatar_url,
      raw: p.raw,
    })),
  );
  return profiles.length;
}

/**
 * Recalcula baselines por autor y las métricas de ranking.
 *
 * Se corre sobre todos los posts conocidos de los autores tocados, no solo
 * sobre los recién traídos: la mediana del autor y los percentiles de cohorte
 * son relativos al conjunto.
 */
export async function rescoreAuthors(platform: Platform, handles: string[]): Promise<number> {
  const posts = await loadPostsForAuthors(platform, handles);
  if (!posts.length) return 0;

  // Rellena followers faltantes con lo que ya sabemos del autor, para que los
  // posts viejos sin snapshot no queden fuera del percentil de cohorte.
  const followers = await loadAuthorFollowers(platform, handles);
  const scorable: ScorablePost[] = posts.map((p) => ({
    post_id: p.post_id,
    author_handle: p.author_handle,
    likes_count: p.likes_count,
    comments_count: p.comments_count,
    video_views: p.video_views,
    shares_count: p.shares_count ?? null,
    author_followers_at_fetch: p.author_followers_at_fetch ?? followers.get(p.author_handle) ?? null,
    posted_at: p.posted_at,
    is_pinned: p.is_pinned,
    region: p.region ?? null,
    baseline_eligible: p.baseline_eligible,
  }));

  const scores = scorePosts(scorable, new Date(), platform);
  await saveScores(scores.map((s) => ({ platform, ...s })));

  const baselines = authorBaselines(scorable, new Date(), platform);
  for (const [handle, baseline] of baselines) {
    await updateAuthorBaseline(platform, handle, {
      median: baseline.median,
      sample: baseline.sample,
      tier: followerTier(followers.get(handle) ?? null),
    });
  }

  return scores.length;
}

/**
 * Clasifica los posts mejor rankeados que todavía no tienen análisis.
 *
 * Va por score descendente a propósito: lo que importa entender es lo que
 * funcionó. Clasificar la cola larga sería gastar tokens en ruido.
 */
export async function runAnalysis(
  platform: Platform,
  limit = 100,
): Promise<{ analyzed: number; skipped: number }> {
  const posts = await loadUnanalyzedPosts(platform, limit);
  if (!posts.length) return { analyzed: 0, skipped: 0 };

  const analyses = await classifyPosts(
    posts.map((p) => ({
      post_id: p.post_id,
      caption: p.caption,
      hashtags: p.hashtags,
      format: p.format,
      author_label: p.author_handle,
      likes_count: p.likes_count,
      comments_count: p.comments_count,
    })),
  );

  const rows = [...analyses.entries()].map(([post_id, analysis]) => ({ post_id, analysis }));
  const saved = await savePostAnalyses(
    platform,
    rows,
    process.env.CONTENT_ANALYSIS_MODEL ?? process.env.COMPETITOR_ADS_MODEL ?? "gpt-4o-mini",
  );
  return { analyzed: saved, skipped: posts.length - saved };
}

// ─── Orquestación ────────────────────────────────────────────────────────────

async function runDiscovery(job: RefreshJob, options: DiscoveryOptions): Promise<void> {
  const runId = randomUUID();
  const results: SourceResult[] = [];
  /** Autores cuyos posts entran al ranking, por plataforma. */
  const touchedByPlatform = new Map<Platform, Set<string>>();
  const touch = (platform: string, handle: string) => {
    const key = platform as Platform;
    const set = touchedByPlatform.get(key) ?? new Set<string>();
    set.add(handle);
    touchedByPlatform.set(key, set);
  };
  /** Autores solo descubiertos por hashtag: se hidratan igual (details cuesta
   *  $0) para que el roster sea revisable — sin followers ni bio no hay forma
   *  de decidir si una cuenta vale la pena aprobar. */
  const discoveredHandles = new Set<string>();
  let totalUpserted = 0;

  const sources = await loadRunnableSources(job.source_ids.length ? job.source_ids : undefined);
  await updateJob(job.id, { state: "running", progress: { done: 0, total: sources.length, upserted: 0 } });

  const heartbeat = setInterval(() => {
    void updateJob(job.id, {});
  }, HEARTBEAT_MS);

  try {
    for (const [index, source] of sources.entries()) {
      const current = await getCancelState(job.id);
      if (current) {
        await updateJob(job.id, {
          state: "cancelled",
          finished_at: new Date().toISOString(),
          results,
        });
        return;
      }

      const label = source.label ?? source.value;
      await updateJob(job.id, {
        current_label: label,
        progress: { done: index, total: sources.length, upserted: totalUpserted },
      });

      const maxItems = Math.min(
        source.results_limit,
        options.maxItemsPerSource ?? source.results_limit,
        Math.max(0, (options.maxTotalItems ?? Infinity) - totalUpserted),
      );

      if (maxItems <= 0) {
        results.push({
          source_id: source.id,
          label,
          kind: source.kind,
          region: source.region,
          fetched: 0,
          upserted: 0,
          error: "cupo total de la corrida agotado",
        });
        continue;
      }

      try {
        const mapped = await fetchSource(source, maxItems);
        const raw = mapped.map((m) => m.raw as RawLinkedInPost);

        await upsertPosts(mapped);
        // Solo el scrape de perfil da una muestra cronológica contigua del
        // autor. Los resultados de búsqueda vienen ordenados por relevancia:
        // son el TECHO del autor, y si alimentan su mediana el outlier_factor
        // colapsa a ~1 para todos y se apaga la capa que más pesa del ranking.
        if (PROFILE_KINDS.has(source.kind)) {
          await markBaselineEligible(
            mapped.map((p) => ({ platform: p.platform, post_id: p.post_id })),
          );
        }
        await linkPostsToSource(
          source,
          mapped.map((p) => ({ platform: p.platform, post_id: p.post_id })),
          runId,
        );

        // LinkedIn no tiene paso de hidratación (no expone followers), así que
        // el autor se persiste desde el propio post. El headline (author.info)
        // es la "descripción de cuenta" que pide la sección 4 del brief.
        if (source.platform === "linkedin") {
          await persistLinkedInAuthors(raw).catch((err) =>
            console.warn("[discovery-job] no pude guardar autores de LinkedIn:", err),
          );
        }

        // Los posts de hashtag no entran al ranking (vienen sin engagement),
        // así que tampoco tocan las baselines: solo aportan las cuentas.
        let suggested = 0;
        if (source.kind === "hashtag") {
          suggested = await suggestAccountsFromHashtag(source, mapped);
          for (const p of mapped) discoveredHandles.add(p.author_handle);
        } else {
          for (const p of mapped) touch(p.platform, p.author_handle);
        }
        totalUpserted += mapped.length;

        results.push({
          source_id: source.id,
          label,
          kind: source.kind,
          region: source.region,
          fetched: mapped.length,
          upserted: mapped.length,
          suggested_accounts: suggested,
        });
        await markSourceRun(source.id, "ok");
      } catch (err) {
        // Una fuente que falla no aborta la corrida: Instagram rompe scrapers
        // seguido y no queremos perder el resto del trabajo por eso.
        const message = (err as Error)?.message ?? String(err);
        results.push({
          source_id: source.id,
          label,
          kind: source.kind,
          region: source.region,
          fetched: 0,
          upserted: 0,
          error: message,
        });
        await markSourceRun(source.id, `error: ${message.slice(0, 200)}`);
      }

      await updateJob(job.id, {
        results,
        progress: { done: index + 1, total: sources.length, upserted: totalUpserted },
      });
    }

    // La hidratación es solo de Instagram: LinkedIn no expone followersCount en
    // ninguno de los dos actores, así que no habría nada que traer.
    const igHandles = touchedByPlatform.get("instagram") ?? new Set<string>();
    const toHydrate = [...new Set([...igHandles, ...discoveredHandles])];
    await updateJob(job.id, { current_label: "Hidratando autores…" });
    const hydrated = toHydrate.length
      ? await hydrateAuthors("instagram", toHydrate).catch((err) => {
          console.warn("[discovery-job] hidratación falló:", err);
          return 0;
        })
      : 0;

    // El ranking se recalcula solo sobre los autores con posts medibles: los
    // descubiertos por hashtag todavía no tienen engagement que puntuar.
    await updateJob(job.id, { current_label: "Recalculando ranking…" });
    let scored = 0;
    const scoreErrors: string[] = [];
    for (const [platform, handleSet] of touchedByPlatform) {
      const handles = [...handleSet];
      if (!handles.length) continue;
      try {
        const n = await rescoreAuthors(platform, handles);
        scored += n;
        // Un rescore que no puntúa nada teniendo autores es un fallo, no un
        // resultado: el store se traga los errores de lectura y devuelve [].
        if (n === 0) {
          scoreErrors.push(`${platform}: sin puntuar para ${handles.length} autores`);
        }
      } catch (err) {
        scoreErrors.push(`${platform}: ${(err as Error)?.message ?? String(err)}`);
      }
    }
    const scoreError = scoreErrors.length ? scoreErrors.join(" | ") : null;
    if (scoreError) console.warn("[discovery-job] rescore:", scoreError);

    await updateJob(job.id, {
      state: "completed",
      current_label: null,
      finished_at: new Date().toISOString(),
      results,
      // El error del rescore se reporta aunque la corrida se dé por completada:
      // los posts se trajeron bien, lo que falló fue el ranking. Ocultarlo hacía
      // que un `scored: 0` pareciera un resultado normal.
      error: scoreError,
      progress: {
        done: sources.length,
        total: sources.length,
        upserted: totalUpserted,
        hydrated,
        scored,
      },
    });
  } catch (err) {
    await updateJob(job.id, {
      state: "failed",
      error: (err as Error)?.message ?? String(err),
      finished_at: new Date().toISOString(),
      results,
    });
  } finally {
    clearInterval(heartbeat);
  }
}

async function getCancelState(jobId: string): Promise<boolean> {
  const { getJob } = await import("./store");
  const job = await getJob(jobId);
  return Boolean(job?.cancel_requested);
}

/**
 * Arranca una corrida. Devuelve enseguida: el trabajo real corre en background
 * porque una corrida de 10 hashtags con hidratación pasa cualquier timeout de
 * request razonable.
 *
 * Si ya hay una corrida del mismo kind en curso, devuelve esa en vez de lanzar
 * otra (mismo criterio que startOrganicRefreshJob).
 */
export async function startDiscoveryJob(input: {
  requestedBy: string | null;
  sourceIds?: string[];
  options?: DiscoveryOptions;
}): Promise<{ job: RefreshJob; created: boolean }> {
  const existing = await findActiveJob("discovery");
  if (existing) return { job: existing, created: false };

  const options = input.options ?? {};
  const job = await createJob({
    kind: "discovery",
    requestedBy: input.requestedBy,
    options: options as Record<string, unknown>,
    sourceIds: input.sourceIds ?? [],
  });

  setTimeout(() => {
    void runDiscovery(job, options);
  }, 0);

  return { job, created: true };
}
