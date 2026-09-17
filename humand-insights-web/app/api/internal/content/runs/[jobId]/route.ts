import { requireInternalToken } from "@/lib/auth/internal";
import { getJob, reapStaleJobs } from "@/lib/content/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const caller = requireInternalToken(request);
  if (caller instanceof Response) return caller;

  // Cierra jobs sin heartbeat antes de responder, para que el poller no espere
  // para siempre por una corrida que murió con el proceso.
  await reapStaleJobs();

  const { jobId } = await context.params;
  const job = await getJob(jobId);
  if (!job) return Response.json({ error: "Job no encontrado" }, { status: 404 });

  return Response.json({ job });
}
