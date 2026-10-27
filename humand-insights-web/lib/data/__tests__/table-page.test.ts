import test from "node:test";
import assert from "node:assert/strict";

import { buildCsvExportHref, buildCsvLinks } from "../csv-export-links";
import { buildFaqDetailData } from "../faq-detail-data";
import { EMPTY_FILTERS } from "../filters";
import { buildProductGapsDetailData } from "../product-gaps-detail-data";
import { TABLE_MAX, TABLE_PAGE, clampTableLimit, paginateRows, textMatcher } from "../table-page";
import type { InsightRow } from "../../supabase/types";

test("paginateRows cuenta todo y mapea solo hasta el límite", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => i);
  let mapped = 0;
  const page = paginateRows(rows, (n) => n % 2 === 0, (n) => (mapped++, n), 300);
  assert.equal(page.total, 500);
  assert.equal(page.rows.length, 300);
  assert.equal(mapped, 300);
});

test("clampTableLimit acota a [TABLE_PAGE, TABLE_MAX] y tolera NaN", () => {
  assert.equal(clampTableLimit(Number("")), TABLE_PAGE);
  assert.equal(clampTableLimit(Number("abc")), TABLE_PAGE);
  assert.equal(clampTableLimit(null), TABLE_PAGE);
  assert.equal(clampTableLimit(400), 400);
  assert.equal(clampTableLimit(1e9), TABLE_MAX);
});

test("textMatcher ignora búsquedas vacías", () => {
  assert.equal(textMatcher("   "), null);
  assert.equal(textMatcher("Hola")?.("decir HOLA"), true);
});

test("buildCsvExportHref pasa solo filtros globales y fuerza el tipo", () => {
  const href = buildCsvExportHref(
    { regions: ["HISPAM", "Brasil"], types: "Pregunta Frecuente", pt_q: "x", gt_limit: "400", validated: "false" },
    "pain",
  );
  const qs = new URL(href, "http://x").searchParams;
  assert.equal(qs.get("regions"), "HISPAM,Brasil");
  assert.equal(qs.get("types"), "Dolor / Problema");
  assert.equal(qs.get("validated"), "false");
  assert.equal(qs.get("pt_q"), null);
  assert.equal(qs.get("gt_limit"), null);
  // Sin tipo respeta el filtro de tipos global.
  assert.equal(new URL(buildCsvExportHref({ types: "Feature Faltante" }), "http://x").searchParams.get("types"), "Feature Faltante");
  assert.equal(buildCsvExportHref({}), "/api/export/csv");
});

test("buildCsvLinks cuenta por tipo", () => {
  const rows = [
    { insight_type: "pain" },
    { insight_type: "pain" },
    { insight_type: "faq" },
  ] as InsightRow[];
  const links = buildCsvLinks({}, rows);
  assert.equal(links.all.n, 3);
  assert.equal(links.pain.n, 2);
  assert.equal(links.faq.n, 1);
  assert.equal(links.product_gap.n, 0);
});

function insight(i: number, overrides: Partial<InsightRow>): InsightRow {
  return {
    id: String(i),
    transcript_id: `t${i}`,
    deal_id: `d${i % 40}`,
    insight_subtype_display: i % 2 === 0 ? "Precio" : "Integraciones",
    summary: i === 777 ? "aguja" : `Summary ${i}`,
    verbatim_quote: null,
    confidence: 0.9,
    segment: "Enterprise",
    ...overrides,
  } as InsightRow;
}

test("FAQ: la tabla pagina en server, los charts usan todas", () => {
  const rows = Array.from({ length: 3000 }, (_, i) => insight(i, { insight_type: "faq", insight_type_display: "Pregunta Frecuente" }));
  const data = buildFaqDetailData(rows, 0, EMPTY_FILTERS);
  assert.equal(data.kpis.totalFaqs, 3000);
  assert.equal(data.faqTableRows.length, TABLE_PAGE);
  assert.equal(data.faqTableTotal, 3000);

  const byTopic = buildFaqDetailData(rows, 0, EMPTY_FILTERS, { topic: "Precio", search: null, limit: 1000 });
  assert.equal(byTopic.faqTableTotal, 1500);
  assert.equal(byTopic.faqTableRows.length, 1000);

  const found = buildFaqDetailData(rows, 0, EMPTY_FILTERS, { topic: null, search: "AGUJA" });
  assert.deepEqual(found.faqTableRows.map((r) => r.id), ["777"]);
});

test("Gaps: la tabla pagina en server y las opciones salen de todos los gaps", () => {
  const rows = Array.from({ length: 3000 }, (_, i) =>
    insight(i, {
      insight_type: "product_gap",
      insight_type_display: "Feature Faltante",
      feature_display: `Feature ${i % 7}`,
      gap_priority: i === 2999 ? "dealbreaker" : "must_have",
      module_display: i === 2998 ? "Chat" : "Encuestas",
    }),
  );
  const data = buildProductGapsDetailData(rows, 0, EMPTY_FILTERS);
  assert.equal(data.gapTableRows.length, TABLE_PAGE);
  assert.equal(data.gapTableTotal, 3000);
  // Opciones que solo aparecen al final igual están en los selects.
  assert.ok(data.gapTablePriorities.includes("dealbreaker"));
  assert.ok(data.gapTableModules.includes("Chat"));

  const filtered = buildProductGapsDetailData(rows, 0, EMPTY_FILTERS, { priority: "dealbreaker", module: null, search: null });
  assert.equal(filtered.gapTableTotal, 1);
  assert.equal(filtered.gapTableRows[0].isDealbreaker, true);
});
