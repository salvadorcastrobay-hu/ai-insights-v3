import { experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";

import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Intenta transcribir el video en vivo y reporta en qué etapa falla.
async function liveTranscribe(videoUrl: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(videoUrl, {
      headers: { "user-agent": "Mozilla/5.0", accept: "video/*,*/*" },
      cache: "no-store",
    });
  } catch (e) {
    return { stage: "download", ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const meta = { status: res.status, content_type: res.headers.get("content-type"), content_length: res.headers.get("content-length") };
  if (!res.ok) return { stage: "download", ok: false, ...meta };
  const buf = await res.arrayBuffer();
  try {
    const { text } = await transcribe({
      model: openai.transcription(process.env.COMPETITOR_ADS_TRANSCRIBE_MODEL ?? "whisper-1"),
      audio: new Uint8Array(buf),
    });
    return { stage: "done", ok: true, ...meta, bytes: buf.byteLength, text: text.slice(0, 500) };
  } catch (e) {
    return { stage: "transcribe", ok: false, ...meta, bytes: buf.byteLength, error: e instanceof Error ? e.message : String(e) };
  }
}

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
  const extraImages = arr("extra_images");
  const extraVideos = arr("extra_videos");
  return {
    snapshot_keys: Object.keys(snap),
    display_format: snap.display_format ?? null,
    images: { count: images.length, sample: images.slice(0, 1) },
    extra_images: { count: extraImages.length, sample: extraImages.slice(0, 1) },
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
    extra_videos: {
      count: extraVideos.length,
      sample: extraVideos.slice(0, 1).map((v) => {
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
    .select("ad_archive_id, collation_id, display_format, media, raw, competitor, source")
    .eq("ad_archive_id", adId);
  if (error) return Response.json({ error: error.message });
  if (!rows?.length) return Response.json({ error: "ad no encontrado", adId });

  const row = rows[0] as {
    ad_archive_id: string;
    collation_id: string | null;
    display_format: string | null;
    media: unknown;
    raw: unknown;
    competitor: string;
    source: string;
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

  // Lo que quedó guardado del ANÁLISIS para este aviso (incluye creative_text:
  // el texto OCR / la transcripción del audio). Si está, la visión/transcripción
  // corrió OK en el último refresh.
  let insightForAd: unknown = null;
  const { data: ins } = await sb
    .from("competitor_ad_insights")
    .select("payload, generated_at, model")
    .eq("competitor", row.competitor)
    .eq("source", row.source)
    .limit(1);
  if (ins?.length) {
    const payload = (typeof ins[0].payload === "string" ? safeParse(ins[0].payload as string) : ins[0].payload) as
      | { per_ad?: Array<{ ad_archive_id: string; collation_id: string | null; creative_text?: string | null; goal?: string; content_type?: string }> }
      | null;
    const key = row.collation_id ?? row.ad_archive_id;
    const entry = (payload?.per_ad ?? []).find(
      (p) => (p.collation_id ?? p.ad_archive_id) === key,
    );
    insightForAd = {
      generated_at: ins[0].generated_at,
      model: ins[0].model,
      found_in_per_ad: Boolean(entry),
      goal: entry?.goal ?? null,
      content_type: entry?.content_type ?? null,
      creative_text: entry?.creative_text ?? null,
    };
  }

  // ?live=1 → intenta transcribir el video ahora y reporta el error real.
  let live: unknown = null;
  if (new URL(request.url).searchParams.get("live") === "1") {
    const m = (typeof row.media === "string" ? safeParse(row.media as string) : row.media) as
      | { videos?: string[] }
      | null;
    const vurl = m?.videos?.[0];
    live = vurl ? await liveTranscribe(vurl) : { error: "el aviso no tiene video" };
  }

  return Response.json({
    ad_archive_id: row.ad_archive_id,
    collation_id: row.collation_id,
    display_format: row.display_format,
    stored_media: row.media,
    snapshot_summary: summarizeSnapshot(row.raw),
    variants: siblings,
    insight_for_ad: insightForAd,
    live_transcribe: live,
  });
}
