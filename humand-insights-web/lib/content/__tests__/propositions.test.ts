import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPositions,
  clusterObjects,
  cosine,
  normalizeObject,
  type ClaimInput,
} from "../propositions";

function claim(over: Partial<ClaimInput> & Pick<ClaimInput, "author_handle" | "claim_object" | "claim_stance">): ClaimInput {
  return {
    post_id: `p-${Math.random()}`,
    post_url: "https://x/p",
    claim: "una afirmación",
    counterclaim: "la contraria",
    outlier_factor: 1,
    debate_factor: null,
    ...over,
  };
}

test("normalizeObject junta las formas del mismo tema", () => {
  assert.equal(normalizeObject("Las encuestas de clima"), "encuestas de clima");
  assert.equal(normalizeObject("encuestas de clima"), "encuestas de clima");
  assert.equal(normalizeObject("  Evaluación  de Desempeño "), "evaluacion de desempeno");
});

test("sin embeddings agrupa por coincidencia exacta y no inventa grupos", () => {
  const groups = clusterObjects(["clima laboral", "Clima Laboral", "home office"]);
  assert.equal(groups.size, 2, "dos temas distintos, no uno");
});

test("con embeddings junta dos formas del mismo tema", () => {
  // Vectores a mano: los dos primeros casi paralelos, el tercero ortogonal.
  const emb = new Map([
    ["encuestas de clima", [1, 0, 0]],
    ["encuesta de clima laboral", [0.97, 0.24, 0]],
    ["home office", [0, 0, 1]],
  ]);
  const groups = clusterObjects([...emb.keys()], emb);
  assert.equal(groups.size, 2);
  const grande = [...groups.values()].find((g) => g.length === 2);
  assert.ok(grande, "las dos formas de encuesta tienen que caer juntas");
});

test("la polaridad NO pasa por el embedding: los dos lados quedan separados", () => {
  // El fallo silencioso que este diseño evita. "sirve" y "no sirve" son casi
  // idénticos como texto; si la postura viajara en el embedding, los dos lados
  // del debate se fusionarían en un grupo y el resultado sería incoherente.
  const claims = [
    claim({ author_handle: "@a", claim_object: "encuestas de clima", claim_stance: "a_favor", outlier_factor: 1 }),
    claim({ author_handle: "@b", claim_object: "encuestas de clima", claim_stance: "a_favor", outlier_factor: 1.2 }),
    claim({ author_handle: "@c", claim_object: "encuestas de clima", claim_stance: "en_contra", outlier_factor: 3 }),
    claim({ author_handle: "@d", claim_object: "encuestas de clima", claim_stance: "en_contra", outlier_factor: 3.4 }),
  ];
  const [pos] = buildPositions(claims);
  assert.ok(pos, "cuatro autores alcanzan para una posición");
  assert.equal(pos.sides.length, 2, "los dos lados tienen que seguir separados");
  assert.ok(pos.is_tension, "dos autores de cada lado es una tensión");
  // Y el lado que rinde queda primero, que es lo accionable.
  assert.equal(pos.sides[0].stance, "en_contra");
  assert.ok(pos.asymmetry! > 2, `esperaba asimetría marcada, dio ${pos.asymmetry}`);
});

test("una sola voz no hace una posición por más posts que tenga", () => {
  const claims = Array.from({ length: 9 }, () =>
    claim({ author_handle: "@el_mismo", claim_object: "su cruzada", claim_stance: "en_contra" }),
  );
  assert.equal(buildPositions(claims).length, 0);
});

test("consenso no es tensión", () => {
  const claims = Array.from({ length: 4 }, (_, i) =>
    claim({ author_handle: `@a${i}`, claim_object: "salud mental", claim_stance: "a_favor" }),
  );
  const [pos] = buildPositions(claims);
  assert.ok(pos);
  assert.equal(pos.is_tension, false, "todos del mismo lado es consenso");
});

test("el nombre que se muestra es el más usado, no el normalizado", () => {
  const claims = [
    claim({ author_handle: "@a", claim_object: "Evaluación de Desempeño", claim_stance: "a_favor" }),
    claim({ author_handle: "@b", claim_object: "evaluación de desempeño", claim_stance: "en_contra" }),
    claim({ author_handle: "@c", claim_object: "evaluación de desempeño", claim_stance: "en_contra" }),
  ];
  const [pos] = buildPositions(claims);
  assert.equal(pos.object_label, "evaluación de desempeño");
});

test("cosine es coseno", () => {
  assert.equal(cosine([1, 0], [1, 0]), 1);
  assert.equal(cosine([1, 0], [0, 1]), 0);
});

test("la asimetría no se calcula contra un lado de un solo post", () => {
  // El caso real: "cultura organizacional, asimetría 187x" salía de dividir la
  // mediana de cinco posts por la de UN post etiquetado 'condicional'. Ni era
  // una comparación entre posturas opuestas ni tenía muestra.
  const claims = [
    ...Array.from({ length: 5 }, (_, i) =>
      claim({ author_handle: `@a${i}`, claim_object: "cultura", claim_stance: "a_favor", outlier_factor: 35 }),
    ),
    claim({ author_handle: "@z", claim_object: "cultura", claim_stance: "condicional", outlier_factor: 0.2 }),
  ];
  const [pos] = buildPositions(claims);
  assert.ok(pos);
  assert.equal(pos.is_tension, false, "a_favor contra condicional no es una tensión");
  assert.equal(pos.asymmetry, null, "sin dos lados opuestos poblados no hay asimetría");
});

test("con los dos lados poblados sí se calcula", () => {
  const claims = [
    ...Array.from({ length: 3 }, (_, i) =>
      claim({ author_handle: `@a${i}`, claim_object: "encuestas", claim_stance: "a_favor", outlier_factor: 1 }),
    ),
    ...Array.from({ length: 3 }, (_, i) =>
      claim({ author_handle: `@b${i}`, claim_object: "encuestas", claim_stance: "en_contra", outlier_factor: 3 }),
    ),
  ];
  const [pos] = buildPositions(claims);
  assert.ok(pos.is_tension);
  assert.equal(pos.asymmetry, 3);
});
