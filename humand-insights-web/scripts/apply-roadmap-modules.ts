/* eslint-disable no-console */
/**
 * Apply roadmap module changes derived from the CSV.
 *
 * Operations (in order):
 *   1. UPDATE tax_modules.status para módulos existentes que cambian
 *      (incluye el override manual de microloans → existing per user)
 *   2. INSERT 11 nuevos módulos (incluye microloans)
 *
 * Safety:
 *   - Sin DELETE/DROP
 *   - INSERTs con ON CONFLICT DO NOTHING (re-ejecutable)
 *   - Snapshot pre/post + sanity check de filas perdidas
 *
 * Use --dry para imprimir el plan sin aplicar.
 */
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.qa");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) process.env[m[1]] ??= m[2] ?? m[3];
}

import { createClient } from "@supabase/supabase-js";

const dryRun = process.argv.includes("--dry");

// ─── Decisiones confirmadas por el usuario ────────────────────
// Updates en módulos existentes
const UPDATES: Array<{ code: string; status: string }> = [
  { code: "ats", status: "existing" },   // CSV: 15 released
  { code: "files", status: "roadmap" },  // CSV: 0 released, 13 roadmap (trust CSV)
];

// Nuevos módulos a crear (status según aggregate del CSV)
type NewMod = {
  code: string;
  display_name: string;
  hr_category: string;
  status: string;
  sort_order: number;
};

const NEW_MODULES: NewMod[] = [
  // platform (sort_order continúa después de 43 ya usados)
  { code: "users",                display_name: "Usuarios",                  hr_category: "platform",                 status: "existing", sort_order: 44 },
  { code: "groups",               display_name: "Grupos",                    hr_category: "platform",                 status: "existing", sort_order: 45 },
  { code: "auth",                 display_name: "Autenticacion",             hr_category: "platform",                 status: "existing", sort_order: 46 },
  { code: "notification_center",  display_name: "Centro de Notificaciones",  hr_category: "platform",                 status: "existing", sort_order: 47 },
  { code: "profile",              display_name: "Perfil",                    hr_category: "platform",                 status: "existing", sort_order: 48 },
  // internal_communication
  { code: "calls",                display_name: "Llamadas",                  hr_category: "internal_communication",   status: "existing", sort_order: 49 },
  { code: "feed",                 display_name: "Feed",                      hr_category: "internal_communication",   status: "existing", sort_order: 50 },
  // operations
  { code: "time_planning",        display_name: "Planificacion de Turnos",   hr_category: "operations_and_workplace", status: "existing", sort_order: 51 },
  // talent_development
  { code: "trainings",            display_name: "Capacitaciones Presenciales", hr_category: "talent_development",     status: "existing", sort_order: 52 },
  // employee_experience
  { code: "prode",                display_name: "Prode",                     hr_category: "employee_experience",      status: "roadmap",  sort_order: 53 },
  // compensation_and_benefits
  { code: "microloans",           display_name: "Microcreditos",             hr_category: "compensation_and_benefits", status: "existing", sort_order: 54 },
];

async function main() {
  console.log(`Apply roadmap modules (dry-run=${dryRun})\n`);
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });

  // ── Snapshot pre ──────────────────────────────────────────
  const { data: pre, error: preError } = await supabase.from("tax_modules").select("code,display_name,status").order("sort_order");
  if (preError) throw preError;
  const preByCode = new Map((pre ?? []).map((r) => [r.code, r]));
  const preCounts = (pre ?? []).reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
  console.log(`Antes: ${pre?.length ?? 0} módulos. ${JSON.stringify(preCounts)}\n`);

  // ── UPDATES ────────────────────────────────────────────────
  console.log(`UPDATES (${UPDATES.length}):`);
  for (const u of UPDATES) {
    const cur = preByCode.get(u.code);
    if (!cur) { console.log(`  ! ${u.code}: no existe en DB, skip`); continue; }
    if (cur.status === u.status) { console.log(`  = ${u.code}: ya es ${u.status}, skip`); continue; }
    console.log(`  ↪ ${u.code}: ${cur.status} → ${u.status}`);
    if (!dryRun) {
      const { error } = await supabase.from("tax_modules").update({ status: u.status }).eq("code", u.code);
      if (error) throw error;
    }
  }

  // ── INSERTS ────────────────────────────────────────────────
  console.log(`\nNUEVOS módulos (${NEW_MODULES.length}):`);
  for (const m of NEW_MODULES) {
    if (preByCode.has(m.code)) { console.log(`  = ${m.code}: ya existe, skip`); continue; }
    console.log(`  + ${m.code.padEnd(22)} "${m.display_name}" (${m.hr_category}, ${m.status}, order=${m.sort_order})`);
    if (!dryRun) {
      const { error } = await supabase.from("tax_modules").insert(m);
      if (error) throw error;
    }
  }

  if (dryRun) { console.log("\n— DRY RUN — no se aplicó nada."); return; }

  // ── Snapshot post ─────────────────────────────────────────
  const { data: post, error: postError } = await supabase.from("tax_modules").select("code,display_name,status").order("sort_order");
  if (postError) throw postError;
  const postCounts = (post ?? []).reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {});
  console.log(`\nDespués: ${post?.length ?? 0} módulos. ${JSON.stringify(postCounts)}`);

  // Sanity: nadie se perdió
  const lost = (pre ?? []).filter((p) => !(post ?? []).some((q) => q.code === p.code));
  if (lost.length) {
    console.error(`\n⚠️  PERDIDOS:`);
    for (const l of lost) console.error(`   - ${l.code}`);
    process.exit(1);
  }
  console.log(`\n✓ Sanity check: cero módulos perdidos.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
