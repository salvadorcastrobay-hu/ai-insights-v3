import { MONITORED_COMPETITORS } from "@/lib/competitor-ads/config";
import { fetchInstagramPosts, type RawInstagramPost } from "@/lib/competitor-ads/apify";
import { upsertPosts, saveOrganicInsight, type OrganicPost } from "@/lib/competitor-ads/organic-store";
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

function mapPost(raw: RawInstagramPost, competitor: string): OrganicPost {
  const caption = raw.caption ?? null;
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
    display_url: raw.displayUrl ?? null,
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

export async function POST(): Promise<Response> {
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

  for (const c of targets) {
    const handle = c.instagramHandle!;
    const r: Result = { competitor: c.name, handle, fetched: 0, upserted: 0, analyzed: false };
    try {
      const raw = await fetchInstagramPosts(handle, { maxItems: 50 });
      r.fetched = raw.length;
      const posts = raw.map((p) => mapPost(p, c.name));
      r.upserted = await upsertPosts(posts);
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
