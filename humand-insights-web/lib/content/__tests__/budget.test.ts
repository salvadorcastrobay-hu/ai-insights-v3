import assert from "node:assert/strict";
import { test } from "node:test";

import { allowance, monthStart, monthlyBudget, planSources, runShare, windowStart } from "../budget";
import { itemCost } from "../discovery-job";

const src = (id: string, kind: string, priority = 100, results_limit = 50) => ({ id, kind, priority, results_limit });

test("lo nuestro va primero, después las cuentas y al final hashtags y búsquedas", () => {
  const plan = planSources([
    src("kw", "keyword", 1),
    src("p2", "profile", 20),
    src("own", "own_brand", 99),
    src("hash", "hashtag", 1),
    src("comp", "competitor_profile", 10),
  ]);
  assert.deepEqual(
    plan.map((p) => p.source.id),
    ["own", "comp", "p2", "kw", "hash"],
  );
});

test("cada tipo pide su tope, sin pasarse del results_limit de la fuente", () => {
  const plan = planSources([src("own", "own_brand"), src("p", "profile"), src("chica", "profile", 1, 3)]);
  assert.deepEqual(
    Object.fromEntries(plan.map((p) => [p.source.id, p.maxItems])),
    { own: 15, chica: 3, p: 5 },
  );
});

test("el override es para cargas a mano y pisa el tope por fuente", () => {
  assert.equal(planSources([src("own", "own_brand")], 100)[0].maxItems, 100);
});

test("el tope del mes se aplica con lo efectivamente cobrado", () => {
  assert.equal(allowance(5, 500, 0), 5);
  assert.equal(allowance(5, 500, 497), 3);
  assert.equal(allowance(5, 500, 500), 0);
  assert.equal(allowance(5, 500, 650), 0);
  // La búsqueda de LinkedIn cobra el doble de lo que se le pide.
  assert.equal(allowance(10, 500, 490, 2), 5);
});

test("la búsqueda de LinkedIn cuesta doble; los perfiles y lo de Instagram, simple", () => {
  assert.equal(itemCost({ platform: "linkedin", kind: "keyword" }), 2);
  assert.equal(itemCost({ platform: "linkedin", kind: "profile" }), 1);
  assert.equal(itemCost({ platform: "instagram", kind: "hashtag" }), 1);
});

test("tope mensual desde el entorno, con 500 si no viene o es inválido", () => {
  assert.equal(monthlyBudget(undefined), 500);
  assert.equal(monthlyBudget("abc"), 500);
  assert.equal(monthlyBudget("-3"), 500);
  assert.equal(monthlyBudget("1200"), 1200);
  assert.equal(monthlyBudget("0"), 0);
});

test("ventana de 21 días y mes calendario en UTC", () => {
  const now = new Date("2026-11-04T15:00:00Z");
  assert.equal(windowStart(now), "2026-10-14");
  assert.equal(windowStart(now, null), null);
  assert.equal(monthStart(now), "2026-11-01T00:00:00.000Z");
});

test("cada corrida semanal se lleva su parte de lo que queda del mes", () => {
  // 1 de noviembre (30 días): quedan 5 corridas.
  assert.equal(runShare(500, 0, new Date("2026-11-01T07:00:00Z")), 100);
  // 23 de noviembre: quedan 2 (23 y 30).
  assert.equal(runShare(500, 300, new Date("2026-11-23T07:00:00Z")), 100);
  // 30 de noviembre: la última se lleva lo que queda.
  assert.equal(runShare(500, 420, new Date("2026-11-30T07:00:00Z")), 80);
  assert.equal(runShare(500, 600, new Date("2026-11-30T07:00:00Z")), 0);
});

test("dentro de cada tipo rota: primero la que hace más que no corre", () => {
  const plan = planSources([
    { ...src("reciente", "profile", 1), last_run_at: "2026-11-02T07:00:00Z" },
    { ...src("vieja", "profile", 50), last_run_at: "2026-10-01T07:00:00Z" },
    { ...src("nunca", "profile", 90), last_run_at: null },
  ]);
  assert.deepEqual(plan.map((p) => p.source.id), ["nunca", "vieja", "reciente"]);
});
