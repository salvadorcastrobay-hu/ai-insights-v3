/**
 * Archiva las imágenes de un lote de posts recién ingestados.
 *
 * Se llama desde el job después de `upsertPosts`, así que las filas ya existen
 * y se resuelven por (platform, post_id) — el id de la DB no lo conoce el
 * mapper.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { archivePostMedia } from "./media-archive";

/** Descargas en paralelo. Bajo a propósito: no queremos parecer un scraper. */
const CONCURRENCY = 4;

type MappedPost = {
  platform: string;
  post_id: string;
  display_url?: string | null;
  media?: { images?: string[]; videos?: string[] } | null;
};

let client: SupabaseClient | undefined;

function getSupabase(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export async function archiveMediaFor(posts: MappedPost[]): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;

  const withImages = posts.filter((p) => p.display_url || p.media?.images?.length);
  if (!withImages.length) return 0;

  const { data, error } = await sb
    .from("content_posts")
    .select("id, platform, post_id, display_url, media")
    .eq("platform", withImages[0].platform)
    .in("post_id", withImages.map((p) => p.post_id))
    .is("media_archived_at", null);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    id: string;
    platform: string;
    post_id: string;
    display_url: string | null;
    media: { images?: string[]; videos?: string[] } | null;
  }>;

  let archived = 0;
  let cursor = 0;

  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      const result = await archivePostMedia(row).catch((err) => ({
        postId: row.id,
        storedMedia: null,
        error: err instanceof Error ? err.message : String(err),
      }));
      await sb!
        .from("content_posts")
        .update({
          stored_media: result.storedMedia,
          media_archived_at: new Date().toISOString(),
          media_archive_error: result.error,
        })
        .eq("id", row.id);
      if (result.storedMedia) archived += 1;
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return archived;
}
