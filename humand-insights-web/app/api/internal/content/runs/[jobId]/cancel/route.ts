import { requireInternalToken } from "@/lib/auth/internal";
import { getJob, updateJob } from "@/lib/content/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
): Promise<Response> {
  const caller = requireInternalToken(request);
  if (caller instanceof Response) return caller;

  const { jobId } = await context.params;
  const job = await getJob(jobId);
  if (!job) return Response.json({ error: "Job no encontrado" }, { status: 404 });

  // Flag cooperativo: el loop lo chequea entre fuentes. No mata el fetch en
  // curso, así que la corrida termina la fuente actual antes de cortar.
  await updateJob(jobId, { cancel_requested: true });
  return Response.json({ ok: true });
}
