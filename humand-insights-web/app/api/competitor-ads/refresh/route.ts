import { MONITORED_COMPETITORS } from "@/lib/competitor-ads/config";
import { fetchCompanyAds } from "@/lib/competitor-ads/scrapecreators";
import { upsertAds } from "@/lib/competitor-ads/store";
import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Result = { competitor: string; fetched: number; upserted: number; error?: string };

// Corre tasks con un cap de concurrencia (gentil con la API externa).
async function pooled<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift();
      if (item === undefined) break;
      await fn(item);
    }
  });
  await Promise.all(workers);
}

export async function POST(): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) {
    return new Response(JSON.stringify({ error: "Solo admin puede refrescar (consume créditos)." }), {
      status: 403,
      headers: { "content-type": "application/json" },
    });
  }

  if (!process.env.SCRAPECREATORS_API_KEY) {
    return new Response(JSON.stringify({ error: "Falta SCRAPECREATORS_API_KEY en el entorno." }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }

  const results: Result[] = [];
  await pooled(MONITORED_COMPETITORS, 3, async (c) => {
    try {
      const ads = await fetchCompanyAds(c.name, {
        companyName: c.query,
        pageId: c.pageId,
        country: "ALL",
        status: "ACTIVE",
        maxPages: 1,
      });
      const upserted = await upsertAds(ads);
      results.push({ competitor: c.name, fetched: ads.length, upserted });
    } catch (err) {
      results.push({
        competitor: c.name,
        fetched: 0,
        upserted: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  const totalUpserted = results.reduce((a, r) => a + r.upserted, 0);
  return new Response(JSON.stringify({ totalUpserted, results }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
