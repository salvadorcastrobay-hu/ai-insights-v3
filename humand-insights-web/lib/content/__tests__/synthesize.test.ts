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
  return { key, lift: value, top_count: 5, top_authors: 3, top_share: 0.2, base_share: 0.1 };
}

function analysis(over: Partial<PostAnalysis> = {}): PostAnalysis {
  return {
    is_relevant_to_hr: true,
    theme: "clima_cultura",
    audience_signal: "hr_leader",
    target_profiles: ["hr_manager", "chro"],
    hook: "Un hook",
    hook_pattern: "pov",
    structure: "opinion",
    cta: null,
    tone: "educativo",
    hashtag_strategy: "ninguno",
    replicability: "alta",
    claim: "Adaptarlo a comunicación interna",
    counterclaim: null,
    claim_object: "onboarding remoto",
    claim_stance: "a_favor",
    transferable_mechanism: "ninguno",
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
  // Cada observación trae su autor: el lift exige voces distintas, no posts.
  const obs = (key: string, i: number) => ({ key, author: `a${i}` });
  const all = [
    ...Array.from({ length: 12 }, (_, i) => obs("pregunta", i)),
    ...Array.from({ length: 4 }, (_, i) => obs("contrarian", i)),
    ...Array.from({ length: 4 }, (_, i) => obs("pov", i)),
  ];
  const top = [
    obs("contrarian", 0), obs("contrarian", 1), obs("contrarian", 2),
    obs("pregunta", 3), obs("pregunta", 4), obs("pregunta", 5),
  ];

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
  const obs = (key: string, i: number) => ({ key, author: `a${i}` });
  const top = [
    obs("raro", 0), obs("raro", 1),
    ...Array.from({ length: 8 }, (_, i) => obs("comun", i + 2)),
  ];
  const all = [...top, ...Array.from({ length: 40 }, (_, i) => obs("comun", i + 10))];
  const lifts = computeLift(top, all);
  assert.ok(!lifts.some((l) => l.key === "raro"), "2 apariciones no son un patrón");
  assert.ok(lifts.some((l) => l.key === "comun"));
});

test("un patrón que sostiene un solo autor no cuenta como patrón", () => {
  // El agujero real: MIN_PATTERN_COUNT miraba posts, así que un autor prolífico
  // con cinco posts del mismo tipo fabricaba un "patrón del mercado" solo.
  const unoSolo = Array.from({ length: 5 }, () => ({ key: "cruzada", author: "@el_mismo" }));
  const varios = Array.from({ length: 5 }, (_, i) => ({ key: "real", author: `@a${i}` }));
  const top = [...unoSolo, ...varios];
  const all = [...top, ...Array.from({ length: 30 }, (_, i) => ({ key: "comun", author: `@b${i}` }))];

  const lifts = computeLift(top, all);
  assert.ok(!lifts.some((l) => l.key === "cruzada"), "cinco posts de una persona no son un patrón");
  const real = lifts.find((l) => l.key === "real");
  assert.ok(real, "cinco posts de cinco personas sí lo son");
  assert.equal(real!.top_authors, 5);
});

test("synthesizeRegion solo mira posts relevantes y de audiencia RRHH", () => {
  const posts = [
    ...Array.from({ length: 10 }, (_, i) => post(`ok-${i}`, 0.9 - i * 0.01)),
    post("personal", 0.99, { is_relevant_to_hr: false, claim_object: "Rock in Rio" }),
    post("candidato", 0.98, { audience_signal: "candidate", claim_object: "como hacer un CV" }),
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

test("las ideas replicables exigen una afirmación, no una etiqueta", () => {
  // El filtro pasó de `replicability === "alta"` a "tiene claim": un post sin
  // afirmación no le da al calendario nada sobre qué escribir, por replicable
  // que sea su formato.
  const posts = [
    ...Array.from({ length: MIN_TOP_POSTS }, (_, i) => post(`conclaim-${i}`, 0.9 - i * 0.01)),
    post("sinclaim", 0.5, { replicability: "alta", claim: null }),
  ];
  const s = synthesizeRegion("br", posts);
  assert.ok(s.replicable_ideas.length > 0);
  assert.ok(s.replicable_ideas.every((i) => i.claim), "toda idea tiene que afirmar algo");
  assert.ok(
    !s.replicable_ideas.some((i) => i.post_url?.includes("sinclaim")),
    "un post sin claim no entra aunque su replicabilidad sea alta",
  );
});

test("compareOwnBrand marca los patrones que funcionan y no usamos", () => {
  const winners = {
    region: "br",
    posts_considered: 100,
    top_posts_count: 20,
    winning_hooks: [lift("contrarian", 2.1), lift("pregunta", 1.6), lift("pov", 1.2)],
    winning_themes: [lift("clima_cultura", 1.5), lift("liderazgo", 1.3)],
    winning_structures: null,
    visual_mix: null,
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
    winning_structures: null,
    visual_mix: null,
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

// ─── Lo nuevo: contraste, collabs, forma del copy ───────────────────────────

import { computeContrast } from "../synthesize";
import { computeFeatures } from "../post-features";

function withFeatures(p: AnalyzedPost, over: Record<string, unknown> = {}): AnalyzedPost {
  const base = computeFeatures(
    { platform: "linkedin", caption: "Una línea", format: "text", media: null, posted_at: null, duration_secs: null, raw: {} },
    "br",
  );
  return { ...p, features: { ...base, ...over } as AnalyzedPost["features"] };
}

test("computeContrast exige voces en los dos lados", () => {
  const top = [
    { key: "carrusel_texto", author: "a" },
    { key: "carrusel_texto", author: "b" },
    { key: "carrusel_texto", author: "c" },
    { key: "meme", author: "a" },
    { key: "meme", author: "b" },
    { key: "meme", author: "c" },
  ];
  const rest = [
    { key: "carrusel_texto", author: "x" },
    { key: "carrusel_texto", author: "y" },
    { key: "foto_stock", author: "z" },
    { key: "foto_stock", author: "w" },
    { key: "foto_stock", author: "v" },
    { key: "foto_stock", author: "u" },
  ];
  const out = computeContrast(top, rest);
  // meme no aparece en el control: el lift sería infinito, así que se omite.
  assert.deepEqual(out.map((r) => r.key), ["carrusel_texto"]);
  assert.equal(out[0].lift, 1.5);
});

test("synthesizeRegion deja los collabs fuera del corte y los cuenta", () => {
  const posts: AnalyzedPost[] = [];
  for (let i = 0; i < 40; i += 1) {
    posts.push(withFeatures({ ...post(`p${i}`, 100 - i), author_handle: `autor${i % 8}` }));
  }
  // Los tres mejores son collabs: sin la exclusión, dominarían el corte.
  for (let i = 0; i < 3; i += 1) {
    posts.push(withFeatures({ ...post(`c${i}`, 1000 + i), author_handle: `collab${i}` }, { is_collab: true }));
  }
  const s = synthesizeRegion("br", posts);
  assert.equal(s.excluded_collabs, 3);
  assert.ok(!s.replicable_ideas.some((idea) => idea.author_handle.startsWith("collab")));
});

test("synthesizeRegion mide la forma del copy arriba contra el resto", () => {
  const posts: AnalyzedPost[] = [];
  for (let i = 0; i < 50; i += 1) {
    const top = i < 10;
    posts.push(
      withFeatures(
        { ...post(`p${i}`, 100 - i), author_handle: `autor${i % 10}` },
        { first_line_chars: top ? 40 : 120, has_external_link: !top },
      ),
    );
  }
  const s = synthesizeRegion("br", posts);
  const first = s.copy_shape?.find((r) => r.metric === "first_line_chars");
  assert.equal(first?.top, 40);
  assert.equal(first?.rest, 120);
  const link = s.copy_shape?.find((r) => r.metric === "has_external_link");
  assert.equal(link?.top, 0);
  assert.equal(link?.rest, 1);
});

test("synthesizeRegion calcula lift visual solo con control suficiente", () => {
  const visual = (fmt: string, prod: string) => ({
    visual_format: fmt,
    text_on_image: "titular_corto",
    visual_text: null,
    production_level: prod,
    person_framing: "sin_persona",
  });
  const posts: AnalyzedPost[] = [];
  for (let i = 0; i < 60; i += 1) {
    const top = i < 12;
    posts.push(
      withFeatures({
        ...post(`p${i}`, 100 - i),
        author_handle: `autor${i % 12}`,
        visual: top
          ? visual(i % 3 ? "carrusel_texto" : "foto_stock", "plantilla")
          : visual(i % 3 ? "foto_stock" : "carrusel_texto", i % 2 ? "producido" : "plantilla"),
      }),
    );
  }
  const s = synthesizeRegion("br", posts);
  assert.ok(s.visual_lift, "con 12 arriba y 48 en el control hay lift");
  const carrusel = s.visual_lift!.visual_format.find((r) => r.key === "carrusel_texto");
  assert.ok(carrusel && carrusel.lift > 1);

  // Sin control: cae a la mezcla, no inventa un lift.
  const soloTop = posts.map((p, i) => (i < 12 ? p : { ...p, visual: null }));
  assert.equal(synthesizeRegion("br", soloTop).visual_lift, null);
});
