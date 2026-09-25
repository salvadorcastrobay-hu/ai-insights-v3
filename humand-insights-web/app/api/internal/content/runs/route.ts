import { requireInternalToken } from "@/lib/auth/internal";
import { runVisualAnalysis, runAnalysis, startDiscoveryJob, type DiscoveryOptions } from "@/lib/content/discovery-job";
import { runSynthesis } from "@/lib/content/pipeline";
import type { Platform } from "@/lib/content/scoring";
import { findActiveJob, reapStaleJobs } from "@/lib/content/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// discovery solo dispara y devuelve; analyze corre sincrónico y necesita aire.
export const maxDuration = 300;

type RunBody = {
  kind?: "discovery" | "analyze" | "analyze_visual" | "synthesize";
  sourceIds?: string[];
  options?: DiscoveryOptions;
  /** Solo para kind "analyze". */
  platform?: Platform;
  limit?: number;
  /** Solo para kind "synthesize": regenerar también el calendario. */
  withCalendar?: boolean;
};

export async function POST(request: Request): Promise<Response> {
  const caller = requireInternalToken(request);
  if (caller instanceof Response) return caller;

  if (!process.env.APIFY_API_KEY) {
    return Response.json({ error: "Falta APIFY_API_KEY en el motor." }, { status: 500 });
  }

  const body = (await request.json().catch(() => ({}))) as RunBody;
  const kind = body.kind ?? "discovery";

  if (kind === "analyze") {
    // Corre sincrónico: clasificar N posts es un puñado de llamadas al modelo,
    // no una corrida larga de scraping. Si crece, pasarlo a job como discovery.
    if (!process.env.OPENAI_API_KEY) {
      return Response.json({ error: "Falta OPENAI_API_KEY en el motor." }, { status: 500 });
    }
    const result = await runAnalysis(body.platform ?? "linkedin", body.limit ?? 100);
    return Response.json({ kind, ...result });
  }

  if (kind === "analyze_visual") {
    // Corre sobre el corte superior de cada mercado y una muestra de control
    // del resto, no sobre todo el corpus. `limit` es cuántas imágenes en ESTE
    // request: sincrónico como analyze, y por eso va en tandas chicas.
    const result = await runVisualAnalysis(body.limit ?? 40);
    return Response.json({ kind, ...result });
  }

  if (kind === "synthesize") {
    // Determinística salvo por el calendario, que llama al modelo.
    const withCalendar = body.withCalendar ?? false;
    if (withCalendar && !process.env.OPENAI_API_KEY) {
      return Response.json({ error: "Falta OPENAI_API_KEY en el motor." }, { status: 500 });
    }
    const result = await runSynthesis({ withCalendar });
    return Response.json({ kind, ...result });
  }

  if (kind !== "discovery") {
    return Response.json({ error: `kind no soportado todavía: ${kind}` }, { status: 400 });
  }

  await reapStaleJobs();

  const { job, created } = await startDiscoveryJob({
    requestedBy: caller.actingUser,
    sourceIds: body.sourceIds,
    options: body.options,
  });

  // Si ya había una corrida en curso devolvemos esa, no lanzamos otra.
  return Response.json({ job, created }, { status: created ? 202 : 200 });
}

export async function GET(request: Request): Promise<Response> {
  const caller = requireInternalToken(request);
  if (caller instanceof Response) return caller;

  await reapStaleJobs();
  const active = await findActiveJob("discovery");
  return Response.json({ active });
}
