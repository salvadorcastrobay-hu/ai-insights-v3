/* eslint-disable no-console */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const envPath = path.join(process.cwd(), ".env.qa");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(?:"([^"]*)"|(.*))$/);
    if (m) process.env[m[1]] ??= m[2] ?? m[3];
  }
}

function mintJwt(email: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload = {
    aud: "authenticated", exp: now + 3600, iat: now, iss: "supabase",
    sub: crypto.randomUUID(), email, phone: "",
    app_metadata: { provider: "email", roles: ["admin"] },
    user_metadata: {}, role: "authenticated", session_id: crypto.randomUUID(),
  };
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const si = `${b64(header)}.${b64(payload)}`;
  const sig = crypto.createHmac("sha256", secret).update(si).digest("base64url");
  return `${si}.${sig}`;
}

const PROD = "https://humand-insights-web.vercel.app";
const ROUTE = `${PROD}/api/ask-chart`;
const token = mintJwt("qa@humand.co", process.env.SUPABASE_JWT_SECRET!);
const projectRef = "nzjzwtjyfqflhyidbacq";
const cookieName = `sb-${projectRef}-auth-token`;
const cookieValue = `base64-${Buffer.from(JSON.stringify({
  access_token: token, refresh_token: "fake", expires_in: 3600,
  expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: "bearer",
  user: { id: crypto.randomUUID(), email: "qa@humand.co", role: "authenticated", aud: "authenticated", app_metadata: { roles: ["admin"] }, user_metadata: {} },
})).toString("base64")}`;

async function ask(question: string, pathname: string, chartContext: unknown) {
  const res = await fetch(ROUTE, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${token}`,
      "Cookie": `${cookieName}=${cookieValue}`,
    },
    body: JSON.stringify({ question, pathname, filters: {}, chartContext }),
  });
  if (!res.ok) { console.error(`HTTP ${res.status}: ${await res.text()}`); return ""; }
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let out = "";
  while (true) { const { done, value } = await reader.read(); if (done) break; out += dec.decode(value); }
  return out;
}

// --- Chart fixtures ---
const PAINS = {
  chartTitle: "Top 10 Pains", chartKind: "horizontal-bar",
  dimension: "insight_subtype_display", scopeType: "pain",
  rows: [
    { label: "Procesos manuales", value: 9531 },
    { label: "Herramientas fragmentadas", value: 5736 },
    { label: "Sin autogestion", value: 2681 },
    { label: "Baja adopcion", value: 2580 },
    { label: "Cuellos de botella", value: 1553 },
    { label: "Empleados inalcanzables", value: 1519 },
    { label: "HR saturado en operacion", value: 1407 },
    { label: "Sin estandarizacion", value: 1273 },
    { label: "Dolor de reportes", value: 874 },
    { label: "Informacion que no llega", value: 714 },
  ],
};

const COMPETITORS = {
  chartTitle: "Ranking Competidores", chartKind: "horizontal-bar",
  dimension: "competitor_name", scopeType: "competitive_signal",
  rows: [
    { label: "SAP SuccessFactors", value: 528 },
    { label: "Workplace (Meta)", value: 253 },
    { label: "Buk", value: 185 },
    { label: "Visma", value: 122 },
    { label: "Microsoft Viva Engage", value: 119 },
    { label: "Factorial", value: 110 },
    { label: "Microsoft Teams", value: 95 },
    { label: "Workday", value: 91 },
    { label: "Sólides", value: 63 },
  ],
};

const FRICTIONS = {
  chartTitle: "Top Fricciones", chartKind: "horizontal-bar",
  dimension: "friction_subtype", scopeType: "deal_friction",
  rows: [
    { label: "Restriccion presupuestaria", value: 2067 },
    { label: "Timing desalineado", value: 1325 },
    { label: "Falta decisor", value: 467 },
    { label: "Desalineacion interna", value: 450 },
    { label: "Justificacion de ROI", value: 231 },
    { label: "Resistencia al cambio", value: 217 },
    { label: "Complejidad tecnica", value: 145 },
  ],
};

const FEATURES = {
  chartTitle: "Top Features Faltantes", chartKind: "horizontal-bar",
  dimension: "feature_display", scopeType: "product_gap",
  rows: [
    { label: "Integracion de nomina", value: 1977 },
    { label: "Digital Signature", value: 1445 },
    { label: "Integracion con relojes biometricos", value: 1367 },
    { label: "Acceso API", value: 1229 },
    { label: "Distribucion de recibos de sueldo", value: 1018 },
  ],
};

type Case = {
  label: string;
  q: string;
  path: string;
  chart: unknown;
  checks: Array<{ name: string; test: (out: string) => boolean | string }>;
};

const contains = (s: string, ...tokens: string[]) =>
  tokens.every((t) => s.toLowerCase().includes(t.toLowerCase()));
const notContains = (s: string, t: string) => !s.toLowerCase().includes(t.toLowerCase());
const countOccurrences = (s: string, t: string) =>
  (s.toLowerCase().match(new RegExp(t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;

const CASES: Case[] = [
  // --- Baseline sanity ---
  {
    label: "PAIN parent drill (Procesos manuales)",
    path: "/executive-summary", chart: PAINS,
    q: "a que se refieren los leads con procesos manuales?",
    checks: [
      { name: "bullets labeled verbatim", test: (o) => contains(o, "Vacaciones y Licencias") && contains(o, "Control Horario") && contains(o, "Legajo Digital") },
      { name: "Otros bullet present", test: (o) => contains(o, "Otros sub-temas") },
      { name: "real count 1562", test: (o) => contains(o, "1562") },
    ],
  },
  // --- Cross-parent sub-label (the main fix) ---
  {
    label: "SUB-LABEL drill across parents (Control Horario)",
    path: "/executive-summary", chart: PAINS,
    q: "y que seria control horario?",
    checks: [
      { name: "inverted breakdown by parent", test: (o) => contains(o, "Procesos manuales") && contains(o, "Herramientas fragmentadas") },
      { name: "not 5x Control Horario repetition", test: (o) => {
        // allow "Control Horario" in intro/summary, but not 4+ as bullet labels
        const bulletMatches = (o.match(/^-\s*\*\*Control Horario\*\*/gm) || []).length;
        return bulletMatches <= 1 || `got ${bulletMatches} bullet labels named Control Horario`;
      }},
      { name: "no fabricated 0% Otros", test: (o) => !contains(o, "Otros sub-temas · 0 menciones") && !contains(o, "Otros sub-temas** · 0") },
    ],
  },
  // --- Competitors ---
  {
    label: "COMPETITOR drill (SAP SuccessFactors)",
    path: "/competitive-intelligence", chart: COMPETITORS,
    q: "qué relación tienen los prospects con SAP SuccessFactors?",
    checks: [
      { name: "uses relationship labels", test: (o) =>
        contains(o, "Usa actualmente") || contains(o, "Evaluando") || contains(o, "Migrando") || contains(o, "Uso anterior") || contains(o, "Mencionado") || contains(o, "Descartado") },
      { name: "mentions SAP", test: (o) => contains(o, "SAP") },
    ],
  },
  {
    label: "COMPETITOR drill (Buk)",
    path: "/competitive-intelligence", chart: COMPETITORS,
    q: "qué onda con buk?",
    checks: [
      { name: "not hallucinated", test: (o) => contains(o, "Buk") },
      { name: "some relationship breakdown", test: (o) =>
        contains(o, "Usa actualmente") || contains(o, "Migrando") || contains(o, "Evaluando") || contains(o, "Mencionado") },
    ],
  },
  // --- Frictions ---
  {
    label: "FRICTION drill (Timing desalineado)",
    path: "/sales-enablement", chart: FRICTIONS,
    q: "qué significa timing desalineado?",
    checks: [
      { name: "mentions deal stages", test: (o) =>
        contains(o, "Discovery") || contains(o, "Demo") || contains(o, "Negociation") || contains(o, "Negotiation") || contains(o, "Closed") || contains(o, "postponed") || contains(o, "Postponed") || contains(o, "Qualification") },
      { name: "Otros bullet", test: (o) => contains(o, "Otros sub-temas") },
    ],
  },
  // --- Features ---
  {
    label: "FEATURE drill (Digital Signature)",
    path: "/product-gaps-detail", chart: FEATURES,
    q: "a que se refieren con digital signature?",
    checks: [
      { name: "module breakdown", test: (o) => contains(o, "Documentos") || contains(o, "Legajo") || contains(o, "Onboarding") },
      { name: "not gap_priority fallback", test: (o) => !contains(o, "must_have") && !contains(o, "nice_to_have") },
    ],
  },
  // --- Non-recognized sub-label ---
  {
    label: "UNKNOWN sub-label (fake term)",
    path: "/executive-summary", chart: PAINS,
    q: "que onda con blockchain de recursos humanos?",
    checks: [
      { name: "doesn't invent", test: (o) => contains(o, "no") || contains(o, "sin") || contains(o, "no aparece") || contains(o, "no figura") || contains(o, "no hay") || contains(o, "no se menciona") || o.length < 400 },
      { name: "no fabricated counts", test: (o) => !/blockchain\s*·\s*\d+/i.test(o) },
    ],
  },
  // --- Comparative question (numeric) ---
  {
    label: "NUMERIC question",
    path: "/executive-summary", chart: PAINS,
    q: "cuál es el pain con más menciones y cuánto representa?",
    checks: [
      { name: "top pain name", test: (o) => contains(o, "Procesos manuales") },
      { name: "value visible", test: (o) => contains(o, "9531") || contains(o, "9,531") || contains(o, "9.531") },
    ],
  },
  // --- English question on Spanish data ---
  {
    label: "ENGLISH question",
    path: "/executive-summary", chart: PAINS,
    q: "what are customers complaining about?",
    checks: [
      { name: "responds in Spanish (per prompt)", test: (o) => contains(o, "procesos") || contains(o, "herramientas") || contains(o, "manual") },
    ],
  },
  // --- Intent: recommend action ---
  {
    label: "RECOMMENDATION intent",
    path: "/executive-summary", chart: PAINS,
    q: "qué deberíamos priorizar en producto para reducir estos pains?",
    checks: [
      { name: "marks hypothesis", test: (o) => contains(o, "hipótesis") || contains(o, "hipotesis") || contains(o, "recomend") },
      { name: "references real pains", test: (o) => contains(o, "Procesos manuales") || contains(o, "Herramientas fragmentadas") },
    ],
  },
];

async function main() {
  let pass = 0, fail = 0;
  const failures: string[] = [];
  for (let i = 0; i < CASES.length; i++) {
    const c = CASES[i];
    process.stdout.write(`\n[${i+1}/${CASES.length}] ${c.label}\n  Q: ${c.q}\n`);
    const out = await ask(c.q, c.path, c.chart);
    const preview = out.length > 800 ? out.slice(0, 800) + "\n  ..." : out;
    console.log("  " + preview.split("\n").join("\n  "));
    for (const chk of c.checks) {
      const r = chk.test(out);
      if (r === true) { pass++; console.log(`  ✓ ${chk.name}`); }
      else { fail++; const msg = typeof r === "string" ? r : "failed"; console.log(`  ✗ ${chk.name} — ${msg}`); failures.push(`[${c.label}] ${chk.name}: ${msg}`); }
    }
  }
  console.log(`\n\n========== SUMMARY ==========`);
  console.log(`PASS ${pass} / FAIL ${fail} (total ${pass+fail} checks across ${CASES.length} cases)`);
  if (failures.length) {
    console.log("\nFAILURES:");
    failures.forEach((f) => console.log(" - " + f));
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
