import { requireInternalToken } from "@/lib/auth/internal";
import { reapStaleJobs } from "@/lib/content/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const caller = requireInternalToken(request);
  if (caller instanceof Response) return caller;

  // Aprovecha el health check para cerrar jobs huérfanos de un redeploy.
  const reaped = await reapStaleJobs();

  return Response.json({
    ok: true,
    apify: Boolean(process.env.APIFY_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    supabase: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    staleJobsReaped: reaped,
  });
}
