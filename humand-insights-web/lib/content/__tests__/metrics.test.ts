import test from "node:test";
import assert from "node:assert/strict";

import { isoWeek, suggestionKey } from "../metrics";

test("suggestionKey es estable para la misma pieza", () => {
  const a = suggestionKey("br", "2026-10", "2026-10-06", "A cultura é o alicerce");
  const b = suggestionKey("br", "2026-10", "2026-10-06", "  A Cultura é o Alicerce  ");
  assert.equal(a, b, "espacios y mayúsculas no deberían cambiar la clave");
});

test("suggestionKey distingue piezas distintas", () => {
  const base = suggestionKey("br", "2026-10", "2026-10-06", "Un título");
  // El calendario se regenera: misma fecha, otro texto = otra pieza, y merece
  // su propio feedback en vez de heredar el anterior.
  assert.notEqual(base, suggestionKey("br", "2026-10", "2026-10-06", "Otro título"));
  assert.notEqual(base, suggestionKey("es", "2026-10", "2026-10-06", "Un título"));
  assert.notEqual(base, suggestionKey("br", "2026-11", "2026-10-06", "Un título"));
  assert.notEqual(base, suggestionKey("br", "2026-10", "2026-10-07", "Un título"));
});

test("isoWeek respeta el corte de año ISO", () => {
  // 2026-01-01 es jueves: por norma ISO cae en la semana 1 de 2026.
  assert.equal(isoWeek(new Date("2026-01-01T12:00:00Z")), "2026-W01");
  // 2025-12-29 es lunes y pertenece ya a la semana 1 de 2026.
  assert.equal(isoWeek(new Date("2025-12-29T12:00:00Z")), "2026-W01");
  assert.match(isoWeek(new Date("2026-09-16T12:00:00Z")), /^2026-W3[78]$/);
});

test("isoWeek da la misma semana para dos dias de la misma semana", () => {
  const lunes = isoWeek(new Date("2026-09-14T08:00:00Z"));
  const viernes = isoWeek(new Date("2026-09-18T20:00:00Z"));
  assert.equal(lunes, viernes, "dos corridas de la misma semana no deben duplicar la foto");
});
