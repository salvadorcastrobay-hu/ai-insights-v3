import type { InsightRow } from "@/lib/supabase/types";

export type Aggregation = "count" | "sum" | "mean" | "distinct_count";
export type NameValueDatum = { name: string; value: number };
export type PainPctDatum = { name: string; value: number; pct: number };

function buildDedupKey(row: InsightRow, keys: Array<keyof InsightRow>): string {
  return keys.map((key) => String(row[key] ?? "__null__")).join("::");
}

function toFiniteNumber(value: InsightRow[keyof InsightRow]): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function valueCounts(rows: InsightRow[], col: keyof InsightRow, n: number): NameValueDatum[] {
  const counts = new Map<string, number>();

  for (const row of rows) {
    const value = row[col];
    if (value == null) continue;
    const key = String(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, value]) => ({ name, value }));
}

export function dedupGroupby<T extends keyof InsightRow>(
  rows: InsightRow[],
  dedupCols: T[],
  groupCol: keyof InsightRow,
  agg: Aggregation,
  aggCol?: keyof InsightRow,
  n?: number,
): NameValueDatum[] {
  const deduped = new Map<string, InsightRow>();
  for (const row of rows) {
    deduped.set(buildDedupKey(row, dedupCols), row);
  }

  const valueBuckets = new Map<string, number[]>();
  const distinctBuckets = new Map<string, Set<string>>();

  for (const row of deduped.values()) {
    const groupValue = row[groupCol];
    if (groupValue == null) continue;
    const group = String(groupValue).trim();
    if (!group) continue;

    if (agg === "count") {
      const bucket = valueBuckets.get(group) ?? [];
      bucket.push(1);
      valueBuckets.set(group, bucket);
      continue;
    }

    if (!aggCol) continue;

    if (agg === "distinct_count") {
      const distinctValue = row[aggCol];
      if (distinctValue == null) continue;
      const bucket = distinctBuckets.get(group) ?? new Set<string>();
      bucket.add(String(distinctValue));
      distinctBuckets.set(group, bucket);
      continue;
    }

    const numeric = toFiniteNumber(row[aggCol]);
    if (numeric == null) continue;
    const bucket = valueBuckets.get(group) ?? [];
    bucket.push(numeric);
    valueBuckets.set(group, bucket);
  }

  const result =
    agg === "distinct_count"
      ? [...distinctBuckets.entries()].map(([name, values]) => ({ name, value: values.size }))
      : [...valueBuckets.entries()].map(([name, values]) => ({
          name,
          value:
            agg === "count"
              ? values.length
              : agg === "sum"
                ? values.reduce((sum, item) => sum + item, 0)
                : values.length
                  ? values.reduce((sum, item) => sum + item, 0) / values.length
                  : 0,
        }));

  const sorted = result.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return typeof n === "number" ? sorted.slice(0, n) : sorted;
}

export function uniqueDealsRevenue(rows: InsightRow[]): number {
  const byDeal = new Map<string, number>();
  for (const row of rows) {
    if (row.deal_id && row.amount != null) {
      byDeal.set(row.deal_id, row.amount);
    }
  }
  return [...byDeal.values()].reduce((sum, amount) => sum + amount, 0);
}

export function painsWithPct(
  painRows: InsightRow[],
  n: number,
  totalTranscripts: number,
): PainPctDatum[] {
  const grouped = new Map<string, Set<string>>();

  for (const row of painRows) {
    const label = row.insight_subtype_display || row.insight_subtype;
    if (!label) continue;
    const bucket = grouped.get(label) ?? new Set<string>();
    bucket.add(row.transcript_id);
    grouped.set(label, bucket);
  }

  return [...grouped.entries()]
    .map(([name, transcripts]) => {
      const value = transcripts.size;
      const pct = totalTranscripts > 0 ? (value / totalTranscripts) * 100 : 0;
      return { name, value, pct };
    })
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, n);
}

export function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}
