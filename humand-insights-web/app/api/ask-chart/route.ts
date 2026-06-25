import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

import { resolveChatModel } from "@/lib/chat-models";

import { applyFilters, EMPTY_FILTERS, type Filters } from "@/lib/data/filters";
import { loadInsights } from "@/lib/supabase/queries";
import { getAuthenticatedSession } from "@/lib/supabase/server";
import type { InsightRow } from "@/lib/supabase/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type DrillDimension =
  | "pain_theme"
  | "competitor_name"
  | "feature_display"
  | "friction_subtype"
  | "module_display"
  | "insight_subtype_display";
type DrillScope = "pain" | "product_gap" | "competitive_signal" | "deal_friction" | "faq";

type ChartContext = {
  chartTitle: string;
  chartKind?: string;
  description?: string;
  rows: Array<{
    label: string;
    value: number | null;
    extra?: Record<string, string | number | null | undefined>;
  }>;
  dimension?: DrillDimension;
  scopeType?: DrillScope;
  notes?: string;
};

function matchDimension(row: InsightRow, dim: DrillDimension, value: string): boolean {
  const norm = (v: unknown) => (v == null ? "" : String(v).trim());
  switch (dim) {
    case "pain_theme":
      return norm(row.pain_theme) === value;
    case "competitor_name":
      return norm(row.competitor_name) === value;
    case "feature_display":
      return norm(row.feature_display) === value;
    case "module_display":
      return norm(row.module_display) === value;
    case "friction_subtype":
      return row.insight_type === "deal_friction" && norm(row.insight_subtype_display) === value;
    case "insight_subtype_display":
      return norm(row.insight_subtype_display) === value;
  }
}

function subKeyFor(dim: DrillDimension): keyof InsightRow {
  switch (dim) {
    case "pain_theme":
      return "insight_subtype_display";
    case "competitor_name":
      return "competitor_relationship_display";
    case "feature_display":
      return "module_display";
    case "friction_subtype":
      return "deal_stage";
    case "module_display":
      return "module_status";
    case "insight_subtype_display":
      return "module_display";
  }
}

function pickRepresentativeRows(rows: InsightRow[], limit: number): InsightRow[] {
  // Prefer rows with a verbatim quote, ranked by confidence desc then recency.
  const withQuote = rows.filter((r) => r.verbatim_quote && r.verbatim_quote.trim().length > 0);
  const ranked = [...withQuote].sort((a, b) => {
    const c = (b.confidence ?? 0) - (a.confidence ?? 0);
    if (c !== 0) return c;
    return (b.call_date ?? "").localeCompare(a.call_date ?? "");
  });
  const rest = rows.filter((r) => !r.verbatim_quote || !r.verbatim_quote.trim().length);
  return [...ranked, ...rest].slice(0, limit);
}

function sanitize(s: string | null | undefined, maxLen = 240): string {
  if (!s) return "";
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + "…" : clean;
}

function buildRowEvidence(
  rows: InsightRow[],
  dim: DrillDimension,
  label: string,
  subKeyOverride?: keyof InsightRow,
): string {
  const matched = rows.filter((r) => matchDimension(r, dim, label));
  if (!matched.length) return "";

  // Sub-breakdown
  const subKey = subKeyOverride ?? subKeyFor(dim);
  const subCounts = new Map<string, number>();
  for (const r of matched) {
    const v = r[subKey];
    if (v == null) continue;
    const k = String(v).trim();
    if (!k) continue;
    subCounts.set(k, (subCounts.get(k) ?? 0) + 1);
  }
  const subTop = [...subCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);

  // Representative rows with verbatims + summaries. We pull ~25 so the model
  // has enough material to cluster into sub-themes and pick ilustrative quotes.
  const sample = pickRepresentativeRows(matched, 25);
  const quoteLines = sample.map((r, i) => {
    const bits: string[] = [];
    bits.push(`    ${i + 1}. resumen: ${sanitize(r.summary, 200)}`);
    if (r.verbatim_quote) bits.push(`       cita: "${sanitize(r.verbatim_quote, 240)}"`);
    const meta: string[] = [];
    if (r.company_name) meta.push(r.company_name);
    if (r.segment) meta.push(r.segment);
    if (r.region) meta.push(r.region);
    if (r.insight_subtype_display) meta.push(r.insight_subtype_display);
    if (meta.length) bits.push(`       meta: ${meta.join(" · ")}`);
    return bits.join("\n");
  });

  const totalInsights = matched.length;
  const totalCalls = new Set(matched.map((r) => r.transcript_id).filter(Boolean)).size;
  const header = `- "${label}" — TOTALES REALES: ${totalInsights} insights en ${totalCalls} calls`;
  let subLine = "";
  if (subTop.length) {
    const shownSum = subTop.reduce((acc, [, n]) => acc + n, 0);
    const othersCount = Math.max(0, totalInsights - shownSum);
    const othersPct = totalInsights ? Math.round((othersCount / totalInsights) * 100) : 0;
    const lines = subTop.map(([k, n]) => {
      const pct = totalInsights ? Math.round((n / totalInsights) * 100) : 0;
      return `    · ${k}: ${n} (${pct}%)`;
    });
    if (othersCount > 0) {
      lines.push(`    · Otros sub-temas (cola larga): ${othersCount} (${othersPct}%)`);
    }
    subLine = `  CONTEOS REALES POR SUB-TEMA (universo completo, no la muestra) — ${String(subKey).replace(/_/g, " ")}:\n${lines.join("\n")}`;
  }
  const sampleHeader = quoteLines.length
    ? `  MUESTRA DE ${quoteLines.length} CITAS (ilustrativas, no exhaustivas):`
    : "";
  return [header, subLine, sampleHeader, ...quoteLines].filter(Boolean).join("\n");
}

type Body = {
  question: string;
  pathname?: string;
  filters?: Partial<Filters>;
  chartContext?: ChartContext | null;
  model?: string;
};

const PAGE_LABELS: Record<string, string> = {
  "/executive-summary": "Executive Summary",
  "/product-intelligence": "Product Intelligence",
  "/competitive-intelligence": "Competitive Intelligence",
  "/sales-enablement": "Sales Enablement",
  "/regional-gtm": "Regional / GTM",
  "/pains-detail": "Pains Detail",
  "/product-gaps-detail": "Product Gaps Detail",
  "/faq-detail": "FAQ Detail",
  "/comparative-analysis": "Comparative Analysis",
  "/custom-dashboards": "Custom Dashboards",
  "/glossary": "Glossary",
};

function topN(rows: InsightRow[], key: keyof InsightRow, n = 10): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const v = r[key];
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

function uniqueCount(rows: InsightRow[], key: keyof InsightRow): number {
  const s = new Set<string>();
  for (const r of rows) {
    const v = r[key];
    if (v) s.add(String(v));
  }
  return s.size;
}

function revenueSum(rows: InsightRow[]): number {
  const byDeal = new Map<string, number>();
  for (const r of rows) {
    if (r.deal_id && !byDeal.has(r.deal_id)) {
      byDeal.set(r.deal_id, r.amount ?? 0);
    }
  }
  let sum = 0;
  for (const v of byDeal.values()) sum += v;
  return sum;
}

function fmtList(pairs: Array<[string, number]>): string {
  if (!pairs.length) return "  (sin datos)";
  return pairs.map(([label, n]) => `  - ${label}: ${n}`).join("\n");
}

// Pain × Región (% de demos en esa región). Replica la lógica del heatmap de
// /regional-gtm para que el chat libre tenga la matriz cuando el usuario
// pregunta "qué pasa con X pain en Y región" sin clickear el chart.
function buildPainRegionMatrix(rows: InsightRow[]): string {
  const pains = rows.filter((r) => r.insight_type === "pain");
  if (pains.length === 0) return "";

  const demosByRegion = new Map<string, Set<string>>();
  const painByRegion = new Map<string, Map<string, Set<string>>>();
  for (const row of pains) {
    if (!row.region || !row.transcript_id) continue;
    const sub = row.insight_subtype_display;
    if (!sub) continue;
    const ds = demosByRegion.get(row.region) ?? new Set<string>();
    ds.add(row.transcript_id);
    demosByRegion.set(row.region, ds);
    const m = painByRegion.get(row.region) ?? new Map<string, Set<string>>();
    const s = m.get(sub) ?? new Set<string>();
    s.add(row.transcript_id);
    m.set(sub, s);
    painByRegion.set(row.region, m);
  }
  if (painByRegion.size === 0) return "";

  // Regiones ordenadas por # demos
  const regions = [...demosByRegion.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .map(([r]) => r);

  // Top 5 pains globales por demos únicas
  const globalPain = new Map<string, Set<string>>();
  for (const [, m] of painByRegion) {
    for (const [pain, set] of m) {
      const acc = globalPain.get(pain) ?? new Set<string>();
      for (const t of set) acc.add(t);
      globalPain.set(pain, acc);
    }
  }
  const topPains = [...globalPain.entries()]
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 8)
    .map(([p]) => p);

  const header = `PAIN × REGIÓN (% de demos en esa región — top ${topPains.length} pains × ${regions.length} regiones):`;
  const colHeader = `  pain \\ región | ${regions.map((r) => `${r} (n=${demosByRegion.get(r)?.size ?? 0})`).join(" | ")}`;
  const lines = topPains.map((pain) => {
    const cells = regions.map((region) => {
      const demosInRegion = demosByRegion.get(region)?.size ?? 0;
      const demosWithPain = painByRegion.get(region)?.get(pain)?.size ?? 0;
      if (demosInRegion === 0 || demosWithPain === 0) return "—";
      const pct = (demosWithPain / demosInRegion) * 100;
      return `${pct.toFixed(1)}% (${demosWithPain}/${demosInRegion})`;
    });
    return `  ${pain} | ${cells.join(" | ")}`;
  });
  return [header, colHeader, ...lines].join("\n");
}

// Detect "what does X mean" questions in any phrasing
function extractMeaningTarget(question: string): string | null {
  const patterns = [
    /(?:qué es|qué son|qué significa(?:n)?|a qué se refier(?:en|e)(?: con)?|explicame|explica(?:me)?|qué quiere(?:n)? decir|qué engloba|qué incluye|qué contempla|qué hay en|qué comprende|describime|describe)\s+["']?([^¿?]+?)["']?\s*\??$/i,
    /["']([^"']+?)["']\s*[–—-]?\s*(?:qué es|qué significa|a qué se refiere|qué contempla)/i,
  ];
  for (const p of patterns) {
    const m = question.match(p);
    if (m?.[1]) return m[1].trim().replace(/[¿?]/g, "").trim();
  }
  return null;
}

// Find the best-matching dimension label in the dataset for a user's free-text query
function findDimensionMatch(
  rows: InsightRow[],
  candidate: string,
): { dim: DrillDimension; label: string } | null {
  const checks: Array<{ dim: DrillDimension; key: keyof InsightRow }> = [
    { dim: "pain_theme", key: "pain_theme" },
    { dim: "insight_subtype_display", key: "insight_subtype_display" },
    { dim: "feature_display", key: "feature_display" },
    { dim: "module_display", key: "module_display" },
    { dim: "competitor_name", key: "competitor_name" },
  ];
  const cand = candidate.toLowerCase();
  for (const { dim, key } of checks) {
    const values = new Set<string>();
    for (const r of rows) {
      const v = r[key];
      if (v != null) values.add(String(v).trim());
    }
    // exact (case-insensitive) → starts-with → contains
    for (const mode of ["exact", "starts", "contains"] as const) {
      for (const v of values) {
        const vl = v.toLowerCase();
        const hit =
          mode === "exact" ? vl === cand :
          mode === "starts" ? vl.startsWith(cand) || cand.startsWith(vl) :
          vl.includes(cand) || cand.includes(vl);
        if (hit && v.length >= 4) return { dim, label: v };
      }
    }
  }
  return null;
}

function buildContext(rows: InsightRow[], pathname: string, filters: Filters): string {
  const pageLabel = PAGE_LABELS[pathname] ?? pathname;

  const activeFilters: string[] = [];
  for (const k of Object.keys(filters) as (keyof Filters)[]) {
    const v = filters[k];
    if (Array.isArray(v) && v.length) activeFilters.push(`${k}=[${v.join(", ")}]`);
    else if (typeof v === "string" && v) activeFilters.push(`${k}=${v}`);
  }

  const totals = {
    insights: rows.length,
    unique_transcripts: uniqueCount(rows, "transcript_id"),
    unique_deals: uniqueCount(rows, "deal_id"),
    revenue_usd: revenueSum(rows),
  };

  const pains = rows.filter((r) => r.insight_type === "pain");
  const productGaps = rows.filter((r) => r.insight_type === "product_gap");
  const competitive = rows.filter((r) => r.insight_type === "competitive_signal");
  const frictions = rows.filter((r) => r.insight_type === "deal_friction");
  const faqs = rows.filter((r) => r.insight_type === "faq");

  return [
    `PÁGINA ACTUAL: ${pageLabel}`,
    `FILTROS ACTIVOS: ${activeFilters.length ? activeFilters.join("; ") : "(ninguno)"}`,
    "",
    "TOTALES (dataset filtrado):",
    `  insights: ${totals.insights}`,
    `  calls únicas: ${totals.unique_transcripts}`,
    `  deals únicos: ${totals.unique_deals}`,
    `  revenue (USD): ${totals.revenue_usd.toLocaleString("en-US")}`,
    "",
    `BREAKDOWN POR TIPO:`,
    `  pains: ${pains.length} | product_gaps: ${productGaps.length} | competitive: ${competitive.length} | frictions: ${frictions.length} | faqs: ${faqs.length}`,
    "",
    `TOP REGIONES:\n${fmtList(topN(rows, "region"))}`,
    "",
    `TOP PAÍSES:\n${fmtList(topN(rows, "country"))}`,
    "",
    `TOP SEGMENTOS:\n${fmtList(topN(rows, "segment"))}`,
    "",
    `TOP INDUSTRIAS:\n${fmtList(topN(rows, "industry"))}`,
    "",
    `TOP PAINS (pain_theme):\n${fmtList(topN(pains, "pain_theme"))}`,
    "",
    `TOP MÓDULOS:\n${fmtList(topN(rows, "module_display"))}`,
    "",
    `TOP COMPETIDORES (excl. own-brand):\n${fmtList(
      topN(
        competitive.filter((r) => !r.is_own_brand_competitor),
        "competitor_name",
      ),
    )}`,
    "",
    `TOP FEATURE GAPS:\n${fmtList(topN(productGaps, "feature_display"))}`,
    "",
    `TOP FRICCIONES (insight_subtype_display):\n${fmtList(topN(frictions, "insight_subtype_display"))}`,
    "",
    `TOP FAQs (insight_subtype_display):\n${fmtList(topN(faqs, "insight_subtype_display"))}`,
    "",
    buildPainRegionMatrix(rows),
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(req: Request) {
  const session = await getAuthenticatedSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  // Pre-check de cuota: este chat llama a OpenAI directo (no pasa por el
  // servicio Python parcheado), así que el token limiter no lo cubriría solo.
  // Chequeamos contra el mismo cap vía /usage/guard. Fail-open si Python no
  // responde (no rompemos el chat por un check caído).
  const pyBase = process.env.PYTHON_SERVICE_URL?.replace(/\/$/, "") ?? null;
  if (pyBase) {
    try {
      const guard = await fetch(`${pyBase}/usage/guard`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "content-type": "application/json",
        },
        cache: "no-store",
      });
      if (guard.status === 429) {
        const text = await guard.text();
        return new Response(text, {
          status: 429,
          headers: { "content-type": "application/json" },
        });
      }
    } catch (e) {
      console.error("[ask-chart] usage guard failed (fail-open):", e);
    }
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) return new Response("question required", { status: 400 });

  const pathname = body.pathname ?? "/";
  const filters: Filters = { ...EMPTY_FILTERS, ...(body.filters ?? {}) };
  const chartCtx = body.chartContext ?? null;

  let context: string;
  let scopeHint: string;
  let isSpecificDrill = false;
  let specificLabel = "";

  if (chartCtx && Array.isArray(chartCtx.rows) && chartCtx.rows.length > 0) {
    // Chart-scoped: ground on exactly what the user sees, no DB read needed.
    const activeFilters: string[] = [];
    for (const k of Object.keys(filters) as (keyof Filters)[]) {
      const v = filters[k];
      if (Array.isArray(v) && v.length) activeFilters.push(`${k}=[${v.join(", ")}]`);
      else if (typeof v === "string" && v) activeFilters.push(`${k}=${v}`);
    }
    const sum = chartCtx.rows.reduce((acc, r) => acc + (Number(r.value) || 0), 0);
    const lines = chartCtx.rows.slice(0, 50).map((r, i) => {
      const extras = r.extra
        ? " (" + Object.entries(r.extra)
            .filter(([, v]) => v !== null && v !== undefined && v !== "")
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ") + ")"
        : "";
      return `  ${i + 1}. ${r.label} → ${r.value ?? "—"}${extras}`;
    });
    const baseLines = [
      `PÁGINA ACTUAL: ${PAGE_LABELS[pathname] ?? pathname}`,
      `GRÁFICO: ${chartCtx.chartTitle}${chartCtx.chartKind ? ` (${chartCtx.chartKind})` : ""}`,
      chartCtx.description ? `DESCRIPCIÓN: ${chartCtx.description}` : null,
      `FILTROS ACTIVOS: ${activeFilters.length ? activeFilters.join("; ") : "(ninguno)"}`,
      "",
      `DATOS VISIBLES (${chartCtx.rows.length} filas, suma=${sum}):`,
      ...lines,
      chartCtx.notes ? `\nNOTAS: ${chartCtx.notes}` : "",
    ].filter(Boolean);

    // Evidence enrichment: when the chart declares a drill dimension, load the
    // insights for the same filters and attach per-row verbatim quotes so the
    // model can answer "¿qué significa X?" / "¿a qué se refieren con X?" with
    // real language instead of hedging.
    if (chartCtx.dimension) {
      try {
        const allRows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0");
        const filtered = applyFilters(allRows, filters);
        const scoped = chartCtx.scopeType
          ? filtered.filter((r) => r.insight_type === chartCtx.scopeType)
          : filtered;
        const topLabels = chartCtx.rows.slice(0, 10).map((r) => r.label);
        const evidenceBlocks = topLabels
          .map((label) => buildRowEvidence(scoped, chartCtx.dimension as DrillDimension, label))
          .filter(Boolean);
        if (evidenceBlocks.length) {
          baseLines.push("", "EVIDENCIA POR FILA (citas reales de llamadas):", ...evidenceBlocks);
        }

        // Question-aware follow-up: if the user's question name-drops a
        // sub-theme that appears as a sub-label inside the evidence blocks
        // (e.g. "qué es Control Horario" when Control Horario is a module
        // that recurs under multiple pains), add a dedicated drill-down
        // block scoped to that sub-label across the full dataset. This
        // avoids the "parent label repeated 5×" failure mode.
        const subKey = subKeyFor(chartCtx.dimension);
        const allSubLabels = new Set<string>();
        for (const r of scoped) {
          const v = r[subKey];
          if (v != null && String(v).trim()) allSubLabels.add(String(v).trim());
        }
        const qLower = question.toLowerCase();
        const hit = [...allSubLabels].find(
          (lbl) => lbl.length >= 4 && qLower.includes(lbl.toLowerCase()),
        );
        if (hit) {
          // Drill the sub-label as its own dimension, and INVERT the
          // sub-breakdown: break down by the original chart dimension so the
          // bullets are meaningful (e.g. "Control Horario breaks into which
          // pain themes it appears under"). Otherwise we'd sub-break by
          // something like module_status (2 values) and the model would
          // fabricate groupings.
          const drillDim: DrillDimension =
            subKey === "module_display" ? "module_display" : "insight_subtype_display";
          const invertedSubKey =
            chartCtx.dimension === "insight_subtype_display" || chartCtx.dimension === "friction_subtype"
              ? ("insight_subtype_display" as keyof InsightRow)
              : chartCtx.dimension === "feature_display"
              ? ("feature_display" as keyof InsightRow)
              : chartCtx.dimension === "competitor_name"
              ? ("competitor_name" as keyof InsightRow)
              : ("insight_subtype_display" as keyof InsightRow);
          const subBlock = buildRowEvidence(scoped, drillDim, hit, invertedSubKey);
          if (subBlock) {
            isSpecificDrill = true;
            specificLabel = hit;
            baseLines.push(
              "",
              `EVIDENCIA ESPECÍFICA — el usuario nombró "${hit}". Este bloque es la fuente de verdad para responder sobre "${hit}". Los totales y los conteos por padre son el dato duro; las citas de la muestra son la fuente para describirlo en lenguaje natural.`,
              subBlock,
            );
          }
        }
      } catch (e) {
        console.error("[ask-chart] evidence enrichment failed:", e);
      }
    }

    context = baseLines.join("\n");
    scopeHint = `el gráfico "${chartCtx.chartTitle}"`;
  } else {
    // Dashboard-scoped: compute whole-page summary.
    const allRows = await loadInsights(process.env.NEXT_PUBLIC_PROMPT_VERSION ?? "v3.0");
    const filtered = applyFilters(allRows, filters);
    context = buildContext(filtered, pathname, filters);
    scopeHint = `el dashboard actual`;

    // Enrich with verbatim evidence when user asks "qué es / qué significa / a qué se
    // refieren con X" even without a chart context — same quality as chart-scoped mode.
    const meaningTarget = extractMeaningTarget(question);
    if (meaningTarget) {
      const match = findDimensionMatch(filtered, meaningTarget);
      if (match) {
        const evidence = buildRowEvidence(filtered, match.dim, match.label);
        if (evidence) {
          context +=
            `\n\nEVIDENCIA ESPECÍFICA — el usuario preguntó por "${match.label}". ` +
            `Este bloque es la fuente de verdad. Los totales y conteos por sub-tema son el dato duro; ` +
            `las citas de la muestra son la fuente para describir en lenguaje natural.\n${evidence}`;
          isSpecificDrill = true;
          specificLabel = match.label;
        }
      }
    }
  }

  const systemBase = [
    `Sos un analista de insights de ventas B2B respondiendo en español rioplatense sobre ${scopeHint}.`,
    "Respondés estrictamente con los datos que te paso en CONTEXTO. No inventes cifras.",
  ];

  const systemProse = [
    ...systemBase,
    isSpecificDrill
      ? `El usuario te está preguntando específicamente por "${specificLabel}" — quiere entender qué significa en lenguaje natural, no una grilla taxonómica.`
      : "El usuario quiere entender qué hay detrás de una categoría — qué dicen los clientes en sus propias palabras, no una grilla de módulos.",
    "Formato: 2-4 párrafos cortos en prosa fluida. NO uses bullets con '· N menciones (Y%)' como esqueleto de la respuesta. La taxonomía (módulos, sub-tipos, prioridades) es soporte, no la respuesta.",
    "Sub-topics EMERGENTES: leé las citas de la MUESTRA y agrupalas naturalmente en 2-4 matices o variantes que aparezcan repetidas veces — por ejemplo 'gestión por mail/WhatsApp', 'papel/fotocopias', 'Excel/planillas', 'uso de checadores físicos', etc. Los nombres de estos matices los derivás VOS a partir de lo que dicen los clientes, no de la taxonomía interna. Si ves 5 citas que hablan de firmar en papel y 3 que hablan de cargar a Excel, esos son dos matices distintos.",
    "Construí la respuesta así: (1) definición clara de qué es en 1-2 oraciones (podés mencionar el total, ej. 'aparece en ~X insights de Y calls', una sola vez al inicio si aporta), (2) 2-4 párrafos o micro-bullets describiendo los matices emergentes, cada uno ilustrado con 1-2 verbatims entre comillas integrados al texto, (3) opcional — una oración final con color/contexto (ej. 'pega más fuerte en empresas con operación distribuida').",
    "Citas: embebidas en el texto con comillas, no como bullets numerados. Elegí las 4-6 más ilustrativas del bloque MUESTRA, priorizando las que muestren matices distintos. No copies todas, no copies dos que digan lo mismo.",
    "Conteos: si los usás, van siempre del bloque 'TOTALES REALES'. NO uses los números del sub-breakdown por módulo — esa taxonomía es un corte secundario. Si querés dar orden de magnitud de un matiz emergente, usá lenguaje aproximado ('varias menciones', 'la mayoría', 'algunos casos') en vez de inventar un número.",
    "Fidelidad: nunca parafrasees una cita para que diga algo distinto; si la cita dice que algo 'funciona bien', no la uses para ilustrar un problema.",
    "Nunca inventes nombres de clientes, competidores o conceptos que no estén en las citas.",
    "No agregues recomendaciones a menos que el usuario las pida explícitamente. Si te piden recomendaciones, marcalas con '(hipótesis)' al final de cada frase prescriptiva.",
  ].join(" ");

  const systemTaxonomy = [
    ...systemBase,
    "Cuando el usuario pregunte qué significa una categoría/pain/feature/fricción ('qué es X', 'a qué se refieren con X', 'qué significa X'), respondé AGRUPANDO las citas por sub-tema común, no listando cada cita por separado. Usá el bloque 'CONTEOS REALES POR SUB-TEMA' como base de la agrupación.",
    "CRÍTICO — labels exactos: los nombres de sub-tema que uses en los bullets DEBEN ser copiados TEXTUALMENTE del bloque 'CONTEOS REALES POR SUB-TEMA'. No inventes nombres, no los traduzcas, no los acortes, no los reformules. Si el bloque dice 'Procesos manuales y administrativos', tu bullet tiene que decir exactamente eso (podés poner **negritas** alrededor, pero el string va idéntico).",
    "Estructura ideal: una frase introductoria que defina el concepto, luego 2-5 bullets de sub-temas (cada uno con **Sub-tema exacto** · N menciones (Y%) — descripción breve + 1 cita textual ilustrativa entre comillas). Cerrá con una conclusión opcional. Si dos citas dicen lo mismo, agrupalas bajo el mismo bullet.",
    "CRÍTICO — conteos: los números de 'N menciones' y '%' TIENEN que copiarse TEXTUALMENTE del bloque 'CONTEOS REALES POR SUB-TEMA'. Nunca cuentes sobre la muestra de citas (te daría cifras falsas). Nunca sumes o restes a ojo; si dos sub-temas aparecen en el bloque con 530 y 500 menciones, usá esos números literales.",
    "OBLIGATORIO — Otros sub-temas: si el bloque incluye una línea '· Otros sub-temas (cola larga): N (Y%)', TENÉS que cerrar tu respuesta con un bullet final '- **Otros sub-temas** · N menciones (Y%) — cola larga con temas de menor volumen'. No es opcional. Si no aparece esa línea (porque los top cubren ~100%), no la inventes.",
    "Si referenciás un sub-tema que aparece en más de un bloque padre (p. ej. 'Control Horario' aparece como sub-tema de 'Procesos manuales' Y de 'Herramientas fragmentadas'), NUNCA lo listes varias veces sin aclarar el padre. O bien (a) el usuario preguntó específicamente por ese sub-tema y entonces en el prompt hay un bloque 'EVIDENCIA ESPECÍFICA' que tenés que usar exclusivamente, o (b) debés agregar entre paréntesis el padre al que pertenece cada aparición: '**Control Horario (dentro de Procesos manuales)** · 1306 menciones'. Nunca repitas el mismo nombre sin contexto — eso confunde al usuario.",
    "Si tenés citas disponibles, NUNCA digas que no tenés contexto; usalas. Citá las frases textuales entre comillas cuando sirvan de ilustración, pero siempre bajo un sub-tema agrupado.",
    "Regla de fidelidad: no encuadres una cita como 'problema' o 'dolor' si la cita textualmente dice lo contrario (p. ej. el cliente dice que algo 'funciona bien' o 'lo queremos mantener'). En esos casos, descartá esa cita o aclará 'la cita no confirma el pain'. Parafraseá solo lo que la cita efectivamente dice.",
    "Formato: respuestas en Markdown — usá **negritas** para destacar subtemas, listas con `- ` para enumerar, y comillas `\"…\"` para citas verbatim exactas.",
    "Si no hay evidencia para una categoría, decilo sin inventar y sugerí qué filtro ajustar.",
    "Sé conciso: 2-5 bullets o un párrafo corto. Destacá números concretos y citas breves.",
    "REGLA HIPÓTESIS — cuando el usuario pida recomendaciones, prioridades, acciones ('qué priorizar', 'qué deberíamos hacer', 'cómo atacar esto', 'qué sugerís'), CADA frase que contenga una recomendación/sugerencia/priorización DEBE terminar literalmente con el token '(hipótesis)'. No es opcional. Ejemplos correctos: 'atacar primero automatización de flujos (hipótesis)', 'priorizar integración y centralización debería reducir fricción transversal (hipótesis)'. Ejemplo incorrecto: 'esto sugiere atacar automatización' (falta el tag). Los conteos, %, citas textuales son dato y no llevan tag; toda inferencia/recomendación/sugerencia lo lleva sin excepción.",
    "Nunca inventes nombres de clientes, competidores o pains que no aparezcan en el contexto.",
  ].join(" ");

  // Use prose + emergent sub-topics whenever we have per-row verbatim evidence
  // (chart-scoped with dimension, OR generic path that matched a "qué es X" question).
  const hasEvidence = !!chartCtx?.dimension || isSpecificDrill;
  const system = hasEvidence ? systemProse : systemTaxonomy;
  const prompt = `CONTEXTO:\n${context}\n\nPREGUNTA DEL USUARIO: ${question}`;

  // Modelo elegido por el usuario (allowlist; default = básico/gpt-4o-mini).
  const modelId = resolveChatModel(body.model);

  const result = streamText({
    model: openai(modelId),
    system,
    prompt,
    onError: ({ error }) => {
      console.error("[ask-chart] streamText error:", error);
    },
    // Registrar el uso en el mismo store que el token limiter, para que este
    // chat cuente contra el cap del usuario y se refleje en el UsageRing.
    onFinish: async ({ usage }) => {
      if (!pyBase) return;
      try {
        await fetch(`${pyBase}/usage/log`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            endpoint: "ask-chart",
            model: modelId,
            input_tokens: usage.inputTokens ?? 0,
            output_tokens: usage.outputTokens ?? 0,
          }),
        });
      } catch (e) {
        console.error("[ask-chart] usage log failed:", e);
      }
    },
  });

  return result.toTextStreamResponse();
}
