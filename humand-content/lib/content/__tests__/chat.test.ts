import assert from "node:assert/strict";
import { test } from "node:test";

import { dropSentencesWith, numbersIn, PostRegistry, replaceNumbers, resolveCitations, ungroundedNumbers } from "../chat";
import type { ContentPost } from "../types";

const post = (id: string) => ({ id, author_handle: id }) as unknown as ContentPost;

test("una cita que no salió de una herramienta se borra", () => {
  const reg = new PostRegistry();
  assert.equal(reg.ref(post("a")), "p1");
  assert.equal(reg.ref(post("b")), "p2");
  assert.equal(reg.ref(post("a")), "p1");
  const { text, cited } = resolveCitations("Arrancá con una pregunta [p2] [p9]. Como en [p1].", reg);
  assert.equal(text, "Arrancá con una pregunta [p2]. Como en [p1].");
  assert.deepEqual(cited.map((c) => c.ref), ["p2", "p1"]);
});

test("detecta la cifra inventada del borrador y acepta las que sí vinieron", () => {
  const known = numbersIn([
    { veces: 2.7, costo_por_lead: 1463, invertido: 14627, ctr_pct: 2.61, outlier: 20.9 },
    "Del 2026-06-10",
  ]);
  const answer = "Comunicación interna aparece 2,7× más. Cuesta ARS 1.463 por lead (14.627 invertidos, CTR 2,61%). Rindió 20,9×. Logramos un 30% más de participación.";
  assert.deepEqual(ungroundedNumbers(answer, known), ["30%"]);
});

test("conteos chicos, años y referencias no cuentan como cifras", () => {
  assert.deepEqual(ungroundedNumbers("Te dejo 3 ejemplos de 2026 [p12].", []), []);
});

test("acepta redondeos y tasas expresadas como porcentaje", () => {
  assert.deepEqual(ungroundedNumbers("Unas 338 cuentas, 4,3% de interacción.", numbersIn({ reach: 338.4, rate: 0.043 })), []);
});

test("un número chico con unidad se verifica", () => {
  assert.deepEqual(ungroundedNumbers("Resultados em apenas 3 meses, 20,9× su promedio.", numbersIn({ x: 20.9 })), ["3"]);
  assert.deepEqual(ungroundedNumbers("Te dejo 3 ideas.", []), []);
});

test("el reemplazo toca solo el número exacto", () => {
  assert.equal(replaceNumbers("En 3 meses llegó a 338 y 2,3%.", ["3"]), "En [dato] meses llegó a 338 y 2,3%.");
  assert.equal(replaceNumbers("Un 30% más.", ["30%"]), "Un [dato] más.");
});

test("sin respaldo se saca la oración entera, no se deja un hueco", () => {
  const text = "Arrancá con una escena. Logramos un 30% más de participación. Cerrá con Humand.\n- Slide 2: un 40% lo dice.\n- Slide 3: cierre.";
  assert.equal(dropSentencesWith(text, ["30%", "40%"]), "Arrancá con una escena. Cerrá con Humand.\n- Slide 3: cierre.");
});

test("tiempos de escena y números de slide no son cifras", () => {
  assert.deepEqual(ungroundedNumbers("1. **9–12s** Slide 14: cierre. Escena 12.", []), []);
});

test("marcadores para completar y nombres de herramientas se borran", () => {
  const { text } = resolveCitations("Descubrí más [Enlace a la web]. Según [patrones_mercado], sí.", new PostRegistry());
  assert.equal(text, "Descubrí más. Según, sí.");
});
