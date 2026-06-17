import { getAuthenticatedSession } from "@/lib/supabase/server";
import { refreshStoredAdMedia } from "@/lib/competitor-ads/media-repair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy de video de la Ad Library. Igual que el de imágenes (fbcdn no se puede
// hotlinkear), pero reenvía el header Range para que el <video> pueda hacer
// streaming/seek (los browsers exigen 206 Partial Content para reproducir).
function isAllowedHost(host: string): boolean {
  return host.endsWith(".fbcdn.net") || host.endsWith(".facebook.com");
}

async function fetchVideo(target: URL, range: string | null): Promise<Response | null> {
  try {
    return await fetch(target.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0",
        accept: "video/*,*/*",
        ...(range ? { range } : {}),
      },
      cache: "no-store",
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("u");
  const adArchiveId = searchParams.get("ad");
  if (!raw) return new Response("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }
  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return new Response("host not allowed", { status: 400 });
  }

  const range = request.headers.get("range");
  let upstream = await fetchVideo(target, range);
  if ((!upstream || (upstream.status !== 200 && upstream.status !== 206)) && adArchiveId) {
    const fresh = await refreshStoredAdMedia(adArchiveId).catch(() => null);
    const freshUrl = fresh?.videos?.[0];
    if (freshUrl) {
      const freshTarget = new URL(freshUrl);
      if (freshTarget.protocol === "https:" && isAllowedHost(freshTarget.hostname)) {
        upstream = await fetchVideo(freshTarget, range);
      } else if (freshTarget.protocol === "https:") {
        return Response.redirect(freshUrl, 307);
      }
    }
  }
  if (!upstream) return new Response("fetch failed", { status: 502 });
  if (!upstream.body || (upstream.status !== 200 && upstream.status !== 206)) {
    return new Response("upstream error", { status: 502 });
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
  });
  // Passthrough de los headers de rango para que el seek funcione.
  const contentRange = upstream.headers.get("content-range");
  const contentLength = upstream.headers.get("content-length");
  if (contentRange) headers.set("Content-Range", contentRange);
  if (contentLength) headers.set("Content-Length", contentLength);

  return new Response(upstream.body, { status: upstream.status, headers });
}
