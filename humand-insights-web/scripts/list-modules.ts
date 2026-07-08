/* eslint-disable no-console */
import fs from "node:fs"; import path from "node:path";
const envPath = path.join(process.cwd(), ".env.qa");
for (const l of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = l.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) process.env[m[1]] ??= m[2] ?? m[3];
}

import { loadInsights } from "../lib/supabase/queries";

(async () => {
  const all = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1");
  const byStatus = new Map<string, Map<string, number>>();
  for (const r of all) {
    const mod = r.module_display?.trim();
    const status = (r.module_status ?? "(unset)").trim();
    if (!mod) continue;
    if (!byStatus.has(status)) byStatus.set(status, new Map());
    const m = byStatus.get(status)!;
    m.set(mod, (m.get(mod) ?? 0) + 1);
  }

  const statusOrder = ["existing", "missing", "roadmap", "(unset)"];
  for (const status of statusOrder) {
    const m = byStatus.get(status);
    if (!m) continue;
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    console.log(`\n=== ${status.toUpperCase()} — ${m.size} modules, ${total} insights ===`);
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    for (const [mod, n] of sorted) console.log(`  ${mod.padEnd(40)} ${n}`);
  }
  // Also show modules that appear under multiple statuses
  const moduleStatuses = new Map<string, Set<string>>();
  for (const [status, m] of byStatus) {
    for (const mod of m.keys()) {
      if (!moduleStatuses.has(mod)) moduleStatuses.set(mod, new Set());
      moduleStatuses.get(mod)!.add(status);
    }
  }
  const ambiguous = [...moduleStatuses.entries()].filter(([, s]) => s.size > 1);
  if (ambiguous.length) {
    console.log(`\n=== AMBIGUOUS (multiple statuses) — ${ambiguous.length} modules ===`);
    for (const [mod, s] of ambiguous) console.log(`  ${mod.padEnd(40)} ${[...s].join(", ")}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
