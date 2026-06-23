import { MONITORED_COMPETITORS } from "@/lib/competitor-ads/config";
import { fetchInstagramFeed, type RawInstagramPost } from "@/lib/competitor-ads/apify";
import { archiveOrganicPostMedia } from "@/lib/competitor-ads/organic-media-archive";
import {
  insertMetricSnapshots,
  upsertOrganicProfile,
  upsertPosts,
  saveOrganicInsight,
  type OrganicPost,
} from "@/lib/competitor-ads/organic-store";
import { analyzeOrganic } from "@/lib/competitor-ads/organic-analyze";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function normalizeFormat(type: string | undefined | null): string | null {
  if (!type) return null;
  const t = type.toLowerCase();
  if (t.includes("reel")) return "reel";
  if (t.includes("video")) return "video";
  if (t.includes("sidecar") || t.includes("carousel") || t.includes("album")) return "sidecar";
  if (t.includes("image") || t.includes("photo")) return "image";
  return t;
}

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

function mapPost(raw: RawInstagramPost, competitor: string): OrganicPost {
  const caption = raw.caption ?? null;
  const media = collectMedia(raw);
  return {
    competitor,
    post_id: raw.shortCode ?? raw.id,
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
    is_pinned: Boolean(raw.isPinned),
    is_paid_partnership: Boolean(raw.isPaidPartnership),
    display_url: media.images[0] ?? raw.displayUrl ?? null,
    media,
    recent_comments: (raw.latestComments ?? [])
      .slice(0, 5)
      .map((c) => ({ text: c.text, timestamp: c.timestamp })),
    raw,
  };
}

type Result = {
  competitor: string;
  handle: string;
  fetched: number;
  upserted: number;
  analyzed: boolean;
  error?: string;
  analyzeError?: string;
};

export async function POST(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) {
    return new Response(JSON.stringify({ error: "Solo admin puede refrescar." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  if (!process.env.APIFY_API_KEY) {
    return new Response(JSON.stringify({ error: "Falta APIFY_API_KEY en el entorno." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const targets = MONITORED_COMPETITORS.filter((c) => c.instagramHandle);
  const results: Result[] = [];
  const params = new URL(request.url).searchParams;
  const maxItems = Math.min(100, Math.max(10, Number(params.get("maxItems") ?? "50")));

  for (const c of targets) {
    const handle = c.instagramHandle!;
    const r: Result = { competitor: c.name, handle, fetched: 0, upserted: 0, analyzed: false };
    let profileFollowers: number | null = null;
    try {
      const feed = await fetchInstagramFeed(handle, { maxItems });
      r.fetched = feed.posts.length;
      profileFollowers = feed.profile.followers_count;
      await upsertOrganicProfile({
        competitor: c.name,
        handle: feed.profile.handle,
        is_own_brand: Boolean(c.ownBrand),
        profile_url: feed.profile.profile_url,
        full_name: feed.profile.full_name,
        biography: feed.profile.biography,
        website: feed.profile.website,
        followers_count: feed.profile.followers_count,
        following_count: feed.profile.following_count,
        posts_count: feed.profile.posts_count,
        avatar_url: feed.profile.avatar_url,
        raw: feed.profile.raw,
      });
      const posts = await Promise.all(
        feed.posts.map((p) => archiveOrganicPostMedia(mapPost(p, c.name)).catch(() => mapPost(p, c.name))),
      );
      r.upserted = await upsertPosts(posts);
      await insertMetricSnapshots(posts, profileFollowers).catch((e) =>
        console.warn(`[organic-refresh] snapshots ${c.name} fallaron:`, e),
      );
    } catch (err) {
      r.error = err instanceof Error ? err.message : String(err);
      results.push(r);
      continue;
    }

    try {
      const synthesis = await analyzeOrganic(c.name, { language: c.language });
      if (synthesis) {
        await saveOrganicInsight(c.name, synthesis, "gpt-4o-mini");
        r.analyzed = true;
      } else {
        r.analyzeError = "analyzeOrganic devolvió null";
      }
    } catch (e) {
      r.analyzeError = e instanceof Error ? e.message : String(e);
      console.error(`[organic-refresh] analyze ${c.name} falló:`, e);
    }
    results.push(r);
  }

  const totalUpserted = results.reduce((a, x) => a + x.upserted, 0);
  return new Response(JSON.stringify({ totalUpserted, results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
