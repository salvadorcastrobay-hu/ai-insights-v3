import test from "node:test";
import assert from "node:assert/strict";

import {
  authorBaselines,
  engagementTotal,
  followerTier,
  median,
  percentileRank,
  isMature,
  SCORING,
  scorePosts,
  squash,
  type ScorablePost,
} from "../scoring";

const NOW = new Date("2026-09-09T12:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

function post(over: Partial<ScorablePost> & Pick<ScorablePost, "post_id" | "author_handle">): ScorablePost {
  return {
    likes_count: 100,
    comments_count: 10,
    video_views: null,
    author_followers_at_fetch: 10_000,
    posted_at: daysAgo(10),
    is_pinned: false,
    region: "hispam",
    ...over,
  };
}

/** Serie de posts "normales" de una cuenta, para darle baseline al autor. */
function baselineFor(handle: string, followers: number, likes: number): ScorablePost[] {
  return Array.from({ length: 8 }, (_, i) =>
    post({
      post_id: `${handle}-base-${i}`,
      author_handle: handle,
      likes_count: likes,
      comments_count: Math.round(likes * 0.02),
      author_followers_at_fetch: followers,
      posted_at: daysAgo(20 + i),
    }),
  );
}

test("engagementTotal pondera comentarios por encima de likes", () => {
  assert.equal(engagementTotal(post({ post_id: "a", author_handle: "x", likes_count: 100, comments_count: 10 })), 120);
});

test("median usa el valor central, no el promedio", () => {
  // Un viral aislado no debe mover la línea base.
  assert.equal(median([10, 10, 10, 10, 1000]), 10);
  assert.equal(median([10, 20]), 15);
  assert.equal(median([]), null);
});

test("followerTier corta en los umbrales esperados", () => {
  assert.equal(followerTier(5_000), "micro");
  assert.equal(followerTier(50_000), "mid");
  assert.equal(followerTier(500_000), "macro");
  assert.equal(followerTier(2_000_000), "mega");
  assert.equal(followerTier(0), null);
  assert.equal(followerTier(null), null);
});

test("squash satura: 8x y 30x puntúan casi igual", () => {
  assert.ok(squash(30) === 1);
  assert.ok(squash(8) === 1);
  assert.ok(squash(2) < squash(4));
  assert.equal(squash(0), 0);
});

test("percentileRank devuelve neutro con cohorte vacía", () => {
  assert.equal(percentileRank(0.05, []), 0.5);
  assert.equal(percentileRank(3, [1, 2, 4, 5]), 0.5);
});

test("authorBaselines agrupa por autor y exige muestra", () => {
  const posts = [...baselineFor("chica", 5_000, 100), ...baselineFor("grande", 500_000, 5_000)];
  const baselines = authorBaselines(posts);
  assert.equal(baselines.get("chica")?.sample, 8);
  assert.equal(baselines.get("grande")?.median, 5_200); // 5000 likes + 2*100 comentarios
});

test("un post que sobre-performa gana contra uno normal de una cuenta 100x más grande", () => {
  // El caso que motiva todo el diseño: la marca chica con un post que explotó
  // vs la influencer enorme con un post que rindió lo de siempre.
  const posts: ScorablePost[] = [
    ...baselineFor("marca_chica", 5_000, 100),
    ...baselineFor("influencer", 500_000, 5_000),
    post({
      post_id: "viral-chico",
      author_handle: "marca_chica",
      likes_count: 900,
      comments_count: 120,
      author_followers_at_fetch: 5_000,
      posted_at: daysAgo(5),
    }),
    post({
      post_id: "normal-grande",
      author_handle: "influencer",
      likes_count: 5_100,
      comments_count: 100,
      author_followers_at_fetch: 500_000,
      posted_at: daysAgo(5),
    }),
  ];

  const scores = new Map(scorePosts(posts, NOW).map((s) => [s.post_id, s]));
  const viral = scores.get("viral-chico")!;
  const normal = scores.get("normal-grande")!;

  assert.ok(viral.outlier_factor! > 8, `outlier esperado alto, fue ${viral.outlier_factor}`);
  assert.ok(normal.outlier_factor! < 1.5, `outlier esperado ~1, fue ${normal.outlier_factor}`);
  assert.ok(
    viral.viral_score! > normal.viral_score!,
    `el post que sobre-performó debería ganar: ${viral.viral_score} vs ${normal.viral_score}`,
  );
});

test("el piso de alcance descarta el outlier sin volumen", () => {
  // outlier_factor altísimo pero 40 likes: es ruido, no viralidad.
  const posts: ScorablePost[] = [
    ...baselineFor("diminuta", 300, 4),
    ...baselineFor("mediana", 50_000, 1_000),
    post({
      post_id: "ruido",
      author_handle: "diminuta",
      likes_count: 40,
      comments_count: 2,
      author_followers_at_fetch: 300,
      posted_at: daysAgo(5),
    }),
    post({
      post_id: "real",
      author_handle: "mediana",
      likes_count: 6_000,
      comments_count: 400,
      author_followers_at_fetch: 50_000,
      posted_at: daysAgo(5),
    }),
  ];

  const scores = new Map(scorePosts(posts, NOW).map((s) => [s.post_id, s]));
  assert.ok(
    scores.get("real")!.viral_score! > scores.get("ruido")!.viral_score!,
    "un outlier de 40 likes no puede ganarle a uno de 6400",
  );
});

test("excluye posts inmaduros y pineados del ranking", () => {
  const posts: ScorablePost[] = [
    ...baselineFor("cuenta", 10_000, 200),
    post({ post_id: "recien", author_handle: "cuenta", posted_at: daysAgo(0.5), likes_count: 9_000 }),
    post({ post_id: "pin", author_handle: "cuenta", is_pinned: true, likes_count: 9_000 }),
  ];

  const scores = new Map(scorePosts(posts, NOW).map((s) => [s.post_id, s]));
  assert.equal(scores.get("recien")!.viral_score, null);
  assert.equal(scores.get("recien")!.excluded_reason, "immature");
  assert.equal(scores.get("pin")!.viral_score, null);
  assert.equal(scores.get("pin")!.excluded_reason, "pinned");
  // Pero las métricas crudas se calculan igual, para poder mostrarlas.
  assert.ok(scores.get("pin")!.engagement_total > 0);
});

test("sin followers el post sigue puntuando (capas 1 y 3)", () => {
  const posts: ScorablePost[] = [
    ...baselineFor("sinfollowers", 0, 500).map((p) => ({ ...p, author_followers_at_fetch: null })),
    post({
      post_id: "huerfano",
      author_handle: "sinfollowers",
      likes_count: 4_000,
      comments_count: 300,
      author_followers_at_fetch: null,
      posted_at: daysAgo(5),
    }),
  ];

  const score = scorePosts(posts, NOW).find((s) => s.post_id === "huerfano")!;
  assert.equal(score.engagement_rate, null);
  assert.ok(score.viral_score !== null && score.viral_score > 0, "debe puntuar aunque falte el follower count");
  assert.ok(score.outlier_factor! > 5);
});

test("el decaimiento temporal favorece a lo reciente entre iguales", () => {
  const posts: ScorablePost[] = [
    ...baselineFor("cuenta", 10_000, 200),
    post({ post_id: "nuevo", author_handle: "cuenta", likes_count: 2_000, comments_count: 100, posted_at: daysAgo(5) }),
    post({ post_id: "viejo", author_handle: "cuenta", likes_count: 2_000, comments_count: 100, posted_at: daysAgo(120) }),
  ];

  const scores = new Map(scorePosts(posts, NOW).map((s) => [s.post_id, s]));
  assert.ok(scores.get("nuevo")!.viral_score! > scores.get("viejo")!.viral_score!);
});

test("los posts frescos de hashtag no contaminan la baseline del autor", () => {
  // Caso real: el hashtag scraper devuelve lo MÁS RECIENTE, no lo más popular.
  // Esos posts tienen likesCount 0 porque son de hace minutos. Si entran a la
  // mediana, la hunden a 0 y cualquier post normal parece un outlier gigante.
  const historicos = baselineFor("cuenta", 10_000, 500); // 500 likes + 2*10 comments = 520
  const frescosDeHashtag = Array.from({ length: 10 }, (_, i) =>
    post({
      post_id: `fresco-${i}`,
      author_handle: "cuenta",
      likes_count: 0,
      comments_count: 0,
      posted_at: daysAgo(0.02), // minutos
    }),
  );

  const baselines = authorBaselines([...historicos, ...frescosDeHashtag], NOW);
  const baseline = baselines.get("cuenta")!;

  assert.equal(baseline.sample, 8, "solo los 8 maduros deben contar");
  assert.equal(baseline.median, 520, "la mediana no debe verse arrastrada a 0");

  // Y un post normal no debe salir como outlier por culpa de eso.
  const scores = new Map(
    scorePosts(
      [...historicos, ...frescosDeHashtag,
        post({ post_id: "normal", author_handle: "cuenta", likes_count: 500, comments_count: 5, posted_at: daysAgo(5) })],
      NOW,
    ).map((s) => [s.post_id, s]),
  );
  const normal = scores.get("normal")!;
  assert.ok(normal.outlier_factor! < 1.5, `debería ser ~1x, fue ${normal.outlier_factor}`);
});

test("isMature marca el corte en 48h", () => {
  assert.equal(isMature(post({ post_id: "a", author_handle: "x", posted_at: daysAgo(1) }), NOW), false);
  assert.equal(isMature(post({ post_id: "b", author_handle: "x", posted_at: daysAgo(3) }), NOW), true);
  // Sin fecha no podemos afirmar que sea inmaduro: se asume maduro.
  assert.equal(isMature(post({ post_id: "c", author_handle: "x", posted_at: null }), NOW), true);
});

test("una cuenta chica sin historial no queda debajo de una grande con peor rendimiento", () => {
  // Caso real de la primera corrida: @guiacaju (95 likes / 757 followers = 13%)
  // quedaba 5º, debajo de @caju (76 likes / 108k = 0.1%), porque al no tener
  // baseline el término de outlier valía 0 y se comía el 45% del score.
  // Varias cuentas en el tier macro: si hubiera una sola, su cohorte se llenaría
  // con sus propios posts y se compararía contra sí misma, inflando su percentil.
  const posts: ScorablePost[] = [
    ...baselineFor("grande", 108_150, 80),
    ...baselineFor("grande2", 150_000, 300),
    ...baselineFor("grande3", 400_000, 900),
    post({
      post_id: "grande-normal",
      author_handle: "grande",
      likes_count: 76,
      comments_count: 17,
      author_followers_at_fetch: 108_150,
      posted_at: daysAgo(5),
    }),
    // Cuenta recién descubierta: un solo post, sin historial.
    post({
      post_id: "chica-fuerte",
      author_handle: "chica",
      likes_count: 95,
      comments_count: 7,
      author_followers_at_fetch: 757,
      posted_at: daysAgo(5),
    }),
  ];

  const scores = new Map(scorePosts(posts, NOW).map((s) => [s.post_id, s]));
  const chica = scores.get("chica-fuerte")!;
  const grande = scores.get("grande-normal")!;

  assert.equal(chica.outlier_factor, null, "sin historial no hay outlier");
  assert.ok(
    chica.engagement_rate! > grande.engagement_rate! * 50,
    "la chica rinde muchísimo mejor por follower",
  );
  assert.ok(
    chica.viral_score! > grande.viral_score!,
    `no puede perder por falta de historial: ${chica.viral_score} vs ${grande.viral_score}`,
  );
});

test("percentileRank se mantiene neutro con cohortes chicas", () => {
  assert.equal(percentileRank(0.13, [0.13]), 0.5, "compararse contra sí mismo no informa");
  assert.equal(percentileRank(9, [1, 2, 3]), 0.5);
  assert.equal(percentileRank(9, [1, 2, 3, 4, 5]), 1);
});

// ─── LinkedIn ────────────────────────────────────────────────────────────────

test("el engagement de LinkedIn pondera shares por encima de comentarios", () => {
  const p = post({ post_id: "li", author_handle: "x", likes_count: 100, comments_count: 10, shares_count: 5 });
  // 100 + 3*10 + 5*5 = 155
  assert.equal(engagementTotal(p, "linkedin"), 155);
  // Instagram ignora shares: 100 + 2*10 = 120
  assert.equal(engagementTotal(p, "instagram"), 120);
});

test("LinkedIn no usa cohorte de followers", () => {
  assert.equal(SCORING.linkedin.useFollowerCohort, false);
  assert.equal(SCORING.linkedin.weights.cohort, 0);
  // Los dos pesos que quedan tienen que sumar 1: si no, el score no es comparable.
  const w = SCORING.linkedin.weights;
  assert.equal(w.outlier + w.cohort + w.reach, 1);
  const wi = SCORING.instagram.weights;
  assert.ok(Math.abs(wi.outlier + wi.cohort + wi.reach - 1) < 1e-9);
});

test("LinkedIn espera 72h antes de considerar maduro un post", () => {
  const p = post({ post_id: "a", author_handle: "x", posted_at: daysAgo(2.5) }); // 60h
  assert.equal(isMature(p, NOW, "instagram"), true);
  assert.equal(isMature(p, NOW, "linkedin"), false);
});

test("un post traido por busqueda no entra a la mediana del autor", () => {
  // La búsqueda ordena por relevancia: devuelve el TECHO del autor. Si esos
  // posts alimentan su mediana, la mediana se pega al máximo y el outlier
  // colapsa a ~1 para todos — se apaga la capa que más pesa del ranking.
  const cronologicos = baselineFor("autor", 10_000, 100).map((p) => ({ ...p, baseline_eligible: true }));
  const deBusqueda = Array.from({ length: 6 }, (_, i) =>
    post({
      post_id: `busq-${i}`,
      author_handle: "autor",
      likes_count: 5_000,
      comments_count: 200,
      posted_at: daysAgo(10 + i),
      baseline_eligible: false,
    }),
  );

  const conBusqueda = authorBaselines([...cronologicos, ...deBusqueda], NOW);
  const soloCronologicos = authorBaselines(cronologicos, NOW);
  assert.equal(
    conBusqueda.get("autor")!.median,
    soloCronologicos.get("autor")!.median,
    "los posts de búsqueda no deben mover la mediana",
  );
  assert.equal(conBusqueda.get("autor")!.sample, 8);
});

test("el piso de alcance se calcula por mercado, no global", () => {
  // Brasil mueve 10x el volumen de España. Con un P95 global, un post español
  // que arrasa en su mercado quedaba sepultado por el volumen brasileño.
  const br = Array.from({ length: 8 }, (_, i) =>
    post({ post_id: `br-${i}`, author_handle: `br${i}`, likes_count: 10_000,
           comments_count: 100, region: "br", posted_at: daysAgo(10) }),
  );
  const es = Array.from({ length: 8 }, (_, i) =>
    post({ post_id: `es-${i}`, author_handle: `es${i}`, likes_count: 800,
           comments_count: 10, region: "es", posted_at: daysAgo(10) }),
  );
  const estrellaEs = post({
    post_id: "es-top", author_handle: "es0", likes_count: 2_400,
    comments_count: 90, region: "es", posted_at: daysAgo(5),
  });
  const normalBr = post({
    post_id: "br-normal", author_handle: "br0", likes_count: 9_500,
    comments_count: 80, region: "br", posted_at: daysAgo(5),
  });

  const scores = new Map(scorePosts([...br, ...es, estrellaEs, normalBr], NOW).map((s) => [s.post_id, s]));
  assert.ok(
    scores.get("es-top")!.viral_score! > scores.get("br-normal")!.viral_score!,
    "el que sobresale en su mercado debe ganarle al que rinde normal en uno más grande",
  );
});

test("debate_factor detecta el post que se discutió más de lo normal de su autor", () => {
  // Un autor cuyo ratio habitual de comentarios es ~2%. Un post que salta a 20%
  // no tuvo más alcance: tuvo más fricción. viral_score no los distingue.
  const base = (id: string, likes: number, comments: number, dias: number) => ({
    post_id: id,
    author_handle: "@referente",
    likes_count: likes,
    comments_count: comments,
    video_views: null,
    shares_count: null,
    author_followers_at_fetch: 10_000,
    posted_at: new Date(Date.now() - dias * 864e5).toISOString(),
    is_pinned: false,
    region: "br",
  });

  const posts = [
    ...Array.from({ length: 6 }, (_, i) => base(`normal-${i}`, 490, 10, 20 + i)),
    base("polemico", 400, 100, 10),
  ];

  const scores = scorePosts(posts, new Date(), "instagram");
  const byId = new Map(scores.map((s) => [s.post_id, s]));

  const polemico = byId.get("polemico")!;
  const normal = byId.get("normal-0")!;

  assert.ok(polemico.debate_factor !== null, "el post polémico tiene debate medido");
  assert.ok(
    polemico.debate_factor! > 5,
    `esperaba un debate alto, dio ${polemico.debate_factor}`,
  );
  assert.ok(
    (normal.debate_factor ?? 0) < 2,
    "un post con el ratio habitual del autor no es debate",
  );
});

test("sin volumen suficiente el ratio de comentarios no se mide", () => {
  // 1 like y 1 comentario da 50% de ratio y no significa nada.
  const posts = Array.from({ length: 6 }, (_, i) => ({
    post_id: `chico-${i}`,
    author_handle: "@cuenta_chica",
    likes_count: 1,
    comments_count: 1,
    video_views: null,
    shares_count: null,
    author_followers_at_fetch: 100,
    posted_at: new Date(Date.now() - (20 + i) * 864e5).toISOString(),
    is_pinned: false,
    region: "br",
  }));
  const scores = scorePosts(posts, new Date(), "instagram");
  assert.ok(scores.every((s) => s.debate_factor === null), "sin volumen no hay debate medible");
});

test("un collab no entra a la mediana del autor", () => {
  // Ocho posts normales de 100 y cuatro collabs de 5000. Si los collabs
  // entraran, la mediana subiría y el post de 400 dejaría de ser un outlier.
  const base = baselineFor("marca", 10_000, 100);
  const collabs = Array.from({ length: 4 }, (_, i) =>
    post({
      post_id: `collab-${i}`,
      author_handle: "marca",
      likes_count: 5000,
      posted_at: daysAgo(30 + i),
      is_collab: true,
    }),
  );
  const baselines = authorBaselines([...base, ...collabs], NOW);
  assert.equal(baselines.get("marca")?.sample, 8);
  assert.equal(baselines.get("marca")?.median, engagementTotal(base[0]));

  // El collab igual se puntúa: que explotó es un dato, solo que no del contenido.
  const scored = scorePosts([...base, ...collabs], NOW);
  assert.ok((scored.find((s) => s.post_id === "collab-0")?.outlier_factor ?? 0) > 10);
});

test("un lead magnet no tiene debate_factor ni alimenta el del autor", () => {
  // Autor con ratio de comentarios normal (~2%) y un post "comentá GUIA" con
  // 40% de comentarios: eso es un pedido, no fricción.
  const base = baselineFor("autora", 10_000, 500);
  const bait = post({
    post_id: "bait",
    author_handle: "autora",
    likes_count: 300,
    comments_count: 200,
    comment_bait: true,
  });
  const normal = post({
    post_id: "normal",
    author_handle: "autora",
    likes_count: 300,
    comments_count: 200,
  });
  const scored = scorePosts([...base, bait, normal], NOW);
  assert.equal(scored.find((s) => s.post_id === "bait")?.debate_factor, null);
  // El mismo ratio SIN pedido sí se lee como debate.
  assert.ok((scored.find((s) => s.post_id === "normal")?.debate_factor ?? 0) >= 2);
});
