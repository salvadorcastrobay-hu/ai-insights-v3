/* eslint-disable no-console */
/**
 * QA harness for ask-chart evidence enrichment.
 * Loads insights, runs buildRowEvidence for the top rows of each chart we've
 * wired, and reports failure modes (empty sub-breakdown, thin sub-breakdown,
 * sub labels == parent label, etc.)
 */
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.qa");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
    if (m) process.env[m[1]] ??= m[2] ?? m[3];
  }
}

import { loadInsights } from "../lib/supabase/queries";
import { applyFilters, EMPTY_FILTERS } from "../lib/data/filters";
import type { InsightRow } from "../lib/supabase/types";

type DrillDimension =
  | "pain_theme"
  | "competitor_name"
  | "feature_display"
  | "friction_subtype"
  | "module_display"
  | "insight_subtype_display";

type DrillScope = "pain" | "product_gap" | "competitive_signal" | "deal_friction" | "faq";

function matchDimension(row: InsightRow, dim: DrillDimension, value: string): boolean {
  const norm = (v: unknown) => (v == null ? "" : String(v).trim());
  switch (dim) {
    case "pain_theme": return norm(row.pain_theme) === value;
    case "competitor_name": return norm(row.competitor_name) === value;
    case "feature_display": return norm(row.feature_display) === value;
    case "module_display": return norm(row.module_display) === value;
    case "friction_subtype":
      return row.insight_type === "deal_friction" && norm(row.insight_subtype_display) === value;
    case "insight_subtype_display": return norm(row.insight_subtype_display) === value;
  }
}

function subKeyFor(dim: DrillDimension): keyof InsightRow {
  switch (dim) {
    case "pain_theme": return "insight_subtype_display";
    case "competitor_name": return "competitor_relationship_display";
    case "feature_display": return "gap_priority";
    case "friction_subtype": return "deal_stage";
    case "module_display": return "module_status";
    case "insight_subtype_display": return "module_display";
  }
}

function analyze(rows: InsightRow[], dim: DrillDimension, label: string) {
  const matched = rows.filter((r) => matchDimension(r, dim, label));
  const subKey = subKeyFor(dim);
  const subCounts = new Map<string, number>();
  let rowsWithNullSubKey = 0;
  for (const r of matched) {
    const v = r[subKey];
    if (v == null || String(v).trim() === "") { rowsWithNullSubKey++; continue; }
    const k = String(v).trim();
    subCounts.set(k, (subCounts.get(k) ?? 0) + 1);
  }
  const sub = [...subCounts.entries()].sort((a, b) => b[1] - a[1]);
  const withQuote = matched.filter((r) => r.verbatim_quote && r.verbatim_quote.trim()).length;
  const coverage = matched.length ? (matched.length - rowsWithNullSubKey) / matched.length : 0;

  const issues: string[] = [];
  if (sub.length === 0) issues.push("SUB_BREAKDOWN_EMPTY");
  if (sub.length === 1) issues.push("SUB_BREAKDOWN_SINGLE_VALUE");
  if (coverage < 0.3 && matched.length > 10) issues.push(`SUB_BREAKDOWN_THIN_COVERAGE=${(coverage*100).toFixed(0)}%`);
  if (withQuote < 3 && matched.length > 10) issues.push(`FEW_QUOTES=${withQuote}`);
  if (sub.some(([k]) => k.toLowerCase() === label.toLowerCase())) issues.push("SUB_LABEL_EQUALS_PARENT");

  return { matched: matched.length, withQuote, subKey, sub, coverage, issues };
}

function main() {
  return loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1").then((all) => {
    const filtered = applyFilters(all, { ...EMPTY_FILTERS });
    console.log(`Loaded ${all.length} rows; filtered=${filtered.length}`);

    const charts: Array<{ name: string; dim: DrillDimension; scope: DrillScope; topN: number }> = [
      { name: "Top 10 Pains (ExecSummary)", dim: "insight_subtype_display", scope: "pain", topN: 10 },
      { name: "Ranking Competidores (CompIntel)", dim: "competitor_name", scope: "competitive_signal", topN: 10 },
      { name: "Top Fricciones (SalesEnab)", dim: "friction_subtype", scope: "deal_friction", topN: 10 },
      { name: "Top 20 Features (ProductGaps)", dim: "feature_display", scope: "product_gap", topN: 10 },
    ];

    for (const ch of charts) {
      console.log(`\n=== ${ch.name} [dim=${ch.dim}, scope=${ch.scope}] ===`);
      const scoped = filtered.filter((r) => r.insight_type === ch.scope);
      const counts = new Map<string, number>();
      for (const r of scoped) {
        let key: string | null | undefined;
        switch (ch.dim) {
          case "pain_theme": key = r.pain_theme; break;
          case "competitor_name": key = r.competitor_name; break;
          case "feature_display": key = r.feature_display; break;
          case "friction_subtype":
          case "insight_subtype_display": key = r.insight_subtype_display; break;
          case "module_display": key = r.module_display; break;
        }
        if (!key) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, ch.topN);
      for (const [label, total] of top) {
        const a = analyze(scoped, ch.dim, label);
        const flag = a.issues.length ? ` ⚠️  ${a.issues.join(", ")}` : " ✓";
        console.log(`  ${label} (total=${total}) → matched=${a.matched}, subKey=${String(a.subKey)}, sub=${a.sub.length} distinct, withQuote=${a.withQuote}, cov=${(a.coverage*100).toFixed(0)}%${flag}`);
        if (a.issues.length && a.sub.length <= 5) {
          a.sub.forEach(([k, n]) => console.log(`      · ${k}: ${n}`));
        }
      }
    }
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
