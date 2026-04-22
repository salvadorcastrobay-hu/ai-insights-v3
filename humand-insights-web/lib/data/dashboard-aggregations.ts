import type { InsightRow } from "@/lib/supabase/types";

export function distinctCount(rows: InsightRow[], key: keyof InsightRow): number {
  return new Set(rows.map((row) => row[key]).filter(Boolean)).size;
}

export function groupDistinctTranscripts(
  rows: InsightRow[],
  key: keyof InsightRow,
  topN?: number,
): Array<{ name: string; value: number }> {
  const grouped = new Map<string, Set<string>>();

  for (const row of rows) {
    const name = String(row[key] ?? "").trim();
    if (!name) continue;
    const bucket = grouped.get(name) ?? new Set<string>();
    bucket.add(row.transcript_id);
    grouped.set(name, bucket);
  }

  const data = [...grouped.entries()]
    .map(([name, set]) => ({ name, value: set.size }))
    .sort((a, b) => b.value - a.value);

  return typeof topN === "number" ? data.slice(0, topN) : data;
}

export function stackBy(
  rows: InsightRow[],
  yKey: keyof InsightRow,
  stackKey: keyof InsightRow,
  topN = 10,
  topStackN = 8,
): { data: Array<Record<string, string | number>>; stackKeys: string[] } {
  const yOrder = groupDistinctTranscripts(rows, yKey, topN).map((row) => row.name);
  const matrix = new Map<string, Record<string, string | number>>();

  for (const y of yOrder) {
    matrix.set(y, { name: y });
  }

  // First pass: total counts per stack value to pick the top-N stacks globally.
  // Without this cap the legend balloons to every distinct industry/segment/etc.
  const stackTotals = new Map<string, number>();
  for (const row of rows) {
    const y = String(row[yKey] ?? "").trim();
    const stackRaw = String(row[stackKey] ?? "").trim();
    if (!y || !stackRaw || !matrix.has(y)) continue;
    stackTotals.set(stackRaw, (stackTotals.get(stackRaw) ?? 0) + 1);
  }

  const topStacks = [...stackTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topStackN)
    .map(([name]) => name);
  const topStacksSet = new Set(topStacks);
  const OTHER_LABEL = "Otros";
  const hasOther = stackTotals.size > topStacks.length;

  // Second pass: fold everything not in top-N into an "Otros" bucket.
  for (const row of rows) {
    const y = String(row[yKey] ?? "").trim();
    const stackRaw = String(row[stackKey] ?? "").trim();
    if (!y || !stackRaw || !matrix.has(y)) continue;

    const record = matrix.get(y)!;
    const bucket = topStacksSet.has(stackRaw) ? stackRaw : OTHER_LABEL;
    record[bucket] = Number(record[bucket] ?? 0) + 1;
  }

  const stackKeys = hasOther ? [...topStacks, OTHER_LABEL] : topStacks;
  return { data: yOrder.map((y) => matrix.get(y) ?? { name: y }), stackKeys };
}

export function buildHeatMap(
  rows: InsightRow[],
  rowKey: keyof InsightRow,
  colKey: keyof InsightRow,
  topRows = 15,
  topCols = 10,
): { rowLabels: string[]; colLabels: string[]; values: number[][] } {
  const rowOrder = groupDistinctTranscripts(rows, rowKey, topRows).map((r) => r.name);
  const colOrder = groupDistinctTranscripts(rows, colKey, topCols).map((r) => r.name);

  const values = rowOrder.map((rowName) =>
    colOrder.map((colName) => {
      const set = new Set<string>();
      for (const row of rows) {
        if (String(row[rowKey] ?? "") === rowName && String(row[colKey] ?? "") === colName) {
          set.add(row.transcript_id);
        }
      }
      return set.size;
    }),
  );

  return {
    rowLabels: rowOrder,
    colLabels: colOrder,
    values,
  };
}

export function monthlyInsightTrend(rows: InsightRow[]) {
  const map = new Map<string, Record<string, string | number>>();

  for (const row of rows) {
    if (!row.call_date) continue;
    const month = row.call_date.slice(0, 7);
    const type = row.insight_type_display;
    const key = `${month}`;
    const rec = map.get(key) ?? { month };
    rec[type] = Number(rec[type] ?? 0) + 1;
    map.set(key, rec);
  }

  return [...map.values()].sort((a, b) => String(a.month).localeCompare(String(b.month)));
}

export function topBreakdowns(
  rows: InsightRow[],
  primaryKey: keyof InsightRow,
  breakdownKey: keyof InsightRow,
  topPrimary = 2,
): Array<{ name: string; data: Array<{ name: string; value: number }> }> {
  const primary = groupDistinctTranscripts(rows, primaryKey, topPrimary);

  return primary.map((item) => {
    const subset = rows.filter((row) => String(row[primaryKey] ?? "") === item.name);
    return {
      name: item.name,
      data: groupDistinctTranscripts(subset, breakdownKey, 6),
    };
  });
}

export function filterByType(rows: InsightRow[], type: InsightRow["insight_type"]) {
  return rows.filter((row) => row.insight_type === type);
}
