import test from "node:test";
import assert from "node:assert/strict";

import { buildAuthorProfile, REPORT_UTC_OFFSET, type ProfilablePost } from "../author-profile";
import type { PostAnalysis } from "../classify";

const AUTHOR = {
  handle: "referente",
  platform: "linkedin",
  full_name: "Una Referente",
  description: "Head of People | Cultura y liderazgo",
  followers_count: null,
};

function analysis(over: Partial<PostAnalysis> = {}): PostAnalysis {
  return {
    is_relevant_to_hr: true,
    theme: "clima_cultura",
    topic: "cultura",
    relevance_reason: "importa al área",
    angle: "un ángulo",
    audience_signal: "hr_leader",
    target_profiles: ["hr_manager"],
    hook: "Un hook",
    hook_pattern: "pov",
    development: "desarrolla",
    structure: "opinion",
    cta: null,
    keywords: ["cultura"],
    expressions: [],
    tone: "educativo",
    hashtag_strategy: "ninguno",
    replicability: "alta",
    humand_angle: "adaptarlo",
    why_it_worked: "porque sí",
    copy_length: 400,
    hashtag_count: 0,
    ...over,
  };
}

function post(id: string, iso: string | null, over: Partial<ProfilablePost> = {}): ProfilablePost {
  return {
    post_id: id,
    post_url: `https://x/${id}`,
    posted_at: iso,
    format: "text",
    viral_score: 0.5,
    outlier_factor: 2,
    analysis: analysis(),
    ...over,
  };
}

test("el calendario se mide sobre la ventana observada, no sobre el mes", () => {
  // 8 posts en 4 semanas exactas = 2 por semana. Si se asumiera "mes calendario"
  // con solo 4 semanas de data, se estaría inventando.
  const posts = Array.from({ length: 8 }, (_, i) =>
    post(`p${i}`, new Date(Date.UTC(2026, 8, 1 + i * 3, 15)).toISOString()),
  );
  const profile = buildAuthorProfile(AUTHOR, posts);
  assert.ok(profile.calendar.posts_per_week >= 2 && profile.calendar.posts_per_week <= 4);
  assert.equal(profile.posts_analyzed, 8);
  assert.ok(profile.calendar.first_post! < profile.calendar.last_post!);
});

test("los patrones de día y hora usan la zona de reporte, no UTC", () => {
  // 2026-09-07 02:00 UTC es domingo 23:00 en GMT-3: el día tiene que ser el 0
  // (domingo) y no el 1 (lunes) que daría leerlo en UTC.
  const profile = buildAuthorProfile(AUTHOR, [post("a", "2026-09-07T02:00:00Z")]);
  assert.equal(REPORT_UTC_OFFSET, -3);
  assert.equal(profile.calendar.by_weekday[0].day, 0);
  assert.equal(profile.calendar.by_hour[0].hour, 23);
});

test("los ejes tematicos salen del analisis y traen su proporcion", () => {
  const posts = [
    post("a", "2026-09-01T12:00:00Z"),
    post("b", "2026-09-02T12:00:00Z"),
    post("c", "2026-09-03T12:00:00Z", { analysis: analysis({ theme: "liderazgo" }) }),
  ];
  const profile = buildAuthorProfile(AUTHOR, posts);
  assert.equal(profile.content_pillars[0].key, "clima_cultura");
  assert.equal(profile.content_pillars[0].count, 2);
  assert.ok(Math.abs(profile.content_pillars[0].share - 0.667) < 0.01);
});

test("la estrategia resume foco, CTA y largo sin llamar al modelo", () => {
  const posts = [
    post("a", "2026-09-01T12:00:00Z", { analysis: analysis({ cta: "Contame tu caso", copy_length: 200 }) }),
    post("b", "2026-09-02T12:00:00Z", { analysis: analysis({ copy_length: 600 }) }),
    post("c", "2026-09-03T12:00:00Z", {
      analysis: analysis({ is_relevant_to_hr: false, copy_length: 400 }),
    }),
  ];
  const profile = buildAuthorProfile(AUTHOR, posts);
  assert.ok(Math.abs(profile.strategy.hr_focus - 0.67) < 0.02, "2 de 3 relevantes");
  assert.ok(Math.abs(profile.strategy.cta_rate - 0.33) < 0.02, "1 de 3 con CTA");
  assert.equal(profile.strategy.median_copy_length, 400);
  assert.equal(profile.strategy.dominant_hashtag_strategy, "ninguno");
});

test("aguanta posts sin fecha y sin analisis", () => {
  const profile = buildAuthorProfile(AUTHOR, [
    post("sin-fecha", null, { analysis: null }),
    post("sin-analisis", "2026-09-01T12:00:00Z", { analysis: null }),
  ]);
  assert.equal(profile.posts_analyzed, 2);
  assert.equal(profile.content_pillars.length, 0, "sin análisis no hay ejes temáticos");
  assert.equal(profile.strategy.hr_focus, 0);
  assert.equal(profile.strategy.median_copy_length, null);
  // El sin-fecha no puede romper el calendario ni contarse como publicación.
  assert.equal(profile.calendar.by_weekday.length, 1);
  assert.ok(profile.calendar.first_post !== null);
});

test("la descripcion de cuenta se preserva: es lo que pide el brief", () => {
  const profile = buildAuthorProfile(AUTHOR, [post("a", "2026-09-01T12:00:00Z")]);
  assert.equal(profile.description, "Head of People | Cultura y liderazgo");
  assert.equal(profile.full_name, "Una Referente");
});
