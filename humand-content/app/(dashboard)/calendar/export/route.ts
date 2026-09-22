/**
 * Descarga el calendario de un mercado como CSV.
 *
 * Sofía no trabaja dentro de esta app: arma el mes acá y lo lleva a donde lo
 * ejecuta. Un calendario que no se puede sacar de la herramienta obliga a
 * copiar trece piezas a mano, que es exactamente el trabajo manual que esto
 * venía a sacar.
 */
import { loadCalendars, loadFeedback, suggestionKey } from "@/lib/content/queries";
import { regionLabel } from "@/lib/content/types";

export const dynamic = "force-dynamic";

const COLUMNS = [
  "fecha",
  "mercado",
  "titulo",
  "hook",
  "angulo",
  "patron",
  "tema",
  "formato",
  "cta",
  "estado",
  "se_apoya_en",
  "evidencia",
];

const STATE_LABELS: Record<string, string> = {
  pending: "sin revisar",
  approved_as_is: "aprobada",
  approved_edited: "aprobada con cambios",
  rejected: "descartada",
  published: "publicada",
};

/**
 * Excel rompe un CSV si una celda con coma o salto de línea no viene entre
 * comillas, y rompe las comillas internas si no se duplican.
 */
function cell(value: unknown): string {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(request: Request): Promise<Response> {
  const region = new URL(request.url).searchParams.get("region");

  const [calendars, feedback] = await Promise.all([
    loadCalendars(),
    loadFeedback().catch(() => new Map()),
  ]);

  const selected = region ? calendars.filter((c) => c.region === region) : calendars;
  if (!selected.length) return new Response("No hay calendario para exportar.", { status: 404 });

  const rows = [COLUMNS.join(",")];
  for (const cal of selected) {
    for (const entry of cal.entries) {
      const state =
        feedback.get(suggestionKey(cal.region, cal.month, entry.date, entry.title))?.state ??
        "pending";
      rows.push(
        [
          entry.date,
          regionLabel(cal.region),
          entry.title,
          entry.hook,
          entry.angle,
          entry.hook_pattern.replace(/_/g, " "),
          entry.theme.replace(/_/g, " "),
          entry.format,
          entry.cta ?? "",
          STATE_LABELS[state] ?? state,
          entry.based_on,
          (entry.evidence_links ?? []).map((e) => e.post_url).join(" "),
        ]
          .map(cell)
          .join(","),
      );
    }
  }

  const month = selected[0].month;
  const name = region ? `calendario-${region}-${month}.csv` : `calendario-${month}.csv`;

  return new Response(
    // BOM al principio: sin esto Excel abre los acentos como basura.
    "﻿" + rows.join("\n"),
    {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}"`,
      },
    },
  );
}
