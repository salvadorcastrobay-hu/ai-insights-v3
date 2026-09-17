/**
 * Métricas de éxito — sección 10 del brief.
 *
 * De las cinco que pide, tres son medibles hoy:
 *
 *   1. % de piezas aprobadas sin cambios  → content_suggestion_feedback
 *   2. Cobertura semanal                   → content_coverage_snapshots
 *   4. Performance de lo publicado vs. baseline propio → cruce de la sugerencia
 *      publicada con el post real en content_posts
 *
 * Las otras dos quedan fuera por razones distintas, y conviene tenerlo claro:
 *
 *   3. Tiempo del equipo en research manual — no es observable desde el
 *      sistema. Requiere que alguien lo reporte; medirlo mal sería peor que no
 *      medirlo.
 *   5. Uso del chatbot — no hay chatbot todavía.
 */
import { createHash } from "crypto";

import { getSupabaseAdmin } from "./store";

/**
 * Clave estable de una pieza sugerida.
 *
 * El calendario se regenera cada semana. Esta clave identifica "la pieza del
 * 6 de octubre para Brasil que decía X": si la regeneración produce otro texto
 * para esa fecha, es otra pieza y merece su propio feedback.
 */
export function suggestionKey(
  region: string,
  month: string,
  date: string,
  title: string,
): string {
  return createHash("sha1")
    .update([region, month, date, title.trim().toLowerCase()].join("|"))
    .digest("hex")
    .slice(0, 20);
}

export type ApprovalMetrics = {
  total_decided: number;
  approved_as_is: number;
  approved_edited: number;
  rejected: number;
  published: number;
  /** La métrica principal del brief. null si todavía no se decidió nada. */
  approved_as_is_rate: number | null;
  pending: number;
};

export async function approvalMetrics(): Promise<ApprovalMetrics> {
  const { data, error } = await getSupabaseAdmin()
    .from("content_suggestion_feedback")
    .select("state");
  if (error) throw error;

  const rows = (data ?? []) as Array<{ state: string }>;
  const count = (state: string) => rows.filter((r) => r.state === state).length;

  const asIs = count("approved_as_is");
  const edited = count("approved_edited");
  const rejected = count("rejected");
  const published = count("published");
  // "Publicado" implica que en algún momento se aprobó, así que cuenta como
  // decidido; lo que no cuenta es lo que nadie miró todavía.
  const decided = asIs + edited + rejected + published;

  return {
    total_decided: decided,
    approved_as_is: asIs,
    approved_edited: edited,
    rejected,
    published,
    approved_as_is_rate: decided ? Number((asIs / decided).toFixed(3)) : null,
    pending: count("pending"),
  };
}

export type CoverageSnapshot = {
  week: string;
  platforms_covered: string[];
  sources_total: number;
  sources_ok: number;
  sources_failed: number;
  competitors_covered: number;
  posts_ingested: number;
  posts_analyzed: number;
};

/** Semana ISO, para que dos corridas de la misma semana no dupliquen la foto. */
export function isoWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Jueves de esa semana define el año ISO.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Foto de cobertura de la semana.
 *
 * El brief la pide para saber si el research fue completo o parcial — o sea que
 * lo que importa no es solo cuánto se trajo, sino **qué falló**. Por eso se
 * guardan las fuentes con error, no solo las exitosas.
 */
export async function takeCoverageSnapshot(): Promise<CoverageSnapshot> {
  const sb = getSupabaseAdmin();

  const { data: sources, error: sourcesError } = await sb
    .from("content_sources")
    .select("platform, kind, competitor_name, last_run_status")
    .eq("is_active", true)
    .eq("approval_state", "approved");
  if (sourcesError) throw sourcesError;

  const rows = (sources ?? []) as Array<{
    platform: string;
    kind: string;
    competitor_name: string | null;
    last_run_status: string | null;
  }>;

  const ok = rows.filter((r) => r.last_run_status === "ok");
  const failed = rows.filter((r) => (r.last_run_status ?? "").startsWith("error"));

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [{ count: ingested }, { count: analyzed }] = await Promise.all([
    sb.from("content_posts").select("*", { count: "exact", head: true }).gte("fetched_at", weekAgo),
    sb.from("content_posts").select("*", { count: "exact", head: true }).gte("analyzed_at", weekAgo),
  ]);

  const snapshot: CoverageSnapshot = {
    week: isoWeek(),
    // Solo las redes de las que efectivamente se trajo algo, no las configuradas.
    platforms_covered: [...new Set(ok.map((r) => r.platform))].sort(),
    sources_total: rows.length,
    sources_ok: ok.length,
    sources_failed: failed.length,
    competitors_covered: new Set(
      rows.filter((r) => r.competitor_name && r.last_run_status === "ok").map((r) => r.competitor_name),
    ).size,
    posts_ingested: ingested ?? 0,
    posts_analyzed: analyzed ?? 0,
  };

  const { error } = await sb.from("content_coverage_snapshots").upsert(
    {
      ...snapshot,
      taken_at: new Date().toISOString(),
      detail: {
        by_platform: Object.fromEntries(
          [...new Set(rows.map((r) => r.platform))].map((p) => [
            p,
            {
              total: rows.filter((r) => r.platform === p).length,
              ok: ok.filter((r) => r.platform === p).length,
            },
          ]),
        ),
        failed_sources: failed.length,
      },
    },
    { onConflict: "week" },
  );
  if (error) throw error;

  return snapshot;
}
