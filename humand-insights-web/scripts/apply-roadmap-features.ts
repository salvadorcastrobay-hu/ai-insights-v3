/* eslint-disable no-console */
/**
 * Import features from roadmap CSV into tax_feature_names.
 *
 * Operations:
 *   - Para cada fila del CSV con [ES] Feature no vacío:
 *     1. Normalizar display_name = [ES] Feature
 *     2. Generar code = slug([EN] Feature || [ES] Feature)
 *     3. Buscar match en tax_feature_names por display_name (case+accent insensitive)
 *     4. Si match: UPDATE is_seed=true + sync suggested_module (si CSV tiene mini-app válido)
 *     5. Sin match: INSERT con code, display_name, suggested_module, is_seed=true
 *
 * Safety:
 *   - Sin DELETE/DROP
 *   - Code collisions resueltas con sufijo numérico
 *   - Snapshot pre/post + sanity check
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
const CSV_PATH = "../data/roadmap-2026-05.csv";

// Mini-App → tax_modules.code (mismo mapping que parse-roadmap-csv.ts)
const MINI_APP_MAP: Record<string, string> = {
  "Time Tracking": "time_tracking", "Learning": "learning", "People Experience": "people_experience",
  "Time Off": "time_off", "Service Management": "service_management", "Chats": "chat",
  "Performance": "performance_review", "Recruiting (ATS)": "ats", "Onboarding": "onboarding",
  "Libraries": "knowledge_libraries", "Goals": "goals_and_okrs", "Kudos": "kudos",
  "Documents": "documents", "Livestream": "live_streaming", "Org Chart": "org_chart",
  "Events": "events", "Roles & Permissions": "roles_permissions", "Insights": "insights",
  "Files": "files", "Surveys": "surveys", "Marketplace": "marketplace", "News": "magazine",
  "Referrals": "referral_program", "Forms": "forms_and_workflows", "Workflows": "forms_and_workflows",
  "Anniversaries": "birthdays_and_anniversaries", "Security": "security_and_privacy",
  "Integrations": "integrations", "Legajo digital | HRIS": "digital_employee_file",
  // Nuevos módulos creados en fase A
  "Users": "users", "Groups": "groups", "Auth": "auth",
  "Notification Center": "notification_center", "Profile": "profile",
  "Calls": "calls", "Feed": "feed", "Time Planning": "time_planning",
  "Trainings": "trainings", "Prode": "prode", "Microloans": "microloans",
};

// ─── CSV parser ────────────────────────────────────────────────
function parseCsv(text: string): Array<Record<string, string>> {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false; }
      else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some((x) => x !== "")) rows.push(cur);
        cur = [];
      } else field += c;
    }
  }
  if (field || cur.length) { cur.push(field); if (cur.some((x) => x !== "")) rows.push(cur); }
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ─── Helpers ────────────────────────────────────────────────
function normalize(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(s: string, maxLen = 60): string {
  const slug = s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, maxLen);
  return slug || "unnamed";
}

function cleanMiniApp(raw: string): string[] {
  if (!raw) return [];
  return raw.split(/\),\s*/).map((s, i, arr) => {
    const seg = i < arr.length - 1 ? s + ")" : s;
    return seg.replace(/\s*\(https?:\/\/[^)]+\)?\s*/g, "").trim();
  }).filter(Boolean);
}

async function main() {
  console.log(`Apply roadmap features (dry-run=${dryRun})\n`);

  // ── Read & parse CSV ──────────────────────────────────────
  const text = fs.readFileSync(path.join(process.cwd(), CSV_PATH), "utf8");
  const rows = parseCsv(text);
  console.log(`CSV total: ${rows.length} filas`);

  // ── Build de-duped feature list ───────────────────────────
  type Candidate = { display_es: string; display_en: string; suggested_module: string | null };
  const byNormalizedName = new Map<string, Candidate>();
  let skipped = 0;

  for (const r of rows) {
    const displayEs = (r["[ES] Feature"] ?? "").trim();
    const displayEn = (r["[EN] Feature"] ?? "").trim();
    const chosen = displayEs || displayEn;
    if (!chosen) { skipped++; continue; }

    const minis = cleanMiniApp((r["Mini-App"] ?? "").trim());
    // Pick the first Mini-App that maps to a module
    let suggested: string | null = null;
    for (const m of minis) {
      if (MINI_APP_MAP[m]) { suggested = MINI_APP_MAP[m]; break; }
    }

    const key = normalize(chosen);
    if (!key) { skipped++; continue; }

    // Si ya vimos este nombre, conservar el primero pero actualizar suggested_module si nos faltaba
    const existing = byNormalizedName.get(key);
    if (existing) {
      if (!existing.suggested_module && suggested) existing.suggested_module = suggested;
      continue;
    }
    byNormalizedName.set(key, { display_es: chosen, display_en: displayEn, suggested_module: suggested });
  }
  console.log(`Features únicas en CSV: ${byNormalizedName.size} (skipped ${skipped} sin nombre)\n`);

  // ── Fetch existing tax_feature_names ──────────────────────
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const all: Array<{ code: string; display_name: string; suggested_module: string | null; is_seed: boolean | null }> = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.from("tax_feature_names").select("code,display_name,suggested_module,is_seed").range(offset, offset + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < 1000) break;
    offset += 1000;
  }
  console.log(`tax_feature_names actual: ${all.length} filas`);

  const dbByNormalized = new Map<string, typeof all[0]>();
  const dbCodes = new Set<string>();
  for (const r of all) {
    dbByNormalized.set(normalize(r.display_name), r);
    dbCodes.add(r.code);
  }

  // ── Plan acciones ─────────────────────────────────────────
  const updates: Array<{ code: string; is_seed: boolean; suggested_module: string | null; reason: string }> = [];
  const inserts: Array<{ code: string; display_name: string; suggested_module: string | null; is_seed: boolean }> = [];

  for (const [key, c] of byNormalizedName) {
    const dbRow = dbByNormalized.get(key);
    if (dbRow) {
      // Match: posibles updates
      const needsSeedFlip = !dbRow.is_seed;
      const needsModuleSync = c.suggested_module && dbRow.suggested_module !== c.suggested_module;
      if (needsSeedFlip || needsModuleSync) {
        const parts: string[] = [];
        if (needsSeedFlip) parts.push("is_seed→true");
        if (needsModuleSync) parts.push(`module: ${dbRow.suggested_module ?? "—"} → ${c.suggested_module}`);
        updates.push({
          code: dbRow.code,
          is_seed: true,
          suggested_module: needsModuleSync ? (c.suggested_module ?? dbRow.suggested_module) : dbRow.suggested_module,
          reason: parts.join(", "),
        });
      }
      continue;
    }
    // No match: INSERT
    // Generate code from EN (fallback ES)
    const seed = c.display_en || c.display_es;
    let code = slugify(seed);
    if (dbCodes.has(code) || inserts.some((i) => i.code === code)) {
      // collision: append numeric suffix
      let i = 2;
      while (dbCodes.has(`${code}_${i}`) || inserts.some((x) => x.code === `${code}_${i}`)) i++;
      code = `${code}_${i}`;
    }
    inserts.push({ code, display_name: c.display_es, suggested_module: c.suggested_module, is_seed: true });
  }

  console.log(`\nPLAN:`);
  console.log(`  UPDATEs (matches con seeds/auto existentes): ${updates.length}`);
  console.log(`  INSERTs (features nuevas):                   ${inserts.length}`);
  console.log(`  Final: ${all.length + inserts.length} filas en tax_feature_names\n`);

  if (updates.length > 0) {
    console.log(`Primeros 10 UPDATEs:`);
    for (const u of updates.slice(0, 10)) console.log(`  ↪ ${u.code.padEnd(40)}  ${u.reason}`);
  }
  if (inserts.length > 0) {
    console.log(`\nPrimeros 10 INSERTs:`);
    for (const i of inserts.slice(0, 10)) console.log(`  + ${i.code.padEnd(40)}  "${i.display_name}"  mod=${i.suggested_module ?? "—"}`);
  }

  if (dryRun) { console.log("\n— DRY RUN — no se aplicó nada."); return; }

  // ── Aplicar UPDATEs ───────────────────────────────────────
  console.log(`\nAplicando ${updates.length} UPDATEs...`);
  let updateCount = 0;
  for (const u of updates) {
    const { error } = await supabase.from("tax_feature_names").update({
      is_seed: u.is_seed,
      suggested_module: u.suggested_module,
    }).eq("code", u.code);
    if (error) { console.error(`  ✗ ${u.code}: ${error.message}`); throw error; }
    updateCount++;
    if (updateCount % 100 === 0) console.log(`  ...${updateCount}/${updates.length}`);
  }
  console.log(`  ✓ ${updateCount} updates aplicados`);

  // ── Aplicar INSERTs en batches ────────────────────────────
  console.log(`\nAplicando ${inserts.length} INSERTs...`);
  const BATCH = 200;
  for (let i = 0; i < inserts.length; i += BATCH) {
    const slice = inserts.slice(i, i + BATCH);
    const { error } = await supabase.from("tax_feature_names").insert(slice);
    if (error) { console.error(`  ✗ batch ${i}: ${error.message}`); throw error; }
    console.log(`  ...${Math.min(i + BATCH, inserts.length)}/${inserts.length}`);
  }

  // ── Snapshot post + sanity ───────────────────────────────
  const { count } = await supabase.from("tax_feature_names").select("*", { count: "exact", head: true });
  console.log(`\nDespués: ${count} features (era ${all.length})`);
  if (count != null && count < all.length) {
    console.error(`\n⚠️  Bajó la cantidad de features — NO debería pasar.`);
    process.exit(1);
  }
  console.log(`\n✓ Sanity check: cero features perdidas.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
