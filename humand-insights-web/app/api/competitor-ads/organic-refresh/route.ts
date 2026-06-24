import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { startOrganicRefreshJob } from "@/lib/competitor-ads/organic-refresh-job";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) {
    return Response.json({ error: "Solo admin puede refrescar." }, { status: 403 });
  }

  if (!process.env.APIFY_API_KEY) {
    return Response.json({ error: "Falta APIFY_API_KEY en el entorno." }, { status: 500 });
  }

  const params = new URL(request.url).searchParams;
  const job = startOrganicRefreshJob({
    maxItems: Number(params.get("maxItems") ?? "50"),
    maxAnalyze: Number(params.get("maxAnalyze") ?? "200"),
    maxArchivePosts: Number(params.get("maxArchivePosts") ?? "25"),
    archiveVideos: params.get("archiveVideos") === "1",
  });

  return Response.json({ job }, { status: 202 });
}
