import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { filtersToJsonb } from "@/lib/data/rpc";
import { getPg } from "@/lib/supabase/pg";
import { getAuthenticatedSession, getServerUserRoles } from "@/lib/supabase/server";
import { LOAD_DATA_COLUMNS } from "@/lib/supabase/types";
import { canSeeRawQuotes, type AppRole } from "@/lib/auth/roles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const EXPORT_COLUMNS: readonly string[] = [
  ...LOAD_DATA_COLUMNS,
  "deal_source",
  "deal_source_detail",
  "inbound_source",
  "partner_name",
  "acquisition_channel",
  "is_own_brand_competitor",
];

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const normalized = String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (/[",\n]/.test(normalized)) {
    return `"${normalized.replace(/"/g, "\"\"")}"`;
  }
  return normalized;
}

function csvLine(row: Record<string, unknown>, columns: readonly string[]): string {
  return columns.map((c) => csvEscape(row[c])).join(",");
}

export async function GET(request: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const filters = parseFiltersFromSearchParams(Object.fromEntries(searchParams.entries()));
  const userRoles = await getServerUserRoles();

  // Si el user no es admin, dropear verbatim_quote y gap_description.
  // El CSV exporta exactamente lo que ve en UI.
  const exportColumns = canSeeRawQuotes(userRoles as AppRole[])
    ? EXPORT_COLUMNS
    : EXPORT_COLUMNS.filter((c) => c !== "verbatim_quote" && c !== "gap_description");

  // RPC-native + streaming: filtra en Postgres (incl. validadas) y baja las
  // filas con un cursor, sin materializar las ~150K en memoria de Node (evita
  // el OOM que tenía el path viejo con loadInsights).
  const sql = getPg();
  const filterJson = filtersToJsonb(filters);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // BOM + header para que Excel abra con acentos correctos.
      controller.enqueue(encoder.encode(`﻿${exportColumns.map(csvEscape).join(",")}\n`));
      try {
        const cursor = sql`SELECT * FROM rpc_export_insights(${JSON.stringify(
          filterJson,
        )}::jsonb)`.cursor(1000);
        for await (const batch of cursor) {
          let chunk = "";
          for (const row of batch) {
            chunk += csvLine(row as Record<string, unknown>, exportColumns) + "\n";
          }
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      } catch (err) {
        console.error("[export/csv] stream failed:", err);
        controller.error(err);
      }
    },
  });

  const filenameDate = new Date().toISOString().slice(0, 10);
  const filename = `insights-${filenameDate}.csv`;

  return new Response(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
