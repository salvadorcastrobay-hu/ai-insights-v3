import assert from "node:assert/strict";
import { test } from "node:test";

import { checkHookPattern } from "../classify";

import {
  aspectRatio,
  brandMention,
  computeFeatures,
  countListLines,
  coverFeatures,
  distributionBoost,
  dominantReaction,
  firstLineSignals,
  hashtagStrategy,
  languageMismatch,
  linkedInMentions,
  linkedInPageCount,
  linkPlacement,
  narrativeVoice,
  repostKind,
  sponsoredSignal,
} from "../post-features";

test("las menciones de LinkedIn salen de contentAttributes, no del texto", () => {
  // El bug real: 158 posts daban cero menciones teniéndolas, porque se contaba
  // @handle en el texto y LinkedIn las marca aparte.
  const raw = {
    contentAttributes: [
      { type: "PROFILE_MENTION" },
      { type: "PROFILE_MENTION" },
      { type: "COMPANY_NAME" },
      { type: "HASHTAG" },
    ],
  };
  assert.deepEqual(linkedInMentions(raw), { persons: 2, companies: 1 });
});

test("el carrusel PDF de LinkedIn sí expone sus páginas", () => {
  // slideCount devolvía null para todos los carruseles de LinkedIn.
  assert.equal(linkedInPageCount({ document: { totalPageCount: 9 } }), 9);
  assert.equal(linkedInPageCount({ document: {} }), null);
  const f = computeFeatures(
    {
      platform: "linkedin",
      caption: "x",
      format: null,
      media: null,
      posted_at: null,
      duration_secs: null,
      raw: { document: { totalPageCount: 7 } },
    },
    "es",
  );
  assert.equal(f.format_detail, "carrusel");
  assert.equal(f.slide_count, 7);
  assert.equal(f.slide_bucket, "5-7");
});

test("la voz narrativa distingue yo, nosotros y la marca impersonal", () => {
  assert.equal(
    narrativeVoice("Yo pensaba que mi equipo me necesitaba siempre, y mi error fue no delegar nunca."),
    "yo",
  );
  assert.equal(
    narrativeVoice("En nuestro equipo aprendimos que nuestra cultura nos define y nos sostiene cada día."),
    "nosotros",
  );
  assert.equal(
    narrativeVoice("La gestión del talento requiere procesos claros y métricas consistentes en toda la organización."),
    "impersonal",
  );
  assert.equal(
    narrativeVoice("Eu achava que meu time precisava de mim, mas minha falha foi não confiar neles."),
    "yo",
  );
});

test("una lista se cuenta por sus ítems, con viñeta, número o emoji", () => {
  const texto = "Tres claves:\n1. Escuchar\n2. Decidir\n• Medir\n✅ Repetir\nY listo.";
  assert.equal(countListLines(texto), 4);
});

test("el hook se mide sin modelo: número, pregunta y largo", () => {
  assert.deepEqual(firstLineSignals("¿Cuántas veces te pasó esto en 2025?"), {
    hasNumber: true,
    isQuestion: true,
    words: 7,
  });
});

test("el link en comentarios no es lo mismo que el link en el texto", () => {
  // LinkedIn castiga el link en el cuerpo; "link en comentarios" es el truco
  // para esquivarlo. has_external_link los mezclaba.
  assert.equal(linkPlacement("linkedin", "Te dejo la guía https://x.com/a", {}), "en_texto");
  assert.equal(linkPlacement("linkedin", "El link está en los comentarios 👇", {}), "en_comentarios");
  assert.equal(linkPlacement("instagram", "Link en la bio", {}), "en_bio");
  assert.equal(linkPlacement("linkedin", "Leé esto", { article: { link: "https://x.com" } }), "preview_articulo");
  assert.equal(linkPlacement("linkedin", "Sin links acá", {}), "ninguno");
});

test("la proporción del creativo sale de las dimensiones del raw", () => {
  assert.equal(aspectRatio("instagram", { dimensionsWidth: 1080, dimensionsHeight: 1350 }), "vertical_4_5");
  assert.equal(aspectRatio("instagram", { dimensionsWidth: 720, dimensionsHeight: 1280 }), "vertical_9_16");
  assert.equal(aspectRatio("instagram", { dimensionsWidth: 1080, dimensionsHeight: 1080 }), "cuadrado");
  assert.equal(aspectRatio("linkedin", { postImages: [{ width: 1200, height: 627 }] }), "horizontal");
  assert.equal(aspectRatio("instagram", {}), null);
});

test("el alcance prestado se detecta y se combina", () => {
  assert.equal(distributionBoost("instagram", { taggedUsers: [{}] }, 0), "etiquetas");
  assert.equal(distributionBoost("instagram", { coauthorProducers: [{}] }, 0), "collab");
  assert.equal(distributionBoost("instagram", { taggedUsers: [{}] }, 2), "varios");
  assert.equal(distributionBoost("linkedin", { header: { text: "Ana collaborated on this" } }, 0), "collab");
  assert.equal(distributionBoost("linkedin", {}, 0), "ninguno");
});

test("los competidores ambiguos no generan falsos positivos", () => {
  // "Senior", "Flash" y "Dialog" quedan afuera a propósito.
  assert.equal(brandMention("Buscamos un perfil senior para el equipo", 0), "ninguno");
  assert.equal(brandMention("Comparamos Gupy y Buk para el onboarding", 0), "competidor");
  assert.equal(brandMention("Con Humand lo resolvimos", 0), "propio");
  assert.equal(brandMention("Gracias a la gente de KES", 1), "tercero");
});

test("la colaboración paga se detecta por UTM, hashtag o marca de plataforma", () => {
  assert.equal(sponsoredSignal("x", {}, true), "paid_partnership");
  assert.equal(
    sponsoredSignal("x", { article: { link: "https://a.com/?utm_medium=influenciadores" } }, false),
    "utm_influencer",
  );
  assert.equal(sponsoredSignal("Nuevo curso #publi", {}, false), "hashtag_publi");
  assert.equal(sponsoredSignal("Nada pago", {}, false), "ninguna");
});

test("la reacción dominante ignora el like y exige volumen", () => {
  const muchas = [
    { type: "LIKE", count: 80 },
    { type: "EMPATHY", count: 30 },
    { type: "PRAISE", count: 5 },
  ];
  assert.equal(dominantReaction(muchas), "empatia");
  assert.equal(dominantReaction([{ type: "LIKE", count: 50 }]), "solo_like");
  assert.equal(dominantReaction([{ type: "EMPATHY", count: 3 }]), null, "con poco volumen no se afirma");
});

test("el idioma desalineado con el mercado se marca", () => {
  assert.equal(languageMismatch("es", "br"), true);
  assert.equal(languageMismatch("pt", "br"), false);
  assert.equal(languageMismatch("es", "hispam"), false);
  assert.equal(languageMismatch(null, "br"), null);
});

test("el repost se separa del post original", () => {
  assert.equal(repostKind("linkedin", "", { repost: { id: "1" } }), "repost_puro");
  assert.equal(repostKind("linkedin", "Esto me pareció clave para todo líder de RRHH.", { repost: { id: "1" } }), "repost_con_texto");
  assert.equal(repostKind("linkedin", "x", {}), "original");
});

test("la estrategia de hashtags se cuenta, no se le pregunta a un modelo", () => {
  assert.equal(hashtagStrategy("Sin hashtags", []), "ninguno");
  assert.equal(hashtagStrategy("Texto #rrhh #liderazgo", []), "pocos_genericos");
  assert.equal(hashtagStrategy("Texto #onboardingremoto #pulsosemanal", []), "de_nicho");
  assert.equal(hashtagStrategy("Texto #rrhh #onboardingremoto", []), "mixto");
});

test("el texto de portada se mide gratis sobre el OCR", () => {
  const f = coverFeatures("5 errores que cometen\nlos líderes nuevos");
  assert.equal(f.cover_bucket, "1-8");
  assert.equal(f.cover_has_number, true);
  assert.equal(f.cover_is_list_promise, true);
  assert.equal(coverFeatures(null).cover_bucket, "0");
});

test("la primera persona se detecta aunque el español y el portugués omitan el pronombre", () => {
  // Casos reales que se clasificaban como impersonales.
  assert.equal(narrativeVoice("Hoje tivemos a oportunidade de viver uma experiência especial com a gente do time."), "nosotros");
  assert.equal(narrativeVoice("Que honra fechar o mês sabendo que estou na lista. Sou muito grata por isso."), "yo");
  assert.equal(narrativeVoice("Estamos en tiempos de fatiga de cambio y tenemos que repensar cómo acompañamos."), "nosotros");
  assert.equal(narrativeVoice("Há algum tempo eu buscava uma forma diferente de trabalhar escuta e confiança."), "yo");
});

test("checkHookPattern corrige lo que la primera línea desmiente", () => {
  assert.equal(checkHookPattern("dato_numero", "Las empresas se rompen por el..."), "afirmacion_tajante");
  assert.equal(checkHookPattern("dato_numero", "El 70% de los líderes no escucha"), "dato_numero");
  assert.equal(checkHookPattern("pregunta", "como pode né"), "afirmacion_tajante");
  assert.equal(checkHookPattern("pregunta", "¿Qué te parece?"), "pregunta");
  assert.equal(checkHookPattern("escena_narrativa", "Estaba hablando con un gerente"), "escena_narrativa");
});
