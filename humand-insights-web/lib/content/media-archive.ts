/**
 * Guarda los bytes de las imágenes de cada post en nuestro propio storage.
 *
 * POR QUÉ NO ALCANZA UN PROXY: las URLs de los CDN vienen firmadas y el
 * vencimiento viaja adentro de la query string — Instagram en `oe` (hex),
 * LinkedIn en `e` (epoch). Medido sobre las URLs guardadas, Instagram dura 4,4
 * días y LinkedIn 16. Reenviar esa misma URL desde el server devuelve el mismo
 * 403 "URL signature expired", con o sin headers de navegador. Lo único que
 * sobrevive es quedarse con los bytes.
 *
 * Se guardan PATHS, no URLs: la URL firmada del bucket se emite por request y
 * dura una hora. Guardar una URL firmada sería repetir el problema con otro CDN.
 *
 * El bucket es PRIVADO, a diferencia del de los ads. Acá hay fotos de personas
 * identificables y vendemos en Brasil y España: un bucket público convierte una
 * copia interna de análisis en distribución.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "content-media";

/** Arriba de esto no es una foto de post, es otra cosa. */
const MAX_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20_000;

/** Cuántas imágenes por post. La primera es la portada; el resto es el carrusel. */
const MAX_IMAGES_PER_POST = 4;

export type ArchivablePost = {
  id: string;
  platform: string;
  post_id: string;
  display_url: string | null;
  media: { images?: string[]; videos?: string[] } | null;
};

export type ArchiveResult = {
  postId: string;
  storedMedia: { images: string[]; videos: string[] } | null;
  error: string | null;
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

function extension(contentType: string | null, url: string): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("gif")) return "gif";
  try {
    const ext = new URL(url).pathname.split(".").pop()?.toLowerCase();
    if (ext && /^(jpg|jpeg|png|webp|gif)$/.test(ext)) return ext;
  } catch {
    /* la URL puede no tener extensión; el default cubre el caso */
  }
  return "jpg";
}

/**
 * El Referer importa: cdninstagram rechaza pedidos sin él aun con la firma
 * vigente. El módulo de ads no lo manda y por eso no se puede reusar tal cual.
 */
function refererFor(platform: string): string {
  return platform === "linkedin"
    ? "https://www.linkedin.com/"
    : "https://www.instagram.com/";
}

async function archiveOne(
  sb: SupabaseClient,
  post: ArchivablePost,
  url: string,
  index: number,
): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: "image/*,*/*",
      referer: refererFor(post.platform),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} al bajar la imagen`);

  const contentType = res.headers.get("content-type") ?? "image/jpeg";
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error("imagen demasiado grande");
  if (bytes.byteLength === 0) throw new Error("respuesta vacía");

  const path = `${post.platform}/${post.post_id}/image-${index}.${extension(contentType, url)}`;
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`storage: ${error.message}`);
  return path;
}

/**
 * Archiva las imágenes de un post. Nunca tira: un CDN caído no puede romper la
 * ingesta, así que el fallo se devuelve para guardarlo en media_archive_error.
 */
export async function archivePostMedia(post: ArchivablePost): Promise<ArchiveResult> {
  const sb = getSupabase();
  if (!sb) {
    return { postId: post.id, storedMedia: null, error: "faltan credenciales de Supabase" };
  }

  // display_url primero: es la portada, la que se ve en la tarjeta.
  const urls = [
    ...(post.display_url ? [post.display_url] : []),
    ...(post.media?.images ?? []),
  ].filter((u, i, all) => all.indexOf(u) === i);

  if (!urls.length) {
    return { postId: post.id, storedMedia: null, error: "el post no tiene imágenes" };
  }

  const images: string[] = [];
  let firstError: string | null = null;
  for (const [index, url] of urls.slice(0, MAX_IMAGES_PER_POST).entries()) {
    try {
      images.push(await archiveOne(sb, post, url, index));
    } catch (err) {
      firstError ??= err instanceof Error ? err.message : String(err);
    }
  }

  if (!images.length) {
    return { postId: post.id, storedMedia: null, error: firstError ?? "no se archivó nada" };
  }
  // Si la portada entró, el post ya es mostrable: un carrusel incompleto no es
  // un fallo que valga reintentar.
  return { postId: post.id, storedMedia: { images, videos: [] }, error: null };
}

/** Emite una URL firmada para servir una imagen archivada. Dura una hora. */
export async function signedMediaUrl(path: string, expiresIn = 3600): Promise<string | null> {
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) return null;
  return data.signedUrl;
}
