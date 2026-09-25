import test from "node:test";
import assert from "node:assert/strict";

import { clipCaption, groundHook, safeSlice } from "../classify";

test("clipCaption: manda cabeza y cola, no los primeros N caracteres", () => {
  const body = "a".repeat(2000);
  const text = `APERTURA ${body} Comente PIPELINE que eu envio.`;
  const clipped = clipCaption(text);
  assert.ok(clipped.startsWith("APERTURA"));
  // El CTA está al final: es justo lo que el corte anterior perdía.
  assert.ok(clipped.endsWith("Comente PIPELINE que eu envio."));
  assert.ok(clipped.includes("[…]"));
  assert.ok(clipped.length < text.length);
  // Un texto corto pasa entero.
  assert.equal(clipCaption("corto"), "corto");
  assert.equal(clipCaption(null), "");
});

test("groundHook: deja la cita del modelo si está en el texto", () => {
  const caption = "🚨 Esforço e sofrimento NÃO SÃO sinônimos!\n\nResto del post.";
  const g = groundHook("Esforço e sofrimento não são sinônimos", caption);
  assert.equal(g.source, "modelo");
  assert.equal(g.hook, "Esforço e sofrimento não são sinônimos");
});

test("groundHook: una paráfrasis se reemplaza por la primera línea real", () => {
  const caption = "Eu acho curioso quando colocam no home office a culpa por problemas.\n\nCultura não é um lugar.";
  const g = groundHook("La cultura no depende del lugar de trabajo.", caption);
  assert.equal(g.source, "primera_linea");
  assert.equal(g.hook, "Eu acho curioso quando colocam no home office a culpa por problemas.");
});

test("groundHook: la primera línea larga se corta en quince palabras", () => {
  const caption = Array.from({ length: 30 }, (_, i) => `palabra${i}`).join(" ");
  const g = groundHook(null, caption);
  assert.equal(g.source, "primera_linea");
  assert.equal(g.hook?.split(" ").length, 15);
  assert.ok(g.hook?.endsWith("…"));
});

test("groundHook: una frase literal del medio no es el hook", () => {
  const caption =
    "Veo un patrón repetirse en la mayoría de mandos intermedios.\n\n" +
    "x ".repeat(200) +
    "\n\nEl miedo es el atajo del liderazgo.";
  const g = groundHook("El miedo es el atajo del liderazgo.", caption);
  assert.equal(g.source, "primera_linea");
  assert.equal(g.hook, "Veo un patrón repetirse en la mayoría de mandos intermedios.");
});

test("clipCaption no parte un emoji: un surrogate suelto rompe el JSON del request", () => {
  const text = "🚀".repeat(1500);
  const clipped = clipCaption(text);
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(clipped)));
  assert.equal(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(clipped), false);
  assert.equal(safeSlice("a🚀b", 0, 2), "a🚀");
});
