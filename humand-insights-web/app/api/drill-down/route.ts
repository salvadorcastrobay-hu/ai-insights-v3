import { applyFilters, EMPTY_FILTERS, type Filters } from "@/lib/data/filters";
import { loadInsights } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import type { InsightRow } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

// Dimensions we support drilling into.
export type DrillDimension =
  | "pain_theme"
  | "competitor_name"
  | "feature_display"
  | "friction_subtype"
  | "module_display"
  | "insight_subtype_display";

type Body = {
  dimension: DrillDimension;
  value: string;
  filters?: Partial<Filters>;
  // Optional insight_type filter to narrow scope (e.g., only deal_friction rows)
  scopeType?: "pain" | "product_gap" | "competitive_signal" | "deal_friction" | "faq";
};

function topN(
  rows: InsightRow[],
  key: keyof InsightRow,
  n = 10,
): Array<{ name: string; value: number }> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, value]) => ({ name, value }));
}

function uniqueCount(rows: InsightRow[], key: keyof InsightRow): number {
  const s = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v) s.add(String(v));
  }
  return s.size;
}

function revenueSum(rows: InsightRow[]): number {
  const byDeal = new Map<string, number>();
  for (const r of rows) {
    if (r.deal_id && !byDeal.has(r.deal_id)) {
      byDeal.set(r.deal_id, r.amount ?? 0);
    }
  }
  let sum = 0;
  for (const v of byDeal.values()) sum += v;
  return sum;
}

type QuoteRecord = {
  id: string;
  summary: string;
  quote: string | null;
  company: string | null;
  deal_name: string | null;
  deal_id: string | null;
  call_date: string | null;
  segment: string | null;
  region: string | null;
  country: string | null;
  confidence: number | null;
  subtype: string | null;
  amount: number | null;
};

function extractQuotes(rows: InsightRow[], limit = 20): QuoteRecord[] {
  // Prefer rows that have a verbatim quote, sorted by confidence desc, then date desc.
  const withQuote = rows.filter((r) => r.verbatim_quote && r.verbatim_quote.trim().length > 0);
  const ranked = [...withQuote].sort((a, b) => {
    const byConf = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (byConf !== 0) return byConf;
    return (b.call_date ?? "").localeCompare(a.call_date ?? "");
  });
  const fallback = rows.filter((r) => !withQuote.includes(r));
  const combined = [...ranked, ...fallback].slice(0, limit);
  return combined.map((r) => ({
    id: r.id,
    summary: r.summary,
    quote: r.verbatim_quote,
    company: r.company_name,
    deal_name: r.deal_name,
    deal_id: r.deal_id,
    call_date: r.call_date,
    segment: r.segment,
    region: r.region,
    country: r.country,
    confidence: r.confidence,
    subtype: r.insight_subtype_display ?? null,
    amount: r.amount,
  }));
}

// Filter helpers matching each dimension.
function matchDimension(row: InsightRow, dim: DrillDimension, value: string): boolean {
  const norm = (v: unknown) => (v == null ? "" : String(v).trim());
  switch (dim) {
    case "pain_theme":
      return norm(row.pain_theme) === value;
    case "competitor_name":
      return norm(row.competitor_name) === value;
    case "feature_display":
      return norm(row.feature_display) === value;
    case "module_display":
      return norm(row.module_display) === value;
    case "friction_subtype":
      return row.insight_type === "deal_friction" && norm(row.insight_subtype_display) === value;
    case "insight_subtype_display":
      return norm(row.insight_subtype_display) === value;
    default:
      return false;
  }
}

// Which sub-dimension to break down by. Falls back to something reasonable.
function subDimensionFor(dim: DrillDimension): keyof InsightRow {
  switch (dim) {
    case "pain_theme":
      return "insight_subtype_display";
    case "competitor_name":
      return "competitor_relationship_display";
    case "feature_display":
      return "gap_priority";
    case "friction_subtype":
      return "deal_stage";
    case "module_display":
      return "module_status";
    case "insight_subtype_display":
      return "module_display";
    default:
      return "insight_subtype_display";
  }
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  const userRoles = (user.app_metadata?.roles as string[]) ?? [];
  const isAdminUser = userRoles.includes("admin");

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { dimension, value, filters: inFilters, scopeType } = body;
  if (!dimension || !value) {
    return new Response("dimension + value required", { status: 400 });
  }

  const filters: Filters = { ...EMPTY_FILTERS, ...(inFilters ?? {}) };
  const all = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1");
  const filtered = applyFilters(all, filters);

  const scope = scopeType ? filtered.filter((r) => r.insight_type === scopeType) : filtered;
  const matched = scope.filter((r) => matchDimension(r, dimension, value));

  const subKey = subDimensionFor(dimension);
  const subBreakdown = topN(matched, subKey, 10);

  const segmentSplit = topN(matched, "segment", 8);
  const regionSplit = topN(matched, "region", 8);
  const industrySplit = topN(matched, "industry", 8);
  const stageSplit = topN(matched, "deal_stage", 8);

  // Quotes solo se devuelven al cliente si es admin. Para viewers/CA, la
  // tarjeta de drill-down igual muestra counts + breakdowns, pero sin
  // verbatim quotes (data sensible).
  const quotes = isAdminUser ? extractQuotes(matched, 20) : [];

  return Response.json({
    dimension,
    value,
    subDimension: String(subKey),
    totals: {
      insights: matched.length,
      unique_transcripts: uniqueCount(matched, "transcript_id"),
      unique_deals: uniqueCount(matched, "deal_id"),
      revenue_usd: revenueSum(matched),
    },
    subBreakdown,
    segmentSplit,
    regionSplit,
    industrySplit,
    stageSplit,
    quotes,
  });
}
