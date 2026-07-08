/* eslint-disable no-console */
/**
 * Capa 1 — filtro determinístico de features para canonicalización.
 *
 * Lee:
 *   - data/roadmap-2026-05.csv (las 2,391 del CSV de Notion)
 *   - tax_feature_names (las 5,865 totales, para contar menciones)
 *   - transcript_insights (para contar uses por feature_name)
 *
 * Aplica reglas de purga:
 *   - [WA] - X (workarounds)
 *   - Sub-items (Parent item lleno)
 *   - NTH priority
 *   - Versiones específicas con (v1.5), (V2), v1
 *   - Mini-App huérfano sin mapping
 *   - Display name vacío o "Sin título"
 *
 * Output:
 *   - data/features-stage1-A.json  (Comunicación + Cultura + Engagement)
 *   - data/features-stage1-B.json  (HR Admin + Talent Acquisition + Talent Development)
 *   - data/features-stage1-C.json  (Operations + Compensation + Platform)
 *
 * Cada archivo es la entrada para un subagent en capa 2b.
 */

import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.qa");
for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
  const line = rawLine.replace(/\r$/, "");
  const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) {
    const raw = (m[2] ?? m[3] ?? "").trim();
    process.env[m[1]] ??= raw.replace(/\\n$/, "").replace(/\\n/g, "").trim();
  }
}

import { createClient } from "@supabase/supabase-js";
import { loadInsights } from "../lib/supabase/queries";

const CSV_PATH = "../data/roadmap-2026-05.csv";

// ─── Mini-App → module mapping (igual al de apply-roadmap-features) ───
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
  "Users": "users", "Groups": "groups", "Auth": "auth",
  "Notification Center": "notification_center", "Profile": "profile",
  "Calls": "calls", "Feed": "feed", "Time Planning": "time_planning",
  "Trainings": "trainings", "Prode": "prode", "Microloans": "microloans",
};

// Categoría → grupo (para repartir entre subagents)
const CATEGORY_TO_GROUP: Record<string, "A" | "B" | "C"> = {
  internal_communication: "A",
  culture_and_engagement: "A",
  employee_experience: "A",
  hr_administration: "B",
  talent_acquisition: "B",
  talent_development: "B",
  operations_and_workplace: "C",
  compensation_and_benefits: "C",
  platform: "C",
};

// ─── CSV parser tolerante ─────────────────────────────────────
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

function cleanMiniApp(raw: string): string {
  if (!raw) return "";
  // Notion puts "Name (https://www.notion.so/...?pvs=21), other"
  // Take the first one and strip the URL
  const first = raw.split(/\),\s*/)[0];
  return first.replace(/\s*\(https?:\/\/[^)]+\)?\s*/g, "").trim();
}

async function main() {
  // 1. Read CSV
  const text = fs.readFileSync(path.join(process.cwd(), CSV_PATH), "utf8");
  const rows = parseCsv(text);
  console.log(`CSV: ${rows.length} filas\n`);

  // 2. Load tax_feature_names + transcript_insights counts
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const allFeats: Array<{ code: string; display_name: string; suggested_module: string | null; is_seed: boolean | null }> = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase.from("tax_feature_names").select("code,display_name,suggested_module,is_seed").range(off, off + 999);
    if (error) throw error;
    if (!data?.length) break;
    allFeats.push(...(data as any));
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`tax_feature_names: ${allFeats.length}`);

  const dbByDisplay = new Map<string, typeof allFeats[0]>();
  for (const f of allFeats) {
    const key = f.display_name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    dbByDisplay.set(key, f);
  }

  // Insight counts
  const insights = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.1");
  const useCounts = new Map<string, number>();
  for (const r of insights) {
    if (r.feature_name) useCounts.set(r.feature_name, (useCounts.get(r.feature_name) ?? 0) + 1);
  }
  console.log(`Insights con feature_name: ${[...useCounts.values()].reduce((a, b) => a + b, 0)}\n`);

  // 3. Get modules to look up hr_category
  const { data: mods } = await supabase.from("tax_modules").select("code,hr_category");
  const modCategory = new Map<string, string>();
  for (const m of (mods ?? [])) modCategory.set(m.code, m.hr_category);

  // 4. Apply filters
  type Candidate = {
    csv_code_hint: string;
    display_en: string;
    display_es: string;
    mini_app: string;
    suggested_module: string | null;
    status: string;
    priority: string;
    arr: string;
    db_code: string | null;
    db_is_seed: boolean | null;
    mentions: number;
    drop_reason?: string;
  };

  const STATS = {
    total: 0, dropped_wa: 0, dropped_subitem: 0, dropped_nth: 0,
    dropped_version: 0, dropped_orphan_mini: 0, dropped_empty: 0,
    dropped_granular: 0, kept: 0,
  };

  const candidates: Candidate[] = [];

  for (const r of rows) {
    STATS.total++;
    const displayEs = (r["[ES] Feature"] ?? "").trim();
    const displayEn = (r["[EN] Feature"] ?? "").trim();
    const status = (r["Status"] ?? "").trim();
    const parent = (r["Parent item"] ?? "").trim();
    const miniRaw = (r["Mini-App"] ?? "").trim();
    const miniClean = cleanMiniApp(miniRaw);
    const arr = (r["ARR"] ?? "").trim() || (r["TotalARR"] ?? "").trim();
    const priority = (r["Priority"] ?? "").trim();

    const chosenName = displayEs || displayEn;

    // Drop reasons
    let drop: string | null = null;
    if (!chosenName) drop = "empty_name";
    else if (chosenName === "Sin título") drop = "placeholder";
    else if (parent) drop = "subitem";  // is a sub-feature
    else if (/^\[WA\]/i.test(chosenName)) drop = "workaround";
    else if (status === "NTH") drop = "nth";
    else if (/\(v\s*\d|\(V\d|—\s*v\d/i.test(chosenName)) drop = "version_specific";
    else if (/^Tab\s+/i.test(chosenName) || / - Filtros$| - Gráfico\s+\d/.test(chosenName)) drop = "granular_tab";
    else if (!MINI_APP_MAP[miniClean]) drop = "orphan_mini_app";

    if (drop) {
      switch (drop) {
        case "workaround": STATS.dropped_wa++; break;
        case "subitem": STATS.dropped_subitem++; break;
        case "nth": STATS.dropped_nth++; break;
        case "version_specific": STATS.dropped_version++; break;
        case "orphan_mini_app": STATS.dropped_orphan_mini++; break;
        case "empty_name": case "placeholder": STATS.dropped_empty++; break;
        case "granular_tab": STATS.dropped_granular++; break;
      }
      continue;
    }

    STATS.kept++;
    const moduleCode = MINI_APP_MAP[miniClean]!;
    const key = chosenName.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
    const dbRow = dbByDisplay.get(key);
    const mentions = dbRow ? (useCounts.get(dbRow.code) ?? 0) : 0;

    candidates.push({
      csv_code_hint: (r["ID"] ?? "").trim() || (r["code"] ?? "").trim(),
      display_en: displayEn,
      display_es: displayEs,
      mini_app: miniClean,
      suggested_module: moduleCode,
      status,
      priority,
      arr,
      db_code: dbRow?.code ?? null,
      db_is_seed: dbRow?.is_seed ?? null,
      mentions,
    });
  }

  console.log("Filtros aplicados:");
  console.log(`  total CSV               : ${STATS.total}`);
  console.log(`  - workarounds [WA]      : ${STATS.dropped_wa}`);
  console.log(`  - sub-items             : ${STATS.dropped_subitem}`);
  console.log(`  - NTH                   : ${STATS.dropped_nth}`);
  console.log(`  - versiones (v1.5, V2)  : ${STATS.dropped_version}`);
  console.log(`  - mini-app huérfana     : ${STATS.dropped_orphan_mini}`);
  console.log(`  - vacíos/placeholders   : ${STATS.dropped_empty}`);
  console.log(`  - granulares (Tab X)    : ${STATS.dropped_granular}`);
  console.log(`  = CANDIDATAS finales    : ${STATS.kept}\n`);

  // 5. Group by hr_category → A/B/C
  const groups: Record<"A" | "B" | "C", Candidate[]> = { A: [], B: [], C: [] };
  for (const c of candidates) {
    const cat = modCategory.get(c.suggested_module!);
    const group = (cat && CATEGORY_TO_GROUP[cat]) || "C";
    groups[group].push(c);
  }

  // Sort each group by module + mentions desc
  for (const g of ["A", "B", "C"] as const) {
    groups[g].sort((a, b) => {
      if (a.suggested_module !== b.suggested_module) return (a.suggested_module ?? "").localeCompare(b.suggested_module ?? "");
      return b.mentions - a.mentions;
    });
  }

  // 6. Write output files
  for (const g of ["A", "B", "C"] as const) {
    const outPath = path.join(process.cwd(), "..", "data", `features-stage1-${g}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
      group: g,
      categories: Object.entries(CATEGORY_TO_GROUP).filter(([, v]) => v === g).map(([k]) => k),
      total: groups[g].length,
      candidates: groups[g],
    }, null, 2));
    console.log(`Grupo ${g}: ${groups[g].length} candidatas → ${path.relative(process.cwd(), outPath)}`);
  }

  // 7. Summary of features-per-module
  console.log(`\nFeatures por módulo (post-filtro):`);
  const byMod = new Map<string, number>();
  for (const c of candidates) byMod.set(c.suggested_module!, (byMod.get(c.suggested_module!) ?? 0) + 1);
  for (const [mod, n] of [...byMod.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${mod.padEnd(28)} ${n}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
