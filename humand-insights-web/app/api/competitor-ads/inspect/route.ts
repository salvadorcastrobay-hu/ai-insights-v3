import { createClient } from "@supabase/supabase-js";

import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Diagnóstico TEMPORAL: dado ?ad=<ad_archive_id>, devuelve el `raw` crudo que
// guardamos de ScrapeCreators + un resumen de qué creativo trae el snapshot,
// para entender por qué algunas tarjetas quedan sin imagen/video. Admin-only.
function summarizeSnapshot(raw: unknown): unknown {
  const r = (typeof raw === "string" ? safeParse(raw) : raw) as
    | { snapshot?: Record<string, unknown>; display_format?: string }
    | null;
  const snap = (r?.snapshot ?? {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(snap[k]) ? (snap[k] as unknown[]) : []);
  const images = arr("images");
  const videos = arr("videos");
  const cards = arr("cards");
  return {
    snapshot_keys: Object.keys(snap),
    display_format: snap.display_format ?? null,
    images: { count: images.length, sample: images.slice(0, 1) },
    videos: {
      count: videos.length,
      sample: videos.slice(0, 1).map((v) => {
        const o = v as Record<string, unknown>;
        return {
          has_hd: Boolean(o.video_hd_url),
          has_sd: Boolean(o.video_sd_url),
          has_preview: Boolean(o.video_preview_image_url),
        };
      }),
    },
    cards: {
      count: cards.length,
      sample: cards.slice(0, 1).map((c) => {
        const o = c as Record<string, unknown>;
        return {
          has_resized: Boolean(o.resized_image_url),
          has_original: Boolean(o.original_image_url),
          has_video_preview: Boolean(o.video_preview_image_url),
          has_video_hd: Boolean(o.video_hd_url),
        };
      }),
    },
  };
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) return new Response("Forbidden", { status: 403 });

  const adId = new URL(request.url).searchParams.get("ad");
  if (!adId) return new Response("missing ?ad=<ad_archive_id>", { status: 400 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const { data: rows, error } = await sb
    .from("competitor_ads")
    .select("ad_archive_id, collation_id, display_format, media, raw")
    .eq("ad_archive_id", adId);
  if (error) return Response.json({ error: error.message });
  if (!rows?.length) return Response.json({ error: "ad no encontrado", adId });

  const row = rows[0] as {
    ad_archive_id: string;
    collation_id: string | null;
    display_format: string | null;
    media: unknown;
    raw: unknown;
  };

  // Hermanos de la misma campaña (collation) y qué media tiene cada uno.
  let siblings: unknown[] = [];
  if (row.collation_id) {
    const { data: sibs } = await sb
      .from("competitor_ads")
      .select("ad_archive_id, display_format, media")
      .eq("collation_id", row.collation_id);
    siblings = (sibs ?? []).map((s) => {
      const m = (typeof s.media === "string" ? safeParse(s.media as string) : s.media) as
        | { images?: unknown[]; videos?: unknown[] }
        | null;
      return {
        ad_archive_id: s.ad_archive_id,
        display_format: s.display_format,
        images: Array.isArray(m?.images) ? m!.images.length : 0,
        videos: Array.isArray(m?.videos) ? m!.videos.length : 0,
      };
    });
  }

  return Response.json({
    ad_archive_id: row.ad_archive_id,
    collation_id: row.collation_id,
    display_format: row.display_format,
    stored_media: row.media,
    snapshot_summary: summarizeSnapshot(row.raw),
    variants: siblings,
  });
}
