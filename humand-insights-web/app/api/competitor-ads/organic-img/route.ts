import { getAuthenticatedSession } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy de imágenes de Instagram CDN. Las URLs de cdninstagram.com tienen
// restricción de referrer y expiran, así que las traemos server-side.
function isAllowedHost(host: string): boolean {
  return host.endsWith(".cdninstagram.com") || host === "cdninstagram.com";
}

export async function GET(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const raw = searchParams.get("u");
  if (!raw) return new Response("missing u", { status: 400 });

  let target: URL;
  try {
    target = new URL(raw);
  } catch {
    return new Response("bad url", { status: 400 });
  }

  if (!isAllowedHost(target.hostname)) {
    return new Response("host not allowed", { status: 403 });
  }

  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        "user-agent": "Mozilla/5.0 (compatible; bot)",
        accept: "image/*,*/*",
        referer: "https://www.instagram.com/",
      },
      cache: "no-store",
    });
    if (!upstream.ok) return new Response("upstream error", { status: 502 });

    const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
    const body = await upstream.arrayBuffer();
    return new Response(body, {
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=3600",
      },
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
}
