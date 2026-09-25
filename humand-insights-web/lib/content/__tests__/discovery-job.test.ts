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

import { pickVisualSample } from "../store";

test("pickVisualSample: corte superior entero y control repartido en el resto", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: `id${i}`,
    post_id: `p${i}`,
    stored_media: { images: [`img${i}.jpg`] },
    visual_analysis: null,
  }));
  const out = pickVisualSample("br", rows, 60, 60);
  const top = out.filter((o) => o.sample === "top");
  const control = out.filter((o) => o.sample === "control");
  // 20% de 100 = 20 arriba; el control iguala al corte.
  assert.equal(top.length, 20);
  assert.equal(control.length, 20);
  // Sistemático, no los peores: el control arranca justo debajo del corte y
  // llega hasta el fondo del ranking.
  const idx = control.map((c) => Number(c.post_id.slice(1)));
  assert.ok(Math.min(...idx) < 30);
  assert.ok(Math.max(...idx) > 80);
});

test("pickVisualSample: no vuelve a pagar el control que ya está hecho", () => {
  const rows = Array.from({ length: 100 }, (_, i) => ({
    id: `id${i}`,
    post_id: `p${i}`,
    stored_media: { images: [`img${i}.jpg`] },
    visual_analysis: i >= 20 && i < 35 ? { visual_format: "meme" } : null,
  }));
  const control = pickVisualSample("br", rows, 60, 60).filter((o) => o.sample === "control");
  assert.equal(control.length, 5);
});
