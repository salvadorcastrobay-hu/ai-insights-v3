/* eslint-disable no-console */
/**
 * Module taxonomy update — 2026-05
 *
 * Runs the same operations as sql/update_modules_2026_05.sql but via the
 * Supabase REST client. NO DELETEs, NO DROPs, all changes are reversible
 * by re-running with the previous values.
 *
 * Usage:
 *   npx tsx scripts/update-modules.ts          # apply
 *   npx tsx scripts/update-modules.ts --dry    # show what would change
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
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(url, serviceRole, { auth: { persistSession: false } });

const RENAMES: Array<[code: string, display_name: string]> = [
  ["magazine", "Noticias"],
  ["knowledge_libraries", "Biblioteca de Recursos"],
  ["perks_and_benefits", "Beneficios"],
  ["time_off", "Vacaciones y Permisos"],
  ["digital_employee_file", "Expediente digital del colaborador"],
  ["goals_and_okrs", "Objetivos y Resultados Clave"],
  ["learning", "Aprendizaje"],
  ["development_plan", "Plan de carrera"],
  ["internal_job_postings", "Busquedas internas"],
  ["time_tracking", "Control de Asistencia"],
  ["forms_and_workflows", "Formularios, tramites y aprobaciones"],
  ["service_management", "Gestion de Servicios"],
  ["marketplace", "Marketplace"],
  ["digital_access", "Acceso con ID"],
  ["people_experience", "People Experience"],
  ["company_policies", "Politicas"],
  ["live_streaming", "Live Streaming"],
];

const TO_ROADMAP = ["ats", "payroll", "ai_recruiter"];

const NEW_MODULES: Array<{ code: string; display_name: string; hr_category: string; status: string; sort_order: number }> = [
  { code: "roles_permissions", display_name: "Roles & Permisos", hr_category: "platform", status: "existing", sort_order: 40 },
  { code: "integrations",      display_name: "Integraciones",    hr_category: "platform", status: "existing", sort_order: 41 },
  { code: "insights",          display_name: "Insights",         hr_category: "platform", status: "existing", sort_order: 42 },
];

async function main() {
  console.log(`Module taxonomy update (dry-run=${dryRun})\n`);

  // ── Snapshot pre ────────────────────────────────────────────
  const { data: pre, error: preError } = await supabase
    .from("tax_modules")
    .select("code,display_name,status")
    .order("sort_order");
  if (preError) throw preError;
  const preByCode = new Map((pre ?? []).map((r) => [r.code, r]));
  console.log(`Modules antes: ${pre?.length ?? 0} total`);
  const preCounts = (pre ?? []).reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {});
  console.log(`  ${JSON.stringify(preCounts)}\n`);

  // ── 1. Categoría 'platform' ─────────────────────────────────
  const { data: existingCats } = await supabase.from("tax_hr_categories").select("code").eq("code", "platform");
  if (!existingCats?.length) {
    console.log("• Crear categoría 'platform'");
    if (!dryRun) {
      const { error } = await supabase
        .from("tax_hr_categories")
        .insert({ code: "platform", display_name: "Plataforma", sort_order: 8 });
      if (error) throw error;
    }
  } else {
    console.log("• Categoría 'platform' ya existe (skip)");
  }

  // ── 2. Renames ──────────────────────────────────────────────
  console.log("\nRenames:");
  for (const [code, newName] of RENAMES) {
    const cur = preByCode.get(code);
    if (!cur) {
      console.log(`  ! ${code}: no existe, skip`);
      continue;
    }
    if (cur.display_name === newName) {
      console.log(`  = ${code}: ya es "${newName}", skip`);
      continue;
    }
    console.log(`  ↪ ${code}: "${cur.display_name}" → "${newName}"`);
    if (!dryRun) {
      const { error } = await supabase.from("tax_modules").update({ display_name: newName }).eq("code", code);
      if (error) throw error;
    }
  }

  // ── 3. Status → roadmap ─────────────────────────────────────
  console.log("\nStatus updates:");
  for (const code of TO_ROADMAP) {
    const cur = preByCode.get(code);
    if (!cur) {
      console.log(`  ! ${code}: no existe, skip`);
      continue;
    }
    if (cur.status === "roadmap") {
      console.log(`  = ${code}: ya es roadmap, skip`);
      continue;
    }
    console.log(`  ↪ ${code}: ${cur.status} → roadmap`);
    if (!dryRun) {
      const { error } = await supabase.from("tax_modules").update({ status: "roadmap" }).eq("code", code);
      if (error) throw error;
    }
  }

  // ── 4. Nuevos módulos ───────────────────────────────────────
  console.log("\nNuevos módulos:");
  for (const m of NEW_MODULES) {
    if (preByCode.has(m.code)) {
      console.log(`  = ${m.code}: ya existe, skip`);
      continue;
    }
    console.log(`  + ${m.code}: "${m.display_name}" (${m.hr_category}, ${m.status})`);
    if (!dryRun) {
      const { error } = await supabase.from("tax_modules").insert(m);
      if (error) throw error;
    }
  }

  if (dryRun) {
    console.log("\n— DRY RUN — no se aplicaron cambios.");
    return;
  }

  // ── Snapshot post ───────────────────────────────────────────
  const { data: post, error: postError } = await supabase
    .from("tax_modules")
    .select("code,display_name,status")
    .order("sort_order");
  if (postError) throw postError;
  const postCounts = (post ?? []).reduce<Record<string, number>>((a, r) => {
    a[r.status] = (a[r.status] ?? 0) + 1;
    return a;
  }, {});
  console.log(`\nModules ahora: ${post?.length ?? 0} total`);
  console.log(`  ${JSON.stringify(postCounts)}`);

  // Sanity check — no perdimos ningún módulo
  const lost = (pre ?? []).filter((p) => !(post ?? []).some((q) => q.code === p.code));
  if (lost.length > 0) {
    console.error(`\n⚠️  PERDIDOS (esto NO debería pasar):`);
    for (const l of lost) console.error(`   - ${l.code}`);
    process.exit(1);
  }
  console.log(`\n✓ Sanity check: cero módulos perdidos.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
