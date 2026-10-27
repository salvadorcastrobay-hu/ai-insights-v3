import test from "node:test";
import assert from "node:assert/strict";

import { buildPainsDetailData } from "../pains-detail-data";
import { TABLE_MAX as PAIN_TABLE_MAX, TABLE_PAGE as PAIN_TABLE_PAGE } from "../table-page";
import type { InsightRow } from "../../supabase/types";

function pain(i: number, overrides: Partial<InsightRow> = {}): InsightRow {
  return {
    id: String(i),
    transcript_id: `t${i}`,
    deal_id: `d${i % 50}`,
    insight_type: "pain",
    insight_subtype_display: "Procesos manuales",
    pain_theme: i % 2 === 0 ? "Comunicación" : "Operaciones",
    module_display: i % 3 === 0 ? "Chat" : null,
    module_status: "existing",
    segment: "Enterprise",
    company_name: `Co ${i}`,
    summary: i === 4321 ? "aguja en el pajar" : `Summary ${i}`,
    verbatim_quote: null,
    confidence: 0.9,
    deal_stage: "Discovery",
    ...overrides,
  } as InsightRow;
}

const rows = Array.from({ length: 10_000 }, (_, i) => pain(i));

test("charts agregan sobre todos los pains, la tabla arranca en una página", () => {
  const data = buildPainsDetailData(rows, 0);
  assert.equal(data.kpis.total, 10_000);
  assert.equal(data.painTableRows.length, PAIN_TABLE_PAGE);
  assert.equal(data.painTableTotal, 10_000);
  assert.ok(data.byModule.length > 0);
});

test("limit pagina y se acota a [PAIN_TABLE_PAGE, PAIN_TABLE_MAX]", () => {
  const filter = { theme: null, module: null, search: null };
  assert.equal(buildPainsDetailData(rows, 0, { ...filter, limit: 400 }).painTableRows.length, 400);
  assert.equal(buildPainsDetailData(rows, 0, { ...filter, limit: 5 }).painTableRows.length, PAIN_TABLE_PAGE);
  assert.equal(buildPainsDetailData(rows, 0, { ...filter, limit: 999_999 }).painTableRows.length, PAIN_TABLE_MAX);
});

test("los filtros de tabla cuentan el total antes del corte y no tocan los charts", () => {
  const data = buildPainsDetailData(rows, 0, { theme: "Comunicación", module: "Chat", search: null });
  // i par y múltiplo de 3 → múltiplos de 6 en [0, 10000)
  assert.equal(data.painTableTotal, 1667);
  assert.equal(data.painTableRows.length, PAIN_TABLE_PAGE);
  assert.ok(data.painTableRows.every((r) => r.pain_theme === "Comunicación" && r.module_display === "Chat"));
  assert.equal(data.kpis.total, 10_000);
});

test("la búsqueda encuentra filas fuera de la primera página", () => {
  const data = buildPainsDetailData(rows, 0, { theme: null, module: null, search: "  AGUJA " });
  assert.equal(data.painTableTotal, 1);
  assert.equal(data.painTableRows[0].id, "4321");
});
