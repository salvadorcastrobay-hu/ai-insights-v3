/**
 * Rescate de los posts de Instagram cuya URL de imagen ya venció.
 *
 * Operación de una sola vez. Las URLs de cdninstagram duran 4,4 días y estos
 * posts se ingestaron antes de que existiera el archivado, así que la firma se
 * murió y no hay forma de recuperar los bytes sin volver a pedirle el post al
 * scraper.
 *
 * CUESTA PLATA: el actor cobra por resultado. No correrlo en loop ni como
 * mantenimiento — para eso está el archivado en la ingesta, que hace que esto
 * no vuelva a hacer falta.
 *
 * Uso:
 *   npx tsx scripts/rescue-expired-instagram.ts --dry-run
 *   npx tsx scripts/rescue-expired-instagram.ts --limit 10
 *   npx tsx scripts/rescue-expired-instagram.ts
 */
import { createClient } from "@supabase/supabase-js";

import { archivePostMedia } from "../lib/content/media-archive";

const ACTOR = "apify~instagram-scraper";
const APIFY = "https://api.apify.com/v2";

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan credenciales de Supabase.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function apifyKey(): string {
  const key = process.env.APIFY_API_KEY ?? process.env.APIFY_TOKEN;
  if (!key) throw new Error("Falta APIFY_API_KEY.");
  return key;
}

async function runActor(urls: string[]): Promise<Array<Record<string, unknown>>> {
  const key = apifyKey();
  const start = await fetch(`${APIFY}/acts/${ACTOR}/runs?token=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      directUrls: urls,
      resultsType: "posts",
      resultsLimit: urls.length,
      addParentData: false,
    }),
  });
  if (!start.ok) throw new Error(`Apify ${start.status}: ${await start.text()}`);
  const runId = (await start.json()).data.id as string;

  // Poll hasta que termine. El actor tarda ~1-3 min para este volumen.
  for (let i = 0; i < 120; i += 1) {
    await new Promise((r) => setTimeout(r, 5000));
    const res = await fetch(`${APIFY}/actor-runs/${runId}?token=${key}`);
    const run = (await res.json()).data;
    if (run.status === "SUCCEEDED") {
      const items = await fetch(
        `${APIFY}/datasets/${run.defaultDatasetId}/items?token=${key}&clean=true`,
      );
      return await items.json();
    }
    if (["FAILED", "ABORTED", "TIMED-OUT"].includes(run.status)) {
      throw new Error(`el run terminó en ${run.status}`);
    }
  }
  throw new Error("el run no terminó a tiempo");
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const limitArg = process.argv.indexOf("--limit");
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 250;

  const client = sb();
  const { data, error } = await client
    .from("content_posts")
    .select("id, platform, post_id, post_url, display_url, media")
    .eq("platform", "instagram")
    .not("media_archive_error", "is", null)
    .is("stored_media", null)
    .not("post_url", "is", null)
    .limit(limit);
  if (error) throw error;

  const posts = (data ?? []) as Array<{
    id: string;
    platform: string;
    post_id: string;
    post_url: string;
    display_url: string | null;
    media: { images?: string[]; videos?: string[] } | null;
  }>;

  console.log(`posts a rescatar: ${posts.length}`);
  if (dryRun || !posts.length) {
    console.log("(dry-run — no se llama a Apify)");
    return;
  }

  console.log("pidiendo los posts de nuevo a Apify…");
  const items = await runActor(posts.map((p) => p.post_url));
  console.log(`el actor devolvió ${items.length} items`);

  // El actor identifica por shortCode, que es nuestro post_id.
  const byShortcode = new Map(
    items
      .filter((i) => typeof i.shortCode === "string")
      .map((i) => [i.shortCode as string, i]),
  );

  let ok = 0;
  let sinItem = 0;
  let fallado = 0;

  for (const post of posts) {
    const item = byShortcode.get(post.post_id);
    if (!item) {
      sinItem += 1;
      continue;
    }
    const images = [
      ...(typeof item.displayUrl === "string" ? [item.displayUrl] : []),
      ...(Array.isArray(item.images) ? (item.images as string[]) : []),
    ];
    if (!images.length) {
      sinItem += 1;
      continue;
    }

    const result = await archivePostMedia({
      id: post.id,
      platform: post.platform,
      post_id: post.post_id,
      display_url: images[0],
      media: { images, videos: [] },
    });

    await client
      .from("content_posts")
      .update({
        display_url: images[0],
        media: { images, videos: [] },
        stored_media: result.storedMedia,
        media_archived_at: new Date().toISOString(),
        media_archive_error: result.error,
      })
      .eq("id", post.id);

    if (result.storedMedia) ok += 1;
    else fallado += 1;
  }

  console.log(`\n✓ rescatados ${ok} · sin item en la respuesta ${sinItem} · fallaron ${fallado}`);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
