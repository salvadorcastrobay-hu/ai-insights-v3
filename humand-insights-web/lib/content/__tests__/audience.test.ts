import assert from "node:assert/strict";
import { test } from "node:test";

import { audiencePrompt, countryToStore } from "../audience";

test("el país solo se guarda con confianza media o alta y con un código válido", () => {
  assert.equal(countryToStore({ country: "AR", confianza: "alta", evidencia: "vos" }).country, "ar");
  assert.equal(countryToStore({ country: "latam", confianza: "media", evidencia: "regional" }).country, "latam");
  assert.equal(countryToStore({ country: "mx", confianza: "baja", evidencia: "?" }).country, null);
  assert.equal(countryToStore({ country: "desconocido", confianza: "alta", evidencia: "" }).country, null);
  assert.equal(countryToStore({ country: "Argentina", confianza: "alta", evidencia: "" }).country, null);
});

test("cuando no se sabe el país igual queda registrado, para no volver a preguntar", () => {
  const { country, source } = countryToStore({ country: "desconocido", confianza: "baja", evidencia: "" });
  assert.equal(country, null);
  assert.match(source, /desconocido/);
});

test("el prompt de audiencia recorta el copy y lleva las seis categorías", () => {
  const prompt = audiencePrompt({ author: "x", caption: "a".repeat(5000), visualText: null });
  assert.ok(!prompt.includes("a".repeat(3001)));
  for (const k of ["rrhh:", "management_ceo:", "pymes:", "empleados:", "candidatos:", "general:"]) assert.ok(prompt.includes(k));
});
