/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.qa");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) process.env[m[1]] ??= m[2] ?? m[3];
}

import { createClient } from "@supabase/supabase-js";
import { loadInsights } from "../lib/supabase/queries";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

function csvEscape(v: unknown) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  // 1. Pull all feature taxonomy entries (paginated since PostgREST caps at 1000)
  const all: Array<{ code: string; display_name: string; suggested_module: string | null; is_seed: boolean | null }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("tax_feature_names")
      .select("code,display_name,suggested_module,is_seed")
      .order("display_name", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Pulled ${all.length} features`);

  // 2. Count insights per feature_name from the dataset
  const rows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.2");
  const counts = new Map<string, number>();
  const dealCounts = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.feature_name) continue;
    counts.set(r.feature_name, (counts.get(r.feature_name) ?? 0) + 1);
    if (r.deal_id) {
      const set = dealCounts.get(r.feature_name) ?? new Set();
      set.add(r.deal_id);
      dealCounts.set(r.feature_name, set);
    }
  }

  // 3. Build CSV
  const enriched = all.map((f) => ({
    code: f.code,
    display_name: f.display_name,
    suggested_module: f.suggested_module ?? "",
    is_seed: f.is_seed ? "yes" : "no",
    insights: counts.get(f.code) ?? 0,
    deals: (dealCounts.get(f.code)?.size) ?? 0,
  }));
  enriched.sort((a, b) => b.insights - a.insights || a.display_name.localeCompare(b.display_name));

  const header = ["code", "display_name", "suggested_module", "is_seed", "insights", "deals"];
  const lines = [header.join(",")];
  for (const r of enriched) {
    lines.push([r.code, r.display_name, r.suggested_module, r.is_seed, r.insights, r.deals].map(csvEscape).join(","));
  }
  const outFile = path.join("data", "features-2026-05.csv");
  fs.mkdirSync("data", { recursive: true });
  fs.writeFileSync(outFile, lines.join("\n"));
  console.log(`Saved → ${outFile}`);

  // 4. Summary
  const seed = enriched.filter((r) => r.is_seed === "yes").length;
  const auto = enriched.length - seed;
  const used = enriched.filter((r) => r.insights > 0).length;
  console.log(`\nResumen`);
  console.log(`  Total features:       ${enriched.length}`);
  console.log(`  Seed (en taxonomía):  ${seed}`);
  console.log(`  Auto-detectadas:      ${auto}`);
  console.log(`  Con menciones reales: ${used}`);
  console.log(`  Sin menciones:        ${enriched.length - used}`);

  // 5. Top 50 by usage
  console.log(`\nTop 50 por menciones:`);
  console.log("rank | display | insights | deals | módulo sugerido | seed");
  enriched.slice(0, 50).forEach((r, i) => {
    console.log(`${String(i + 1).padStart(3)} | ${r.display_name.padEnd(50).slice(0, 50)} | ${String(r.insights).padStart(6)} | ${String(r.deals).padStart(5)} | ${(r.suggested_module || "—").padEnd(28).slice(0, 28)} | ${r.is_seed}`);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
