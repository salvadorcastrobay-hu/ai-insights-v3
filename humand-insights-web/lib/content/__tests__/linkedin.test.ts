import test from "node:test";
import assert from "node:assert/strict";

import { hrAuthorKeywords, linkedInProfileUrl, looksLikeHrAuthor } from "../linkedin";

test("linkedInProfileUrl acepta handle, URL y perfiles de empresa", () => {
  assert.equal(linkedInProfileUrl("estevessofia"), "https://www.linkedin.com/in/estevessofia/");
  assert.equal(linkedInProfileUrl("@estevessofia"), "https://www.linkedin.com/in/estevessofia/");
  assert.equal(linkedInProfileUrl("in/estevessofia"), "https://www.linkedin.com/in/estevessofia/");
  assert.equal(linkedInProfileUrl("company/humand"), "https://www.linkedin.com/company/humand/");
  // Una URL ya armada se respeta, sin los params de tracking.
  assert.equal(
    linkedInProfileUrl("https://es.linkedin.com/in/pilarjerico/?originalSubdomain=es"),
    "https://es.linkedin.com/in/pilarjerico/",
  );
});

test("hrAuthorKeywords usa sintaxis OR y no listas por comas", () => {
  // Medido: una lista separada por comas devuelve 0 resultados — el actor la
  // interpreta como una sola frase. Con OR funciona.
  for (const lang of ["pt-BR", "es-AR", "es-ES", "en-US"]) {
    const kw = hrAuthorKeywords(lang);
    assert.match(kw, / OR /, `${lang} debe usar OR`);
    assert.ok(!kw.includes(","), `${lang} no debe usar comas`);
    // Un acrónimo suelto no matchea: todo término debe tener 2+ palabras o ir
    // acompañado dentro del OR.
    assert.ok(kw.split(" OR ").length >= 3, `${lang} debe ofrecer varios términos`);
  }
});

test("hrAuthorKeywords cae al idioma correcto", () => {
  assert.match(hrAuthorKeywords("pt-BR"), /Gestão de Pessoas/);
  assert.match(hrAuthorKeywords("es-ES"), /RRHH/);
  // Variantes no listadas caen al grupo de su idioma, no a vacío.
  assert.match(hrAuthorKeywords("pt-PT"), /Gestão de Pessoas/);
  assert.match(hrAuthorKeywords("es-MX"), /RRHH/);
  assert.match(hrAuthorKeywords(null), /RRHH/);
});

test("looksLikeHrAuthor deja pasar RRHH y filtra el ruido que trajo la busqueda", () => {
  // Casos reales de la corrida de prueba con "gestão de pessoas".
  assert.equal(looksLikeHrAuthor("HR Director at Bosch Home Comfort Group | HR Global"), true);
  assert.equal(looksLikeHrAuthor("Especialista em Gestão de Pessoas | Cultura"), true);
  assert.equal(looksLikeHrAuthor("Consultora de Comunicación Interna"), true);
  assert.equal(looksLikeHrAuthor("Capital Humano | HRBP"), true);

  assert.equal(looksLikeHrAuthor("Desenvolvedor Full-Stack Sênior (8+ anos) | Node"), false);
  assert.equal(looksLikeHrAuthor("IT Manager | Service Owner | ITIL Certified"), false);
  assert.equal(looksLikeHrAuthor(null), false);
  assert.equal(looksLikeHrAuthor(""), false);
});

test("looksLikeHrAuthor ignora acentos en ambos sentidos", () => {
  assert.equal(looksLikeHrAuthor("Gestao de Pessoas"), true);
  assert.equal(looksLikeHrAuthor("Comunicação Interna"), true);
});
