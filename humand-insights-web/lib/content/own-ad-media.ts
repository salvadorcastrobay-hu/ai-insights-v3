/**
 * Copia las miniaturas de nuestros anuncios a nuestro storage.
 *
 * Meta devuelve las imágenes de las creatividades como URLs firmadas de su CDN
 * (fbcdn) que vencen a los pocos días: guardadas tal cual, la pantalla de Ads
 * propios muestra tarjetas vacías al rato (403 "URL signature expired"). Lo
 * único que sobrevive es quedarse con los bytes, igual que con los ads de la
 * competencia (lib/competitor-ads/media-archive.ts).
 *
 * Bucket público, como el de los ads de la competencia: son nuestras propias
 * piezas de pauta, ya publicadas.
 *
 * El nombre del archivo del CDN es estable entre firmas, así que sirve de
 * clave: una pieza usada en muchos anuncios se baja una sola vez, y en las
 * corridas siguientes solo se chequea que ya esté.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { OwnAdRow } from "./meta";

const BUCKET = "own-ad-media";
const MAX_BYTES = 8 * 1024 * 1024;
const CONCURRENCY = 8;

let bucketReady = false;

async function ensureBucket(sb: SupabaseClient): Promise<boolean> {
  if (bucketReady) return true;
  const { error } = await sb.storage.getBucket(BUCKET);
  if (!error) return (bucketReady = true);
  const created = await sb.storage.createBucket(BUCKET, { public: true, fileSizeLimit: "10MB" });
  if (created.error && !/already exists/i.test(created.error.message)) return false;
  return (bucketReady = true);
}

/** Ruta en el bucket a partir de la URL del CDN, o null si no es del CDN de Meta. */
export function ownAdMediaPath(accountId: string, url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(fbcdn\.net|facebook\.com|cdninstagram\.com)$/.test(u.hostname)) return null;
    const file = u.pathname.split("/").pop();
    if (!file || !/^[\w.-]+$/.test(file)) return null;
    return `${accountId}/${file}`;
  } catch {
    return null;
  }
}

async function archiveOne(sb: SupabaseClient, path: string, url: string): Promise<string | null> {
  const publicUrl = sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  const head = await fetch(publicUrl, { method: "HEAD", cache: "no-store" }).catch(() => null);
  if (head?.ok) return publicUrl;

  const res = await fetch(url, { headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*" }, cache: "no-store" });
  if (!res.ok) return null;
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return null;
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: res.headers.get("content-type") ?? "image/jpeg",
    upsert: true,
  });
  return error ? null : publicUrl;
}

/**
 * Reemplaza thumbnail_url de cada fila por la copia en nuestro storage. Si una
 * copia falla, la fila queda con la URL de Meta (anda unos días y la pantalla
 * degrada a la tarjeta de texto).
 */
export async function archiveOwnAdThumbnails(sb: SupabaseClient, rows: OwnAdRow[]): Promise<{ archived: number; failed: number }> {
  if (!(await ensureBucket(sb))) return { archived: 0, failed: rows.length };
  const byPath = new Map<string, string>();
  for (const r of rows) {
    const path = r.thumbnail_url ? ownAdMediaPath(r.ad_account_id, r.thumbnail_url) : null;
    if (path && !byPath.has(path)) byPath.set(path, r.thumbnail_url!);
  }

  const stored = new Map<string, string>();
  const queue = [...byPath.entries()];
  let failed = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [path, url] = next;
        const publicUrl = await archiveOne(sb, path, url).catch(() => null);
        if (publicUrl) stored.set(path, publicUrl);
        else failed += 1;
      }
    }),
  );

  for (const r of rows) {
    const path = r.thumbnail_url ? ownAdMediaPath(r.ad_account_id, r.thumbnail_url) : null;
    const own = path ? stored.get(path) : undefined;
    if (own) r.thumbnail_url = own;
  }
  return { archived: stored.size, failed };
}
