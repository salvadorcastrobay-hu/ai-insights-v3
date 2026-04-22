import { applyFilters } from "@/lib/data/filters";
import { parseFiltersFromSearchParams } from "@/lib/data/search-params-filters";
import { loadInsights } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { LOAD_DATA_COLUMNS, type InsightRow } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function toCsv(rows: InsightRow[]): string {
  const header = EXPORT_COLUMNS.map(csvEscape).join(",");
  const lines = rows.map((row) =>
    EXPORT_COLUMNS.map((column) => csvEscape((row as Record<string, unknown>)[column])).join(","),
  );
  return [header, ...lines].join("\n");
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) return new Response("Unauthorized", { status: 401 });

  const { searchParams } = new URL(request.url);
  const filters = parseFiltersFromSearchParams(Object.fromEntries(searchParams.entries()));
  const promptVersion = process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0";
  const allRows = await loadInsights(promptVersion);
  const filteredRows = applyFilters(allRows, filters);

  const csv = toCsv(filteredRows);
  const filenameDate = new Date().toISOString().slice(0, 10);
  const filename = `insights-${filenameDate}.csv`;

  return new Response(`\uFEFF${csv}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
