/**
 * Baja y archiva las imágenes de los posts ya ingestados.
 *
 * Corre una sola vez, contra el backlog. De acá en adelante lo hace el propio
 * job de discovery.
 *
 * EL ORDEN IMPORTA Y NO ES POR FECHA: se procesa por vencimiento de la firma.
 * Instagram dura 4,4 días y LinkedIn 16, así que el lote de Instagram del 14/09
 * se muere antes que el de LinkedIn del 14/09 aunque se hayan traído el mismo
 * día. Si el script se corta a la mitad, queremos que lo salvado sea lo que
 * estaba por vencerse.
 *
 * Uso:
 *   npx tsx scripts/backfill-content-media.ts --dry-run
 *   npx tsx scripts/backfill-content-media.ts
 *   npx tsx scripts/backfill-content-media.ts --platform instagram
 */
import { createClient } from "@supabase/supabase-js";

import { archivePostMedia, type ArchivablePost } from "../lib/content/media-archive";

const CONCURRENCY = 5;

/** Instagram vence mucho antes; se procesa primero aunque sea más chico. */
const PLATFORM_ORDER: Record<string, number> = { instagram: 0, linkedin: 1 };

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const platformArg = process.argv[process.argv.indexOf("--platform") + 1];
  const onlyPlatform = process.argv.includes("--platform") ? platformArg : null;

  const client = sb();
  let query = client
    .from("content_posts")
    .select("id, platform, post_id, display_url, media, fetched_at")
    .is("media_archived_at", null)
    .not("display_url", "is", null)
    .limit(2000);
  if (onlyPlatform) query = query.eq("platform", onlyPlatform);

  const { data, error } = await query;
  if (error) throw error;

  const posts = (data ?? []) as Array<ArchivablePost & { fetched_at: string }>;
  posts.sort((a, b) => {
    const byPlatform = (PLATFORM_ORDER[a.platform] ?? 9) - (PLATFORM_ORDER[b.platform] ?? 9);
    if (byPlatform) return byPlatform;
    // Dentro de una plataforma, lo más viejo vence antes.
    return a.fetched_at.localeCompare(b.fetched_at);
  });

  const byBucket = new Map<string, number>();
  for (const p of posts) {
    const k = `${p.platform} ${p.fetched_at.slice(0, 10)}`;
    byBucket.set(k, (byBucket.get(k) ?? 0) + 1);
  }
  console.log(`pendientes: ${posts.length}`);
  for (const [k, n] of byBucket) console.log(`  ${k}: ${n}`);
  if (dryRun) {
    console.log("(dry-run — no se descarga nada)");
    return;
  }

  let ok = 0;
  let failed = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < posts.length) {
      const post = posts[cursor++];
      const result = await archivePostMedia(post).catch((err) => ({
        postId: post.id,
        storedMedia: null,
        error: err instanceof Error ? err.message : String(err),
      }));

      const { error: upErr } = await client
        .from("content_posts")
        .update({
          stored_media: result.storedMedia,
          media_archived_at: new Date().toISOString(),
          media_archive_error: result.error,
        })
        .eq("id", post.id);

      if (result.storedMedia && !upErr) ok += 1;
      else failed += 1;

      const done = ok + failed;
      if (done % 50 === 0) console.log(`  ${done}/${posts.length} · ok ${ok} · fallados ${failed}`);
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`\n✓ archivados ${ok} · fallados ${failed}`);
}

main().catch((err) => {
  console.error("✗", err instanceof Error ? err.message : err);
  process.exit(1);
});
