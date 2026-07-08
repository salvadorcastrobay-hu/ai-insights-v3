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

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Stem-ish — drop common suffixes/prefixes to catch "Integración de nómina" ≈ "Nomina integration"
function rootTokens(norm: string): string[] {
  const STOP = new Set(["de", "del", "la", "el", "los", "las", "a", "para", "con", "en", "y", "or", "of", "the", "for", "to", "by", "from", "into", "module", "modulo"]);
  return norm.split(" ").filter((t) => t.length >= 3 && !STOP.has(t)).sort();
}

async function main() {
  // Pull all features
  const all: Array<{ code: string; display_name: string; suggested_module: string | null }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase
      .from("tax_feature_names")
      .select("code,display_name,suggested_module")
      .range(offset, offset + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`Total features: ${all.length}`);

  const rows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1");
  const counts = new Map<string, number>();
  for (const r of rows) if (r.feature_name) counts.set(r.feature_name, (counts.get(r.feature_name) ?? 0) + 1);

  // Group by token-set signature
  const buckets = new Map<string, Array<{ code: string; display: string; module: string; insights: number }>>();
  for (const f of all) {
    const norm = normalize(f.display_name);
    const tokens = rootTokens(norm);
    if (tokens.length === 0) continue;
    const sig = tokens.join("|");
    const list = buckets.get(sig) ?? [];
    list.push({
      code: f.code,
      display: f.display_name,
      module: f.suggested_module ?? "",
      insights: counts.get(f.code) ?? 0,
    });
    buckets.set(sig, list);
  }

  // Keep buckets with multiple entries
  const groups = [...buckets.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([sig, list]) => ({
      sig,
      list: list.sort((a, b) => b.insights - a.insights),
      totalInsights: list.reduce((a, b) => a + b.insights, 0),
    }))
    .sort((a, b) => b.totalInsights - a.totalInsights);

  console.log(`\nGrupos con ≥2 features que comparten tokens semánticos: ${groups.length}`);
  console.log(`Features afectadas: ${groups.reduce((a, g) => a + g.list.length, 0)}`);
  console.log(`Volumen agregado en duplicados: ${groups.reduce((a, g) => a + g.totalInsights, 0)} menciones\n`);

  console.log(`Top 40 grupos por volumen (los más sangrantes):\n`);
  for (const g of groups.slice(0, 40)) {
    const totalDeals = g.list.reduce((a, b) => a + b.insights, 0);
    console.log(`[${totalDeals} menciones] tokens=${g.sig}`);
    for (const f of g.list) {
      console.log(`    · "${f.display}"  (insights=${f.insights}, módulo=${f.module || "—"})`);
    }
    console.log();
  }

  // Save full report
  const outFile = path.join(process.cwd(), "..", "data", "feature-duplicates-2026-05.csv");
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  const lines = ["group_id,token_signature,display_name,code,module,insights"];
  groups.forEach((g, i) => {
    for (const f of g.list) {
      const safe = (s: string) => /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      lines.push(`${i + 1},${safe(g.sig)},${safe(f.display)},${safe(f.code)},${safe(f.module)},${f.insights}`);
    }
  });
  fs.writeFileSync(outFile, lines.join("\n"));
  console.log(`\nReporte completo: ${path.resolve(outFile)}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
