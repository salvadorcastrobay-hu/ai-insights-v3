import { isAdmin, type AppRole } from "@/lib/auth/roles";
import { getOrganicRefreshJob } from "@/lib/competitor-ads/organic-refresh-job";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 10;

export async function GET(request: Request): Promise<Response> {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const roles = await getServerUserRoles();
  if (!isAdmin(roles as AppRole[])) {
    return Response.json({ error: "Solo admin puede ver el estado." }, { status: 403 });
  }

  const jobId = new URL(request.url).searchParams.get("jobId");
  const job = getOrganicRefreshJob(jobId);
  if (!job) return Response.json({ error: "No hay refresh orgánico en curso." }, { status: 404 });
  return Response.json({ job });
}
