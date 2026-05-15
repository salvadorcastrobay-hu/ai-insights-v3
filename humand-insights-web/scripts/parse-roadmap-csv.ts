/* eslint-disable no-console */
/**
 * Parse roadmap CSV from Notion → aggregate features by Mini-App → compute
 * proposed module status. Read-only: prints a diff against the live DB,
 * does NOT apply anything.
 *
 * Usage:
 *   npx tsx scripts/parse-roadmap-csv.ts
 */
import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.qa");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) process.env[m[1]] ??= m[2] ?? m[3];
}

import { createClient } from "@supabase/supabase-js";

// ─── Constants ────────────────────────────────────────────────
const CSV_PATH = "../data/roadmap-2026-05.csv";

type Bucket = "existing" | "roadmap" | "missing";

const STATUS_MAP: Record<string, Bucket> = {
  // existing
  "Released": "existing",
  "Rolling out": "existing",
  "Testing": "existing",
  // roadmap
  "Developing": "roadmap",
  "To Design": "roadmap",
  "Defining": "roadmap",
  "Backlog": "roadmap",
  "Postponed": "roadmap",
  "Idea 💡": "roadmap",
  "To be defined ⏳": "roadmap",
  // missing
  "NTH": "missing",
};

// Mini-App → tax_modules.code
const MINI_APP_MAP: Record<string, string> = {
  "Time Tracking": "time_tracking",
  "Learning": "learning",
  "People Experience": "people_experience",
  "Time Off": "time_off",
  "Service Management": "service_management",
  "Chats": "chat",
  "Performance": "performance_review",
  "Recruiting (ATS)": "ats",
  "Onboarding": "onboarding",
  "Libraries": "knowledge_libraries",
  "Goals": "goals_and_okrs",
  "Kudos": "kudos",
  "Documents": "documents",
  "Livestream": "live_streaming",
  "Org Chart": "org_chart",
  "Events": "events",
  "Roles & Permissions": "roles_permissions",
  "Insights": "insights",
  // Round 2: huérfanos confirmados que mapean a módulos existentes
  "Files": "files",
  "Surveys": "surveys",
  "Marketplace": "marketplace",
  "News": "magazine",
  "Referrals": "referral_program",
  "Forms": "forms_and_workflows",
  "Workflows": "forms_and_workflows",
  "Anniversaries": "birthdays_and_anniversaries",
  "Security": "security_and_privacy",
  "Integrations": "integrations",
  "Legajo digital | HRIS": "digital_employee_file",
};

// New modules to create
type NewMod = { code: string; display_en: string; display_es: string; hr_category: string };
const NEW_MODULES: Record<string, NewMod> = {
  "Users": { code: "users", display_en: "Users", display_es: "Usuarios", hr_category: "platform" },
  "Groups": { code: "groups", display_en: "Groups", display_es: "Grupos", hr_category: "platform" },
  "Auth": { code: "auth", display_en: "Auth", display_es: "Autenticación", hr_category: "platform" },
  "Notification Center": { code: "notification_center", display_en: "Notification Center", display_es: "Centro de Notificaciones", hr_category: "platform" },
  "Profile": { code: "profile", display_en: "Profile", display_es: "Perfil", hr_category: "platform" },
  "Calls": { code: "calls", display_en: "Calls", display_es: "Llamadas", hr_category: "internal_communication" },
  "Feed": { code: "feed", display_en: "Feed", display_es: "Feed", hr_category: "internal_communication" },
  "Time Planning": { code: "time_planning", display_en: "Time Planning", display_es: "Planificación de Turnos", hr_category: "operations_and_workplace" },
  "Trainings": { code: "trainings", display_en: "Trainings", display_es: "Capacitaciones Presenciales", hr_category: "talent_development" },
  "Prode": { code: "prode", display_en: "Prode", display_es: "Prode", hr_category: "employee_experience" },
  // Round 2: nuevo módulo solicitado por el usuario
  "Microloans": { code: "microloans", display_en: "Microloans", display_es: "Microcréditos", hr_category: "compensation_and_benefits" },
};

// ─── CSV parser (tolerant) ────────────────────────────────────
function parseCsv(text: string): Array<Record<string, string>> {
  // Strip BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        cur.push(field); field = "";
        if (cur.some((x) => x !== "")) rows.push(cur);
        cur = [];
      } else {
        field += c;
      }
    }
  }
  if (field || cur.length) { cur.push(field); if (cur.some((x) => x !== "")) rows.push(cur); }
  if (!rows.length) return [];
  const header = rows[0];
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < rows.length; i++) {
    const r: Record<string, string> = {};
    for (let j = 0; j < header.length; j++) r[header[j]] = rows[i][j] ?? "";
    out.push(r);
  }
  return out;
}

function cleanMiniApp(value: string): string {
  // "Time Tracking (https://www.notion.so/...)" → "Time Tracking"
  // Notion sometimes joins multiple: "Feed (...), Groups (...)" — we take the first one.
  const first = value.split(/\),\s*/)[0]; // up to closing paren of the first link
  const cleaned = first.replace(/\s*\(https?:\/\/[^)]+\)?\s*/g, "").trim();
  return cleaned;
}

async function main() {
  const csvPath = path.join(process.cwd(), CSV_PATH);
  const text = fs.readFileSync(csvPath, "utf8");
  const rows = parseCsv(text);
  console.log(`Total filas CSV: ${rows.length}`);

  // Aggregate features per Mini-App by bucket
  type Agg = { total: number; existing: number; roadmap: number; missing: number; unknown: number; rawStatuses: Map<string, number> };
  const byMiniApp = new Map<string, Agg>();
  let skipped = 0;
  for (const row of rows) {
    const rawMini = (row["Mini-App"] ?? "").trim();
    if (!rawMini) { skipped++; continue; }
    const status = (row["Status"] ?? "").trim();

    // Split mini-app if it's a multi-link join (Notion outputs "A (url1), B (url2)")
    // We expand and attribute the same row to each mini-app it belongs to
    const allMinis = rawMini.split(/\),\s*/).map((s, i, arr) => {
      const seg = i < arr.length - 1 ? s + ")" : s;
      return seg.replace(/\s*\(https?:\/\/[^)]+\)?\s*/g, "").trim();
    }).filter(Boolean);

    for (const mini of allMinis) {
      const agg = byMiniApp.get(mini) ?? { total: 0, existing: 0, roadmap: 0, missing: 0, unknown: 0, rawStatuses: new Map() };
      agg.total += 1;
      agg.rawStatuses.set(status, (agg.rawStatuses.get(status) ?? 0) + 1);
      const bucket = STATUS_MAP[status];
      if (!bucket) agg.unknown += 1;
      else if (bucket === "existing") agg.existing += 1;
      else if (bucket === "roadmap") agg.roadmap += 1;
      else if (bucket === "missing") agg.missing += 1;
      byMiniApp.set(mini, agg);
    }
  }
  console.log(`Filas sin Mini-App: ${skipped}`);
  console.log(`Mini-Apps únicos: ${byMiniApp.size}\n`);

  // Compute proposed status per mini-app
  function proposeStatus(agg: Agg): Bucket | null {
    if (agg.existing >= 1) return "existing";
    if (agg.roadmap >= 1) return "roadmap";
    if (agg.missing >= 1) return "missing";
    return null;
  }

  // Fetch current DB state
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data: dbModules, error } = await supabase.from("tax_modules").select("code,display_name,status,hr_category,sort_order").order("sort_order");
  if (error) throw error;
  const dbByCode = new Map(dbModules!.map((m) => [m.code, m]));

  // ─── Match & report ───────────────────────────────────────
  type Row = { miniApp: string; code: string | null; proposed: Bucket | null; current: string | null; isNew: boolean; agg: Agg };
  const matched: Row[] = [];
  const orphans: Row[] = []; // mini-apps that don't map anywhere

  for (const [miniApp, agg] of byMiniApp) {
    const proposed = proposeStatus(agg);
    if (MINI_APP_MAP[miniApp]) {
      const code = MINI_APP_MAP[miniApp];
      const dbRow = dbByCode.get(code);
      matched.push({ miniApp, code, proposed, current: dbRow?.status ?? null, isNew: false, agg });
    } else if (NEW_MODULES[miniApp]) {
      const code = NEW_MODULES[miniApp].code;
      matched.push({ miniApp, code, proposed, current: null, isNew: true, agg });
    } else {
      orphans.push({ miniApp, code: null, proposed, current: null, isNew: false, agg });
    }
  }

  // ─── Report ───────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("PROPUESTA DE CAMBIOS");
  console.log("═══════════════════════════════════════════════════════════════\n");

  // Group A: status changes on existing modules
  const updates = matched.filter((r) => !r.isNew && r.proposed && r.proposed !== r.current);
  console.log(`▸ UPDATES en módulos existentes (${updates.length}):\n`);
  for (const r of updates) {
    console.log(`  ${r.code!.padEnd(28)}  ${(r.current ?? "—").padEnd(10)} → ${r.proposed!.padEnd(10)}  [features: ex=${r.agg.existing}, rm=${r.agg.roadmap}, ms=${r.agg.missing}]`);
  }

  // Group B: no change
  const noChange = matched.filter((r) => !r.isNew && r.proposed === r.current);
  console.log(`\n▸ Sin cambio (${noChange.length}):\n`);
  for (const r of noChange) {
    console.log(`  ${r.code!.padEnd(28)}  ${r.current ?? "—"}`);
  }

  // Group C: new modules to create
  const news = matched.filter((r) => r.isNew);
  console.log(`\n▸ NUEVOS módulos a crear (${news.length}):\n`);
  for (const r of news) {
    const meta = NEW_MODULES[r.miniApp];
    console.log(`  + ${r.code!.padEnd(22)}  ${meta.display_es.padEnd(30)} category=${meta.hr_category.padEnd(24)} status=${r.proposed ?? "—"}  [features: ex=${r.agg.existing}, rm=${r.agg.roadmap}, ms=${r.agg.missing}]`);
  }

  // Group D: orphans
  console.log(`\n▸ HUÉRFANOS (Mini-Apps en CSV que no mapean a ningún módulo) — IGNORADOS:\n`);
  for (const r of orphans.sort((a, b) => b.agg.total - a.agg.total)) {
    console.log(`  ! ${r.miniApp.padEnd(40)}  features=${r.agg.total}`);
  }

  // Group E: modules in DB without CSV coverage
  const inDbNotInCsv = [...dbByCode.keys()].filter((code) => !matched.some((m) => m.code === code));
  console.log(`\n▸ Módulos en DB SIN cobertura del CSV (mantienen status actual):\n`);
  for (const code of inDbNotInCsv) {
    const m = dbByCode.get(code)!;
    console.log(`  ${code.padEnd(28)}  status=${m.status}`);
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`Resumen: ${updates.length} updates · ${news.length} nuevos · ${noChange.length} sin cambio · ${inDbNotInCsv.length} sin CSV · ${orphans.length} huérfanos`);
  console.log("═══════════════════════════════════════════════════════════════");
}

main().catch((e) => { console.error(e); process.exit(1); });
