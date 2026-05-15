/* eslint-disable no-console */
/**
 * Consolida features LLM-detectadas con las canónicas del CSV vía embeddings.
 *
 * Strategy:
 *   1. Pull all tax_feature_names rows
 *   2. Split en dos grupos:
 *      - LLM_DETECTED: rows pre-import (creadas antes del bulk INSERT)
 *      - CSV_CANONICAL: rows insertadas hoy con is_seed=true via apply-roadmap-features.ts
 *      Heurística para separar: `created_at` antes o después del cutoff
 *   3. Genera embeddings de cada display_name (OpenAI text-embedding-3-small)
 *   4. Para cada LLM_DETECTED, encuentra el CSV_CANONICAL más cercano
 *   5. Aplica solo matches con cosine ≥ 0.88
 *   6. SAFE OPERATION:
 *      - UPDATE solamente `tax_feature_names.display_name` y `suggested_module`
 *      - NO toca códigos, NO toca transcript_insights, NO borra nada
 *      - El cambio se ve retroactivo vía el JOIN en v_insights_dashboard
 *
 * Costo aproximado: ~$0.50 en embeddings.
 *
 * Usage:
 *   npx tsx scripts/consolidate-features.ts --dry   # solo reporte
 *   npx tsx scripts/consolidate-features.ts         # aplicar
 */

import fs from "node:fs";
import path from "node:path";

const envPath = path.join(process.cwd(), ".env.qa");
for (const rawLine of fs.readFileSync(envPath, "utf8").split("\n")) {
  const line = rawLine.replace(/\r$/, "");
  const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
  if (m) {
    // vercel env pull a veces deja "\n" literal (backslash + n) al final.
    const raw = (m[2] ?? m[3] ?? "").trim();
    process.env[m[1]] ??= raw.replace(/\\n$/, "").replace(/\\n/g, "").trim();
  }
}

import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const dryRun = process.argv.includes("--dry");
const APPLY_THRESHOLD = 0.88;        // aplicar
const REPORT_THRESHOLD = 0.80;       // mostrar pero no aplicar
const CUTOFF_DATE = "2026-05-13";    // todo lo creado hoy = del CSV import

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

type Feature = { code: string; display_name: string; suggested_module: string | null; is_seed: boolean | null; created_at: string };

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(texts: string[]): Promise<number[][]> {
  // OpenAI permite hasta 2048 inputs por call. Batches de 500 para no pasarse.
  const out: number[][] = [];
  const BATCH = 500;
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH);
    const res = await openai.embeddings.create({ model: "text-embedding-3-small", input: slice });
    for (const r of res.data) out.push(r.embedding);
    process.stdout.write(`  embed ${Math.min(i + BATCH, texts.length)}/${texts.length}\r`);
  }
  process.stdout.write("\n");
  return out;
}

async function main() {
  console.log(`Consolidate features (dry-run=${dryRun})\n`);

  // ── Pull all features ─────────────────────────────────────
  const all: Feature[] = [];
  let off = 0;
  while (true) {
    const { data, error } = await supabase
      .from("tax_feature_names")
      .select("code,display_name,suggested_module,is_seed,created_at")
      .range(off, off + 999);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...(data as Feature[]));
    if (data.length < 1000) break;
    off += 1000;
  }
  console.log(`tax_feature_names total: ${all.length}`);

  // ── Split por created_at ──────────────────────────────────
  const llmDetected = all.filter((f) => f.created_at < CUTOFF_DATE);
  const csvCanonical = all.filter((f) => f.created_at >= CUTOFF_DATE);
  console.log(`  LLM-detected (pre ${CUTOFF_DATE}): ${llmDetected.length}`);
  console.log(`  CSV canonical (post ${CUTOFF_DATE}): ${csvCanonical.length}\n`);

  if (csvCanonical.length === 0) { console.error("No CSV canonical features — abort"); return; }

  // ── Embeddings ────────────────────────────────────────────
  console.log(`Embeddings (LLM-detected, ${llmDetected.length})...`);
  const llmEmb = await embed(llmDetected.map((f) => f.display_name));
  console.log(`Embeddings (CSV canonical, ${csvCanonical.length})...`);
  const csvEmb = await embed(csvCanonical.map((f) => f.display_name));

  // ── Nearest neighbor ──────────────────────────────────────
  console.log(`\nMatching...`);
  type Match = { llm: Feature; csv: Feature; sim: number };
  const matches: Match[] = [];
  for (let i = 0; i < llmDetected.length; i++) {
    let bestJ = -1;
    let bestSim = -1;
    for (let j = 0; j < csvCanonical.length; j++) {
      const s = cosine(llmEmb[i], csvEmb[j]);
      if (s > bestSim) { bestSim = s; bestJ = j; }
    }
    if (bestJ >= 0 && bestSim >= REPORT_THRESHOLD) {
      matches.push({ llm: llmDetected[i], csv: csvCanonical[bestJ], sim: bestSim });
    }
  }
  matches.sort((a, b) => b.sim - a.sim);

  const toApply = matches.filter((m) => m.sim >= APPLY_THRESHOLD);
  const borderline = matches.filter((m) => m.sim < APPLY_THRESHOLD && m.sim >= REPORT_THRESHOLD);

  console.log(`\nResultados:`);
  console.log(`  Matches ≥ ${APPLY_THRESHOLD} (se aplicarán):     ${toApply.length}`);
  console.log(`  Matches ${REPORT_THRESHOLD}–${APPLY_THRESHOLD} (sólo report):     ${borderline.length}`);
  console.log(`  Sin match (< ${REPORT_THRESHOLD}):                 ${llmDetected.length - toApply.length - borderline.length}\n`);

  // Filter to only "real" changes — skip if display_name is already identical
  const reallyChanging = toApply.filter((m) => m.llm.display_name !== m.csv.display_name);
  console.log(`De los aplicables, ${reallyChanging.length} cambian display_name (los otros ${toApply.length - reallyChanging.length} ya tienen el mismo).\n`);

  console.log(`Top 25 que cambian:\n`);
  for (const m of reallyChanging.slice(0, 25)) {
    console.log(`  ${m.sim.toFixed(3)}  "${m.llm.display_name}"`);
    console.log(`         → "${m.csv.display_name}"  (mod: ${m.llm.suggested_module ?? "—"} → ${m.csv.suggested_module ?? "—"})`);
  }

  console.log(`\nBorderline (revisión manual sugerida):\n`);
  for (const m of borderline.slice(0, 15)) {
    console.log(`  ${m.sim.toFixed(3)}  "${m.llm.display_name}"  vs  "${m.csv.display_name}"`);
  }

  // Save full report to CSV for review
  const reportLines = ["llm_code,llm_display,csv_code,csv_display,similarity,llm_module,csv_module,action"];
  for (const m of matches) {
    const action = m.sim >= APPLY_THRESHOLD ? (m.llm.display_name === m.csv.display_name ? "skip-already-same" : "apply") : "borderline-review";
    const safe = (s: string) => /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    reportLines.push([m.llm.code, safe(m.llm.display_name), m.csv.code, safe(m.csv.display_name), m.sim.toFixed(4), m.llm.suggested_module ?? "", m.csv.suggested_module ?? "", action].join(","));
  }
  fs.writeFileSync("../data/feature-consolidation-report.csv", reportLines.join("\n"));
  console.log(`\nReporte completo en data/feature-consolidation-report.csv (${matches.length} filas)`);

  if (dryRun) {
    console.log(`\n— DRY RUN — no se aplicó nada. Revisá el reporte CSV y volvé a correr sin --dry para aplicar.`);
    return;
  }

  // ── Aplicar UPDATEs ───────────────────────────────────────
  console.log(`\nAplicando ${reallyChanging.length} UPDATEs (solo display_name, NO toco suggested_module)...`);
  let count = 0;
  for (const m of reallyChanging) {
    // Solo display_name: el JOIN en v_insights_dashboard hace que el cambio
    // se refleje retroactivamente en todos los charts.
    // NO sync suggested_module — la categorización en el CSV no siempre es correcta.
    const { error } = await supabase.from("tax_feature_names").update({ display_name: m.csv.display_name }).eq("code", m.llm.code);
    if (error) { console.error(`  ✗ ${m.llm.code}: ${error.message}`); throw error; }
    count++;
    if (count % 50 === 0) console.log(`  ...${count}/${reallyChanging.length}`);
  }

  console.log(`\n✓ ${count} display_names renombrados`);
  console.log(`✓ NO se tocó transcript_insights ni códigos — los cambios se reflejan via JOIN en v_insights_dashboard`);
}

main().catch((e) => { console.error(e); process.exit(1); });
