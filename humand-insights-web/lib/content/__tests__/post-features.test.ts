import test from "node:test";
import assert from "node:assert/strict";

import {
  computeFeatures,
  detectLanguage,
  endsWithQuestion,
  firstLine,
  isCommentBait,
  linkedInFormat,
  localTime,
  nonLikeShare,
  slideBucket,
  videoLength,
  type FeaturablePost,
} from "../post-features";

function li(raw: Record<string, unknown>, over: Partial<FeaturablePost> = {}): FeaturablePost {
  return {
    platform: "linkedin",
    caption: "Texto",
    format: "text",
    media: { images: [], videos: [] },
    posted_at: null,
    duration_secs: null,
    raw,
    ...over,
  };
}

function ig(raw: Record<string, unknown>, over: Partial<FeaturablePost> = {}): FeaturablePost {
  return {
    platform: "instagram",
    caption: "Texto",
    format: "image",
    media: { images: ["a.jpg"], videos: [] },
    posted_at: null,
    duration_secs: null,
    raw,
    ...over,
  };
}

// ─── Formato ─────────────────────────────────────────────────────────────────

test("linkedInFormat: lee el formato real del raw, no solo si hay imagen", () => {
  assert.equal(linkedInFormat({ postVideo: { videoUrl: "x" }, postImages: [{ url: "p" }] }), "video");
  assert.equal(linkedInFormat({ document: { title: "PDF" } }), "document");
  assert.equal(linkedInFormat({ poll: { question: "?" } }), "poll");
  // El newsletter trae además un article con el link a la edición.
  assert.equal(linkedInFormat({ newsletterTitle: "Ganas y Canas", article: { link: "x" } }), "newsletter");
  assert.equal(linkedInFormat({ article: { link: "https://pwc.com" } }), "article");
  assert.equal(linkedInFormat({ postImages: [{ url: "p" }] }), "image");
  assert.equal(linkedInFormat({ postImages: [], article: null }), "text");
});

test("computeFeatures: formato detallado cruza plataformas", () => {
  assert.equal(computeFeatures(li({ document: { title: "x" } }), "br").format_detail, "carrusel");
  assert.equal(
    computeFeatures(li({ postImages: [{}, {}] }, { media: { images: ["a", "b"], videos: [] } }), "br")
      .format_detail,
    "multi_imagen",
  );
  assert.equal(computeFeatures(ig({ productType: "clips" }, { format: "video" }), "br").format_detail, "reel");
  assert.equal(computeFeatures(ig({ productType: "feed" }, { format: "video" }), "br").format_detail, "video");
  assert.equal(computeFeatures(ig({}, { format: "sidecar" }), "br").format_detail, "carrusel");
});

test("computeFeatures: placas del carrusel y bucket", () => {
  const f = computeFeatures(
    ig({ childPosts: [{}, {}, {}, {}, {}, {}] }, { format: "sidecar", media: { images: ["1", "2"], videos: [] } }),
    "br",
  );
  assert.equal(f.slide_count, 6);
  assert.equal(f.slide_bucket, "5-7");
  // Una foto suelta no es un carrusel de una placa.
  assert.equal(computeFeatures(ig({}), "br").slide_count, null);
});

test("slideBucket y videoLength", () => {
  assert.equal(slideBucket(null), null);
  assert.equal(slideBucket(3), "2-4");
  assert.equal(slideBucket(12), "11+");
  assert.equal(videoLength(null), null);
  assert.equal(videoLength(9), "<15s");
  assert.equal(videoLength(45), "30-60s");
  assert.equal(videoLength(180), "1-3min");
  assert.equal(videoLength(400), ">3min");
});

// ─── Copy ────────────────────────────────────────────────────────────────────

test("firstLine: la primera línea con texto, no la primera línea", () => {
  assert.equal(firstLine("\n\n  Hola mundo  \nsegunda"), "Hola mundo");
  assert.equal(firstLine(""), null);
  assert.equal(firstLine(null), null);
});

test("endsWithQuestion: mira el último bloque sin hashtags", () => {
  assert.equal(endsWithQuestion("Un post.\n\n¿Y ustedes qué hacen?\n\n#rrhh #cultura"), true);
  assert.equal(endsWithQuestion("¿Pregunta al inicio?\n\nY después una afirmación."), false);
  assert.equal(endsWithQuestion("¿Te pasó? 👇"), true);
});

test("computeFeatures: cuenta párrafos, emojis, links y menciones", () => {
  const f = computeFeatures(
    li({}, { caption: "Primera línea 🚀\n\nSegundo bloque con link https://lnkd.in/abc\n\nTercero @maria.p 🙌" }),
    "es",
  );
  assert.equal(f.first_line, "Primera línea 🚀");
  assert.equal(f.paragraphs, 3);
  assert.equal(f.emoji_count, 2);
  assert.equal(f.has_external_link, true);
  assert.equal(f.mention_count, 1);
  // Un dígito o un # no son emojis aunque Unicode los marque "Emoji".
  assert.equal(computeFeatures(li({}, { caption: "Top 10 #rrhh" }), "es").emoji_count, 0);
});

// ─── Lead magnet ─────────────────────────────────────────────────────────────

test("isCommentBait: detecta los pedidos reales del corpus", () => {
  for (const text of [
    "Comente “PIPELINE” que eu envio gratuitamente.",
    "Comenta CAJU aqui que a gente te manda o link no privado. 👇",
    "Comenta AUTONOMIA que eu te mando por DM o link",
    "Comente AM26 e receba gratuitamente o link da próxima aula.",
    "Comente “One” e descubra as novidades do Agente de IA",
    "Comenta MIEDO y te enviamos la entrevista completa",
    "Se vienen leyes nuevas. Comenta ASISTENCIA y te mando el enlace.",
    "si quiere estar con nosotros, comenta aqui que te mando o link de pré-inscrição.",
  ]) {
    assert.equal(isCommentBait(text), true, text);
  }
});

test("isCommentBait: no confunde un 'dejar de' o una cita con un pedido", () => {
  for (const text of [
    'Hay que dejar de decir "sí, pero…" y empezar a decir "sí, y…".',
    'dejando atrás la "revisión anual" para pasar a reconocimiento inmediato',
    "Dejar a las personas con la palabra en la boca y no contestar...",
    "¿Qué opinan? Los leo en comentarios.",
    'Si van a comentar “te faltó X”: probablemente tengan razón.',
  ]) {
    assert.equal(isCommentBait(text), false, text);
  }
});

// ─── Collab, audio, patrocinio, autor ────────────────────────────────────────

test("computeFeatures: collab, audio y patrocinio en Instagram", () => {
  const f = computeFeatures(
    ig(
      {
        productType: "clips",
        coauthorProducers: [{ username: "caju" }],
        musicInfo: { uses_original_audio: false },
      },
      { format: "video", duration_secs: 22, caption: "Algo *publi" },
    ),
    "br",
  );
  assert.equal(f.is_collab, true);
  assert.equal(f.audio, "musica");
  assert.equal(f.video_length, "15-30s");
  assert.equal(f.is_sponsored, true);
  // Una foto no tiene audio.
  assert.equal(computeFeatures(ig({ musicInfo: { uses_original_audio: true } }), "br").audio, null);
});

test("computeFeatures: persona o empresa sale del raw de LinkedIn", () => {
  assert.equal(computeFeatures(li({ author: { type: "company" } }), "es").author_type, "empresa");
  assert.equal(computeFeatures(li({ author: { type: "profile" } }), "es").author_type, "persona");
  assert.equal(computeFeatures(ig({}), "es").author_type, null);
});

// ─── Hora local ──────────────────────────────────────────────────────────────

test("localTime: la franja va en el huso del mercado, no en UTC", () => {
  // 11:30 UTC de un lunes = 08:30 en São Paulo, 13:30 en Madrid.
  assert.deepEqual(localTime("2026-09-21T11:30:00Z", "br"), { weekday: "lun", daypart: "manana" });
  assert.deepEqual(localTime("2026-09-21T11:30:00Z", "es"), { weekday: "lun", daypart: "tarde" });
  // 02:00 UTC del martes sigue siendo lunes a la noche en Bogotá.
  assert.deepEqual(localTime("2026-09-22T02:00:00Z", "hispam"), { weekday: "lun", daypart: "noche" });
  // Sin mercado conocido no se inventa un huso.
  assert.equal(localTime("2026-09-21T11:30:00Z", "global"), null);
  assert.equal(localTime(null, "br"), null);
});

// ─── Reacciones ──────────────────────────────────────────────────────────────

test("nonLikeShare: proporción de reacciones que no son el like por defecto", () => {
  assert.equal(
    nonLikeShare([
      { type: "LIKE", count: 60 },
      { type: "EMPATHY", count: 30 },
      { type: "INTEREST", count: 10 },
    ]),
    0.4,
  );
  // Con pocas reacciones la proporción es ruido.
  assert.equal(nonLikeShare([{ type: "LIKE", count: 3 }, { type: "PRAISE", count: 2 }]), null);
  assert.equal(nonLikeShare(null), null);
});

test("detectLanguage separa portugués de español sin mirar 'de' ni 'que'", () => {
  assert.equal(detectLanguage("Cultura não é um lugar. É um conjunto de comportamentos que a liderança incentiva."), "pt");
  assert.equal(detectLanguage("La cultura no es un lugar, es lo que el liderazgo tolera y hay que decirlo."), "es");
  assert.equal(detectLanguage("Culture is not a place, it is what your leadership team tolerates."), "en");
  // Muy corto para afirmar nada.
  assert.equal(detectLanguage("E você?"), null);
});
