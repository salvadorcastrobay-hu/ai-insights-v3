import assert from "node:assert/strict";
import { test } from "node:test";

import { summarizeSourceResults } from "../discovery-job";

test("una corrida sin fallos no reporta error", () => {
  const r = summarizeSourceResults([{ error: null }, { error: null }]);
  assert.equal(r.allFailed, false);
  assert.equal(r.error, null);
});

test("si fallan TODAS las fuentes la corrida es fallida", () => {
  // El caso real: Apify cortó por límite mensual y las 73 fuentes devolvieron
  // 403. El job igual decía "completed" y pasaron tres días sin que nada avisara.
  const r = summarizeSourceResults(
    Array.from({ length: 73 }, () => ({ error: "Apify run start failed (403)" })),
  );
  assert.equal(r.allFailed, true);
  assert.match(r.error ?? "", /73\/73 fuentes fallaron/);
  assert.match(r.error ?? "", /403/);
});

test("si fallan algunas la corrida se completa pero deja el motivo", () => {
  const r = summarizeSourceResults([{ error: "timeout" }, { error: null }, { error: null }]);
  assert.equal(r.allFailed, false);
  assert.match(r.error ?? "", /1\/3 fuentes fallaron/);
});

test("una corrida sin fuentes no cuenta como fallida", () => {
  const r = summarizeSourceResults([]);
  assert.equal(r.allFailed, false);
  assert.equal(r.error, null);
});
