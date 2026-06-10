import { getAuthenticatedSession } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Proxy de imágenes de la Ad Library. Las URLs de fbcdn no se pueden hotlinkear
// desde otro dominio (Meta bloquea por referer/CORS), así que las traemos
// server-side y las servimos desde nuestro origen. Allowlist de host para
// evitar usarlo como open proxy / SSRF.
function isAllowedHost(host: string): boolean {
  return host.endsWith(".fbcdn.net") || host.endsWith(".facebook.com");
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
  if (target.protocol !== "https:" || !isAllowedHost(target.hostname)) {
    return new Response("host not allowed", { status: 400 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(target.toString(), {
      headers: { "user-agent": "Mozilla/5.0", accept: "image/*,*/*" },
      cache: "no-store",
    });
  } catch {
    return new Response("fetch failed", { status: 502 });
  }
  if (!upstream.ok || !upstream.body) {
    return new Response("upstream error", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      // Las URLs de fbcdn expiran (param oe=) → cache corto en el browser.
      "Cache-Control": "private, max-age=3600",
    },
  });
}
