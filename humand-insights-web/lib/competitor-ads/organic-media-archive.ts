import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { OrganicPost } from "./organic-store";

const BUCKET = "competitor-organic-media";

type OrganicMedia = OrganicPost["media"];
type MediaKind = "images" | "videos";

let bucketReady = false;

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function ensureBucket(sb: SupabaseClient): Promise<boolean> {
  if (bucketReady) return true;
  const { error } = await sb.storage.getBucket(BUCKET);
  if (!error) {
    bucketReady = true;
    return true;
  }
  const created = await sb.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "80MB",
  });
  if (created.error) return false;
  bucketReady = true;
  return true;
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function extension(contentType: string | null, url: string, kind: MediaKind): string {
  if (contentType?.includes("png")) return "png";
  if (contentType?.includes("webp")) return "webp";
  if (contentType?.includes("gif")) return "gif";
  if (contentType?.includes("mp4")) return "mp4";
  if (contentType?.includes("quicktime")) return "mov";
  try {
    const pathExt = new URL(url).pathname.split(".").pop()?.toLowerCase();
    if (pathExt && /^[a-z0-9]{2,5}$/.test(pathExt)) return pathExt;
  } catch {
    /* noop */
  }
  return kind === "videos" ? "mp4" : "jpg";
}

function isOwnStorageUrl(url: string): boolean {
  try {
    return new URL(url).pathname.includes(`/storage/v1/object/public/${BUCKET}/`);
  } catch {
    return false;
  }
}

async function archiveUrl(
  sb: SupabaseClient,
  params: {
    competitor: string;
    postId: string;
    kind: MediaKind;
    url: string;
    index: number;
  },
): Promise<string | null> {
  if (isOwnStorageUrl(params.url)) return params.url;
  const res = await fetch(params.url, {
    headers: {
      "user-agent": "Mozilla/5.0",
      accept: params.kind === "videos" ? "video/*,*/*" : "image/*,*/*",
      referer: "https://www.instagram.com/",
    },
    cache: "no-store",
  });
  if (!res.ok) return null;

  const contentType = res.headers.get("content-type") ?? (params.kind === "videos" ? "video/mp4" : "image/jpeg");
  const bytes = await res.arrayBuffer();
  const ext = extension(contentType, params.url, params.kind);
  const objectPath = [
    slug(params.competitor),
    params.postId,
    `${params.kind === "videos" ? "video" : "image"}-${params.index}.${ext}`,
  ].join("/");

  const { error } = await sb.storage.from(BUCKET).upload(objectPath, bytes, {
    contentType,
    upsert: true,
  });
  if (error) return null;
  return sb.storage.from(BUCKET).getPublicUrl(objectPath).data.publicUrl;
}

export async function archiveOrganicPostMedia(post: OrganicPost): Promise<OrganicPost> {
  const sb = getSupabase();
  if (!sb || !(await ensureBucket(sb))) return post;

  const archived: OrganicMedia = { images: [], videos: [] };
  for (const kind of ["images", "videos"] as const) {
    const urls = post.media?.[kind] ?? [];
    for (let index = 0; index < urls.length; index++) {
      const ownUrl = await archiveUrl(sb, {
        competitor: post.competitor,
        postId: post.post_id,
        kind,
        url: urls[index],
        index,
      }).catch(() => null);
      archived[kind].push(ownUrl ?? urls[index]);
    }
  }

  return {
    ...post,
    display_url: archived.images[0] ?? post.display_url,
    media: archived,
  };
}
