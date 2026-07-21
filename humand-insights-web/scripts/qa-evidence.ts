/* eslint-disable no-console */
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
  | "pain_theme" | "competitor_name" | "feature_display"
  | "friction_subtype" | "module_display" | "insight_subtype_display";

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
function pickRepresentativeRows(rows: InsightRow[], limit: number) {
  const withQuote = rows.filter((r) => r.verbatim_quote && r.verbatim_quote.trim());
  const ranked = [...withQuote].sort((a, b) => {
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    return (b.call_date ?? "").localeCompare(a.call_date ?? "");
  });
  const rest = rows.filter((r) => !r.verbatim_quote || !r.verbatim_quote.trim());
  return [...ranked, ...rest].slice(0, limit);
}
function sanitize(s: string | null | undefined, maxLen = 240) {
  if (!s) return "";
  const c = s.replace(/\s+/g, " ").trim();
  return c.length > maxLen ? c.slice(0, maxLen - 1) + "…" : c;
}

function buildRowEvidence(rows: InsightRow[], dim: DrillDimension, label: string) {
  const matched = rows.filter((r) => matchDimension(r, dim, label));
  if (!matched.length) return "";
  const subKey = subKeyFor(dim);
  const subCounts = new Map<string, number>();
  for (const r of matched) {
    const v = r[subKey];
    if (v == null) continue;
    const k = String(v).trim();
    if (!k) continue;
    subCounts.set(k, (subCounts.get(k) ?? 0) + 1);
  }
  const subTop = [...subCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  const sample = pickRepresentativeRows(matched, 5);
  const quoteLines = sample.map((r, i) => `    ${i+1}. ${sanitize(r.summary, 140)}${r.verbatim_quote ? ` | "${sanitize(r.verbatim_quote, 180)}"` : ""}`);

  const totalInsights = matched.length;
  const totalCalls = new Set(matched.map((r) => r.transcript_id).filter(Boolean)).size;
  const header = `- "${label}" — TOTALES: ${totalInsights} insights, ${totalCalls} calls`;
  let subLine = "";
  if (subTop.length) {
    const shownSum = subTop.reduce((acc, [, n]) => acc + n, 0);
    const othersCount = Math.max(0, totalInsights - shownSum);
    const othersPct = totalInsights ? Math.round((othersCount / totalInsights) * 100) : 0;
    const lines = subTop.map(([k, n]) => {
      const pct = totalInsights ? Math.round((n / totalInsights) * 100) : 0;
      return `    · ${k}: ${n} (${pct}%)`;
    });
    if (othersCount > 0) lines.push(`    · Otros sub-temas (cola larga): ${othersCount} (${othersPct}%)`);
    subLine = `  SUB-BREAKDOWN (${String(subKey)}):\n${lines.join("\n")}`;
  }
  return [header, subLine, `  MUESTRA (${quoteLines.length}):`, ...quoteLines].filter(Boolean).join("\n");
}

async function main() {
  const all = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2");
  const filtered = applyFilters(all, { ...EMPTY_FILTERS });

  const pains = filtered.filter((r) => r.insight_type === "pain");
  console.log("\n=== EVIDENCE: 'Procesos manuales' ===\n");
  console.log(buildRowEvidence(pains, "insight_subtype_display", "Procesos manuales"));

  console.log("\n\n=== EVIDENCE: 'Herramientas fragmentadas' ===\n");
  console.log(buildRowEvidence(pains, "insight_subtype_display", "Herramientas fragmentadas"));

  console.log("\n\n=== EVIDENCE: 'Baja adopcion' ===\n");
  console.log(buildRowEvidence(pains, "insight_subtype_display", "Baja adopcion"));

  const gaps = filtered.filter((r) => r.insight_type === "product_gap");
  console.log("\n\n=== EVIDENCE: 'Integracion de nomina' (FEATURE — check if priority is useful) ===\n");
  console.log(buildRowEvidence(gaps, "feature_display", "Integracion de nomina"));
}
main().catch((e) => { console.error(e); process.exit(1); });
