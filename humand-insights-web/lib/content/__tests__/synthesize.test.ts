import test from "node:test";
import assert from "node:assert/strict";

import {
  compareOwnBrand,
  computeLift,
  MIN_TOP_POSTS,
  synthesizeRegion,
  type AnalyzedPost,
  type RegionSynthesis,
} from "../synthesize";
import type { PostAnalysis } from "../classify";

function lift(key: string, value: number) {
  return { key, lift: value, top_count: 5, top_share: 0.2, base_share: 0.1 };
}

function analysis(over: Partial<PostAnalysis> = {}): PostAnalysis {
  return {
    is_relevant_to_hr: true,
    theme: "clima_cultura",
    topic: "cultura organizacional",
    relevance_reason: "toca un problema que el área vive todos los días",
    angle: "la cultura como práctica diaria",
    audience_signal: "hr_leader",
    target_profiles: ["hr_manager", "chro"],
    hook: "Un hook",
    hook_pattern: "pov",
    development: "Sostiene el punto con un ejemplo concreto.",
    structure: "opinion",
    cta: null,
    keywords: ["cultura", "liderazgo"],
    expressions: ["la cultura no se declara"],
    tone: "educativo",
    hashtag_strategy: "ninguno",
    replicability: "alta",
    humand_angle: "Adaptarlo a comunicación interna",
    why_it_worked: "porque sí",
    copy_length: 420,
    hashtag_count: 0,
    ...over,
  };
}

function post(id: string, score: number, over: Partial<PostAnalysis> = {}): AnalyzedPost {
  return {
    post_id: id,
    post_url: `https://x/${id}`,
    author_handle: "autor",
    region: "br",
    viral_score: score,
    outlier_factor: 3,
    likes_count: 100,
    comments_count: 10,
    analysis: analysis(over),
  };
}

test("computeLift separa lo que se usa mucho de lo que gana", () => {
  // 'pregunta' es el hook más común en general (6 de 10) pero aparece igual de
  // seguido arriba: no es ganador, es frecuente. 'contrarian' es raro abajo y
  // domina arriba: ese sí.
  const all = [
    ...Array(12).fill("pregunta"),
    ...Array(4).fill("contrarian"),
    ...Array(4).fill("pov"),
  ];
  const top = ["contrarian", "contrarian", "contrarian", "pregunta", "pregunta", "pregunta"];

  const lifts = computeLift(top, all);
  const byKey = new Map(lifts.map((l) => [l.key, l]));

  assert.ok(byKey.get("contrarian")!.lift > 2, "contrarian debe destacarse");
  assert.ok(byKey.get("pregunta")!.lift < 1, "pregunta es frecuente, no ganador");
  // Y el orden debe reflejarlo, no el conteo crudo.
  assert.equal(lifts[0].key, "contrarian");
});

test("computeLift ignora patrones con muy pocas apariciones arriba", () => {
  // Un lift altísimo sobre 2 posts se lee como hallazgo y no lo es: es el caso
  // real de "onboarding 4.95x" en España, calculado sobre dos apariciones.
  const top = ["raro", "raro", ...Array(8).fill("comun")];
  const all = [...top, ...Array(40).fill("comun")];
  const lifts = computeLift(top, all);
  assert.ok(!lifts.some((l) => l.key === "raro"), "2 apariciones no son un patrón");
  assert.ok(lifts.some((l) => l.key === "comun"));
});

test("synthesizeRegion solo mira posts relevantes y de audiencia RRHH", () => {
  const posts = [
    ...Array.from({ length: 10 }, (_, i) => post(`ok-${i}`, 0.9 - i * 0.01)),
    post("personal", 0.99, { is_relevant_to_hr: false, topic: "Rock in Rio" }),
    post("candidato", 0.98, { audience_signal: "candidate", topic: "como hacer un CV" }),
  ];

  const s = synthesizeRegion("br", posts);
  assert.equal(s.posts_considered, 10, "los dos descartados no deben contar");
  assert.ok(!s.top_topics.some((t) => t.key === "Rock in Rio"));
  assert.ok(!s.top_topics.some((t) => t.key === "como hacer un CV"));
});

test("synthesizeRegion avisa cuando la muestra no alcanza en vez de inventar patrones", () => {
  const s = synthesizeRegion("es", [post("a", 0.9), post("b", 0.8), post("c", 0.7)]);
  assert.equal(s.winning_hooks, null);
  assert.equal(s.winning_themes, null);
  assert.match(s.insufficient_sample ?? "", /hacen falta/);
  // Pero lo que sí se puede decir con 3 posts, se dice.
  assert.ok(s.top_topics.length > 0);
});

test("synthesizeRegion junta ideas replicables con su angulo", () => {
  const posts = [
    ...Array.from({ length: MIN_TOP_POSTS }, (_, i) => post(`alta-${i}`, 0.9 - i * 0.01)),
    post("baja", 0.5, { replicability: "baja", humand_angle: null }),
  ];
  const s = synthesizeRegion("br", posts);
  assert.ok(s.replicable_ideas.length > 0);
  assert.ok(s.replicable_ideas.every((i) => i.humand_angle));
  assert.ok(!s.replicable_ideas.some((i) => i.post_url?.includes("baja")));
});

test("compareOwnBrand marca los patrones que funcionan y no usamos", () => {
  const winners = {
    region: "br",
    posts_considered: 100,
    top_posts_count: 20,
    winning_hooks: [lift("contrarian", 2.1), lift("pregunta", 1.6), lift("pov", 1.2)],
    winning_themes: [lift("clima_cultura", 1.5), lift("liderazgo", 1.3)],
    top_topics: [],
    tone_mix: [],
    replicable_ideas: [],
  } satisfies RegionSynthesis;

  // Lo propio: solo anuncios, y solo sobre reclutamiento.
  const own = Array.from({ length: 6 }, (_, i) =>
    post(`own-${i}`, 0.2, { hook_pattern: "anuncio", theme: "reclutamiento" }),
  ).map((p) => ({ ...p, likes_count: 30, comments_count: 1, shares_count: 0 }));

  const reference = Array.from({ length: 10 }, (_, i) => ({
    ...post(`ref-${i}`, 0.8),
    likes_count: 900,
    comments_count: 40,
    shares_count: 10,
  }));

  const cmp = compareOwnBrand(own, winners, reference);

  assert.equal(cmp.own_posts, 6);
  assert.equal(cmp.own_median_engagement, 31);
  assert.equal(cmp.reference_median_engagement, 950);

  const faltantes = cmp.missing_patterns.map((p) => p.key);
  assert.ok(faltantes.includes("contrarian"), "contrarian rinde 2.1x y no lo usamos");
  assert.ok(faltantes.includes("pregunta"));

  assert.ok(
    cmp.overused_patterns.some((p) => p.key === "anuncio"),
    "usamos solo anuncio y no está entre los que ganan",
  );
  assert.deepEqual(
    cmp.missing_themes.map((t) => t.key).sort(),
    ["clima_cultura", "liderazgo"],
    "no tocamos ninguno de los dos temas que funcionan",
  );
});

test("compareOwnBrand no acusa de sobreuso a un patron sin lift medido", () => {
  const sinPatrones = {
    region: "hispam",
    posts_considered: 4,
    top_posts_count: 4,
    winning_hooks: null,
    winning_themes: null,
    top_topics: [],
    tone_mix: [],
    replicable_ideas: [],
    insufficient_sample: "muestra chica",
  } satisfies RegionSynthesis;

  const own = Array.from({ length: 4 }, (_, i) => post(`o${i}`, 0.3, { hook_pattern: "pov" }));
  const cmp = compareOwnBrand(own, sinPatrones, []);

  // Sin lift medido no se puede afirmar nada: ni que falta ni que sobra.
  assert.equal(cmp.missing_patterns.length, 0);
  assert.equal(cmp.missing_themes.length, 0);
  assert.equal(cmp.reference_median_engagement, null);
});
