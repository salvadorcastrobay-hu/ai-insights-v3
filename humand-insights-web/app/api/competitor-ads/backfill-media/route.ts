import { refreshStoredAdMedia } from "@/lib/competitor-ads/media-repair";
import { loadStoredAds } from "@/lib/competitor-ads/store";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function hasMedia(ad: { media?: { images?: string[]; videos?: string[] } | null }): boolean {
  return Boolean((ad.media?.images?.length ?? 0) || (ad.media?.videos?.length ?? 0));
}

export async function POST(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) return new Response("Forbidden", { status: 403 });

  if (!process.env.SCRAPECREATORS_API_KEY) {
    return Response.json({ error: "Falta SCRAPECREATORS_API_KEY en el entorno." }, { status: 500 });
  }

  const params = new URL(request.url).searchParams;
  const limit = Math.min(50, Math.max(1, Number(params.get("limit") ?? "20")));
  const all = await loadStoredAds();
  const targets = all.filter((ad) => !hasMedia(ad)).slice(0, limit);

  const results: Array<{ ad_archive_id: string; ok: boolean; images?: number; videos?: number; error?: string }> = [];
  for (const ad of targets) {
    try {
      const media = await refreshStoredAdMedia(ad.ad_archive_id);
      results.push({
        ad_archive_id: ad.ad_archive_id,
        ok: Boolean(media && hasMedia({ media })),
        images: media?.images.length ?? 0,
        videos: media?.videos.length ?? 0,
      });
    } catch (e) {
      results.push({
        ad_archive_id: ad.ad_archive_id,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return Response.json({
    checked: targets.length,
    remaining_empty_media: Math.max(0, all.filter((ad) => !hasMedia(ad)).length - targets.length),
    results,
  });
}

export const GET = POST;
