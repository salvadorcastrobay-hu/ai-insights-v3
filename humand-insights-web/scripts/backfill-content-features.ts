/**
 * Completa lo nuevo sobre los posts ya ingestados. Corre una vez; de acá en
 * adelante lo hace el propio job de discovery.
 *
 * Tres pasos, cada uno con su flag, y en este orden porque cada uno usa lo del
 * anterior:
 *
 *   --features     calcula `features` y corrige `format` de LinkedIn. Gratis.
 *   --reclassify   ARCHIVA el análisis actual en content_posts_analysis_archive
 *                  y reclasifica con el prompt nuevo (cta_type, timeliness,
 *                  caption con cabeza y cola). ~USD 0,50 con gpt-4o-mini.
 *   --refocus      corre SOLO la pasada enfocada (cta, cta_type, timeliness)
 *                  sobre lo ya clasificado y parchea esos tres campos. No toca
 *                  claims ni el resto: es para cuando cambia solo esa pasada.
 *   --rescore      recalcula el ranking: los collabs salen de la mediana y los
 *                  lead magnets pierden el debate_factor.
 *
 * Uso:
 *   npx tsx scripts/backfill-content-features.ts --features --dry-run
 *   npx tsx scripts/backfill-content-features.ts --features --reclassify --rescore
 *   npx tsx scripts/backfill-content-features.ts --reclassify --limit 30
 *   npx tsx scripts/backfill-content-features.ts --reclassify --retry-missing-cta
 *   npx tsx scripts/backfill-content-features.ts --reclassify --language-mismatch
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { ANALYSIS_VERSION, classifyCtas, classifyPosts } from "../lib/content/classify";
import { rescoreAuthors } from "../lib/content/discovery-job";
import { computeFeatures, detectLanguage, linkedInFormat } from "../lib/content/post-features";
import type { Platform } from "../lib/content/scoring";
import { savePostAnalyses } from "../lib/content/store";

const PAGE = 200;
/** Lotes del clasificador en paralelo. Más que esto y aparecen los 429. */
const CONCURRENCY = 3;

function sb(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

type Row = {
  id: string;
  platform: string;
  post_id: string;
  author_handle: string;
  caption: string | null;
  format: string | null;
  media: { images: string[]; videos: string[] } | null;
  posted_at: string | null;
  duration_secs: number | null;
  is_paid_partnership: boolean | null;
  mentions: string[] | null;
  reactions: unknown;
  hashtags: string[] | null;
  likes_count: number | null;
  comments_count: number | null;
  viral_score: number | null;
  analysis: unknown | null;
  analysis_model: string | null;
  analysis_version: string | null;
  analyzed_at: string | null;
  raw: unknown;
};

async function loadAll(client: SupabaseClient): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from("content_posts")
      .select(
        "id, platform, post_id, author_handle, caption, format, media, posted_at, duration_secs, " +
          "is_paid_partnership, mentions, reactions, hashtags, likes_count, comments_count, " +
          "viral_score, analysis, analysis_model, analysis_version, analyzed_at, raw",
      )
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as unknown as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function loadRegions(client: SupabaseClient): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("content_post_sources")
      .select("post_id, region")
      .range(from, from + 999);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ post_id: string; region: string | null }>) {
      if (row.region && !out.has(row.post_id)) out.set(row.post_id, row.region);
    }
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++];
        await fn(item);
      }
    }),
  );
}

async function backfillFeatures(client: SupabaseClient, rows: Row[], dryRun: boolean) {
  const regions = await loadRegions(client);
  let formatFixes = 0;
  const tally = new Map<string, number>();

  await pool(rows, 8, async (row) => {
    const format = row.platform === "linkedin" ? linkedInFormat(row.raw) : row.format;
    const features = computeFeatures({ ...row, format }, regions.get(row.id) ?? null);
    tally.set(features.format_detail, (tally.get(features.format_detail) ?? 0) + 1);
    if (format !== row.format) formatFixes += 1;
    if (dryRun) return;
    const { error } = await client
      .from("content_posts")
      .update({ features, format })
      .eq("id", row.id);
    if (error) throw error;
  });

  console.log(`features: ${rows.length} posts · format corregido en ${formatFixes}`);
  console.log("  format_detail:", Object.fromEntries([...tally].sort((a, b) => b[1] - a[1])));
}

async function reclassify(
  client: SupabaseClient,
  rows: Row[],
  dryRun: boolean,
  limit: number,
  retryMissingCta = false,
  languageMismatch = false,
) {
  // Mismo universo que el job semanal: lo puntuado. Lo que no tiene score no
  // se clasifica nunca, así que tampoco se reclasifica.
  const targets = rows
    .filter(
      (r) =>
        r.viral_score !== null &&
        (r.analysis_version !== ANALYSIS_VERSION ||
          // Una pasada de CTA que falló deja la fila en la versión nueva pero
          // sin cta_type: se reintenta.
          (retryMissingCta && !(r.analysis as { cta_type?: string } | null)?.cta_type)),
    )
    // Con --language-mismatch solo entran los posts cuyo claim quedó en otro
    // idioma que el post: reclasificar todo para arreglar eso sería pagar mil
    // posts por cien.
    .filter((r) => {
      if (!languageMismatch) return true;
      const claim = (r.analysis as { claim?: string | null } | null)?.claim;
      const post = detectLanguage(r.caption);
      const said = detectLanguage(claim);
      return Boolean(post && said && post !== said);
    })
    .sort((a, b) => (b.viral_score ?? 0) - (a.viral_score ?? 0))
    .slice(0, limit);
  console.log(`reclasificar: ${targets.length} posts (versión ${ANALYSIS_VERSION})`);
  if (dryRun || !targets.length) return;
  // Sin key el clasificador no tira: loguea y sigue, así que se archivaría todo
  // para no reemplazar nada.
  if (!process.env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY.");

  // Primero se archiva TODO lo que se va a pisar, y recién después se pisa: si
  // la corrida se corta a la mitad, lo archivado es un superconjunto de lo
  // reemplazado, nunca al revés.
  //
  // Idempotente: un análisis ya archivado (mismo post, misma fecha) no se
  // vuelve a copiar si la corrida se relanza.
  const archived = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from("content_posts_analysis_archive")
      .select("platform, post_id, analyzed_at")
      .range(from, from + 999);
    if (error) throw error;
    for (const a of (data ?? []) as Array<{ platform: string; post_id: string; analyzed_at: string | null }>) {
      archived.add(`${a.platform}|${a.post_id}|${a.analyzed_at ? Date.parse(a.analyzed_at) : ""}`);
    }
    if (!data || data.length < 1000) break;
  }
  const toArchive = targets.filter(
    (r) =>
      r.analysis &&
      !archived.has(`${r.platform}|${r.post_id}|${r.analyzed_at ? Date.parse(r.analyzed_at) : ""}`),
  );
  for (let i = 0; i < toArchive.length; i += 200) {
    const { error } = await client.from("content_posts_analysis_archive").insert(
      toArchive.slice(i, i + 200).map((r) => ({
        platform: r.platform,
        post_id: r.post_id,
        analysis: r.analysis,
        analysis_model: r.analysis_model,
        analysis_version: r.analysis_version,
        analyzed_at: r.analyzed_at,
        reason: `reclasificación a ${ANALYSIS_VERSION}`,
      })),
    );
    if (error) throw error;
  }
  console.log(`  archivados ${toArchive.length} análisis anteriores`);

  const model = process.env.CONTENT_ANALYSIS_MODEL ?? process.env.COMPETITOR_ADS_MODEL ?? "gpt-4o-mini";
  const chunks: Row[][] = [];
  for (let i = 0; i < targets.length; i += 20) chunks.push(targets.slice(i, i + 20));

  let done = 0;
  let saved = 0;
  await pool(chunks, CONCURRENCY, async (chunk) => {
    const analyses = await classifyPosts(
      chunk.map((p) => ({
        post_id: p.post_id,
        caption: p.caption,
        comment_bait: computeFeatures(p, null).comment_bait,
        language: computeFeatures(p, null).language,
        hashtags: p.hashtags ?? [],
        format: p.format,
        author_label: p.author_handle,
        likes_count: p.likes_count,
        comments_count: p.comments_count,
      })),
    );
    for (const platform of ["linkedin", "instagram"]) {
      const rowsFor = chunk
        .filter((p) => p.platform === platform && analyses.has(p.post_id))
        .map((p) => ({ post_id: p.post_id, analysis: analyses.get(p.post_id) }));
      // No `saved += await …`: eso lee `saved` antes del await, y con lotes en
      // paralelo pisa las sumas de los otros.
      const n = await savePostAnalyses(platform, rowsFor, model);
      saved += n;
    }
    done += chunk.length;
    console.log(`  ${done}/${targets.length} · guardados ${saved}`);
  });
  console.log(`reclasificados ${saved} de ${targets.length}`);
}

async function refocus(client: SupabaseClient, rows: Row[], dryRun: boolean, limit: number) {
  const targets = rows
    .filter((r) => r.analysis && r.viral_score !== null && r.analysis_version !== ANALYSIS_VERSION)
    .slice(0, limit);
  console.log(`pasada enfocada: ${targets.length} posts (versión ${ANALYSIS_VERSION})`);
  if (dryRun || !targets.length) return;
  if (!process.env.OPENAI_API_KEY) throw new Error("Falta OPENAI_API_KEY.");

  for (let i = 0; i < targets.length; i += 200) {
    const { error } = await client.from("content_posts_analysis_archive").insert(
      targets.slice(i, i + 200).map((r) => ({
        platform: r.platform,
        post_id: r.post_id,
        analysis: r.analysis,
        analysis_model: r.analysis_model,
        analysis_version: r.analysis_version,
        analyzed_at: r.analyzed_at,
        reason: `pasada enfocada ${ANALYSIS_VERSION}`,
      })),
    );
    if (error) throw error;
  }

  const chunks: Row[][] = [];
  for (let i = 0; i < targets.length; i += 45) chunks.push(targets.slice(i, i + 45));
  let patched = 0;
  await pool(chunks, CONCURRENCY, async (chunk) => {
    const found = await classifyCtas(chunk.map((r) => ({ post_id: r.post_id, caption: r.caption })));
    for (const r of chunk) {
      const f = found.get(r.post_id);
      if (!f) continue;
      const analysis = {
        ...(r.analysis as Record<string, unknown>),
        cta: f.cta,
        cta_type: computeFeatures(r, null).comment_bait ? "comentar_palabra_clave" : f.cta_type,
        timeliness: f.timeliness,
      };
      const { error } = await client
        .from("content_posts")
        .update({ analysis, analysis_version: ANALYSIS_VERSION })
        .eq("id", r.id);
      if (error) throw error;
      patched += 1;
    }
    console.log(`  ${patched}/${targets.length}`);
  });
  console.log(`parcheados ${patched} de ${targets.length}`);
}

async function rescore(rows: Row[]) {
  for (const platform of ["instagram", "linkedin"] as Platform[]) {
    const handles = [...new Set(rows.filter((r) => r.platform === platform).map((r) => r.author_handle))];
    const n = await rescoreAuthors(platform, handles);
    console.log(`rescore ${platform}: ${n} posts de ${handles.length} autores`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitArg = args.indexOf("--limit");
  const limit = limitArg >= 0 ? Number(args[limitArg + 1]) : Infinity;

  const client = sb();
  const rows = await loadAll(client);
  console.log(`${rows.length} posts${dryRun ? " (dry-run)" : ""}`);

  if (args.includes("--features")) await backfillFeatures(client, rows, dryRun);
  if (args.includes("--reclassify")) {
    await reclassify(
      client,
      rows,
      dryRun,
      limit,
      args.includes("--retry-missing-cta"),
      args.includes("--language-mismatch"),
    );
  }
  if (args.includes("--refocus")) await refocus(client, rows, dryRun, limit);
  if (args.includes("--rescore") && !dryRun) await rescore(rows);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
