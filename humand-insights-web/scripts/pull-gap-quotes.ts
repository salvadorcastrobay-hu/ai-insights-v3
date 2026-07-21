/* eslint-disable no-console */
import fs from "node:fs"; import path from "node:path";
const envPath = path.join(process.cwd(), ".env.qa");
for (const l of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) process.env[m[1]] ??= m[2] ?? m[3];
}
import { loadInsights } from "../lib/supabase/queries";

const TARGETS = ["payroll_integration", "digital_signature", "biometric_clocks_integration", "api_access", "performance_review", "ats_module"];

loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2").then((rows) => {
  for (const t of TARGETS) {
    const matches = rows
      .filter((r) => r.insight_type === "product_gap" && r.feature_name === t && r.verbatim_quote && r.verbatim_quote.length > 70 && r.verbatim_quote.length < 350)
      .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    console.log(`\n=== ${t} (${matches.length} cuotables) ===`);
    matches.slice(0, 5).forEach((r, i) => {
      console.log(`\n${i + 1}. [${r.company_name} · ${r.segment} · ${r.country} · conf=${r.confidence}]`);
      console.log(`   feature_display: ${r.feature_display}`);
      console.log(`   priority: ${r.gap_priority}`);
      console.log(`   summary: ${r.summary}`);
      console.log(`   "${r.verbatim_quote}"`);
    });
  }
});
