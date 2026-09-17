import test from "node:test";
import assert from "node:assert/strict";

import {
  allocateByLift,
  MAX_PATTERN_SHARE,
  planDates,
  planSlots,
  themeCandidates,
} from "../calendar";
import type { RegionSynthesis } from "../synthesize";

function lift(key: string, value: number) {
  return { key, lift: value, top_count: 5, top_share: 0.2, base_share: 0.1 };
}

test("allocateByLift reparte proporcional al lift medido", () => {
  // Es la regla que hace que el calendario no sea subjetivo: si pov mide 1.65x
  // y pregunta 1.58x, se usan en esa proporción.
  const out = allocateByLift([lift("pov", 1.65), lift("pregunta", 1.58)], 12);
  assert.equal(out.length, 12);
  const pov = out.filter((x) => x === "pov").length;
  const pregunta = out.filter((x) => x === "pregunta").length;
  assert.equal(pov + pregunta, 12);
  // Casi parejo, con ventaja para el de mayor lift.
  assert.ok(pov >= pregunta, `pov(${pov}) debería ir al menos igual que pregunta(${pregunta})`);
  assert.ok(Math.abs(pov - pregunta) <= 2, "no debería concentrarse en uno solo");
});

test("allocateByLift descarta los patrones que rinden por debajo", () => {
  // lift < 1 = se usa pero rinde peor de lo que su frecuencia explicaría.
  const out = allocateByLift([lift("pregunta", 1.5), lift("pov", 0.7)], 10);
  assert.ok(!out.includes("pov"), "un patrón con lift < 1 no entra al calendario");
  assert.equal(out.filter((x) => x === "pregunta").length, 10);
});

test("allocateByLift da un default seguro sin patrones ganadores", () => {
  const out = allocateByLift([], 5);
  assert.equal(out.length, 5);
  assert.ok(out.every((x) => typeof x === "string" && x.length > 0));
  assert.equal(allocateByLift([lift("x", 2)], 0).length, 0);
});

test("allocateByLift reparte el resto por mayor residuo, sin favorecer al primero", () => {
  // 3 patrones iguales en 7 slots: 2/2/2 y un resto. No puede quedar 3/2/2
  // siempre para el primero de la lista.
  const out = allocateByLift([lift("a", 1.5), lift("b", 1.5), lift("c", 1.5)], 7);
  assert.equal(out.length, 7);
  const counts = ["a", "b", "c"].map((k) => out.filter((x) => x === k).length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1);
});

test("planDates publica solo dias habiles y reparte a lo largo del mes", () => {
  // Septiembre 2026: 1 de septiembre es martes.
  const dates = planDates(new Date(Date.UTC(2026, 8, 1)), 3);
  assert.ok(dates.length >= 10 && dates.length <= 16, `fueron ${dates.length}`);
  for (const d of dates) {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    assert.ok(day >= 1 && day <= 5, `${d} cae fin de semana`);
    assert.match(d, /^2026-09-\d{2}$/);
  }
  // Repartidas, no amontonadas: debe haber fechas en la segunda mitad.
  assert.ok(dates.some((d) => Number(d.slice(-2)) > 20));
});

test("planSlots respeta el lift y no inventa fechas fuera del mes", () => {
  const synthesis = {
    region: "br",
    posts_considered: 99,
    top_posts_count: 20,
    winning_hooks: [lift("pov", 1.65), lift("pregunta", 1.58), lift("storytelling", 0.9)],
    winning_themes: [lift("clima_cultura", 1.41)],
    top_topics: [],
    tone_mix: [],
    replicable_ideas: [],
  } satisfies RegionSynthesis;

  const slots = planSlots(synthesis, new Date(Date.UTC(2026, 8, 1)), 2);
  assert.ok(slots.length > 0);
  assert.ok(slots.every((s) => s.date.startsWith("2026-09")));
  // storytelling tiene lift < 1: no debe aparecer.
  assert.ok(!slots.some((s) => s.hook_pattern === "storytelling"));
  assert.ok(slots.every((s) => s.theme === "clima_cultura"));
});

test("themeCandidates garantiza variedad cuando hay un solo tema ganador", () => {
  // Caso real de Brasil: solo clima_cultura superó lift 1, y las 13 piezas del
  // mes salían todas del mismo tema.
  const synthesis = {
    region: "br",
    posts_considered: 99,
    top_posts_count: 20,
    winning_hooks: [lift("pov", 1.65)],
    winning_themes: [lift("clima_cultura", 1.41), lift("liderazgo", 0.87), lift("desempeno", 0.6)],
    top_topics: [],
    tone_mix: [],
    replicable_ideas: [],
  } satisfies RegionSynthesis;

  const candidates = themeCandidates(synthesis);
  assert.ok(candidates.length >= 2, "debe ofrecer más de un tema");
  assert.ok(candidates.every((c) => c.lift > 1), "todos deben poder asignarse");
  assert.equal(candidates[0].key, "clima_cultura", "el ganador real va primero");

  const slots = planSlots(synthesis, new Date(Date.UTC(2026, 9, 1)), 3);
  const temas = new Set(slots.map((s) => s.theme));
  assert.ok(temas.size >= 2, `el calendario no puede ser monotema, fue ${[...temas]}`);
});

test("planSlots acorta el calendario cuando la evidencia no alcanza", () => {
  // Caso real de HISPAM: 1 idea replicable produjo 5 piezas que eran la misma
  // frase reescrita.
  const flaco = {
    region: "hispam",
    posts_considered: 4,
    top_posts_count: 4,
    winning_hooks: null,
    winning_themes: null,
    top_topics: [],
    tone_mix: [],
    replicable_ideas: [
      {
        post_url: "https://x/1",
        author_handle: "a",
        hook: "Comparar es Medir",
        hook_pattern: "pov",
        theme: "comunicacion_interna",
        humand_angle: "Medir la comunicación interna",
        outlier_factor: 3,
      },
    ],
    insufficient_sample: "muestra chica",
  } satisfies RegionSynthesis;

  const slots = planSlots(flaco, new Date(Date.UTC(2026, 9, 1)), 3);
  assert.ok(slots.length <= 2, `con 1 idea no puede planificar ${slots.length} piezas`);
  assert.ok(slots.length >= 1);
  // Y el tema por defecto debe ser un tema, no un patrón de hook.
  assert.ok(!slots.some((s) => s.theme === "pov"), "el fallback del tema no puede ser un hook");
});

test("allocateByLift acepta un fallback propio por dimension", () => {
  assert.deepEqual(allocateByLift([], 2, "clima_cultura"), ["clima_cultura", "clima_cultura"]);
});

test("allocateByLift alterna en vez de emitir bloques", () => {
  // Caso real de España: las primeras seis piezas del mes salían todas
  // storytelling porque el reparto emitía tandas en vez de alternar.
  const out = allocateByLift([lift("storytelling", 3.71), lift("pregunta", 1.48)], 13);
  let maxRacha = 1;
  let racha = 1;
  for (let i = 1; i < out.length; i++) {
    racha = out[i] === out[i - 1] ? racha + 1 : 1;
    maxRacha = Math.max(maxRacha, racha);
  }
  assert.ok(maxRacha <= 2, `no debería haber rachas largas, hubo ${maxRacha}: ${out.join(",")}`);
});

test("ningun patron se come el mes aunque tenga lift altisimo", () => {
  // storytelling 3.71x salía de solo 3 posts: sin tope se llevaba 9 de 13.
  // Con 2 patrones y 13 slots el mínimo alcanzable es 7, así que el tope no
  // puede exigir menos que eso — pero sí tiene que acercarse al reparto parejo.
  const out = allocateByLift([lift("storytelling", 3.71), lift("pregunta", 1.48)], 13);
  const story = out.filter((x) => x === "storytelling").length;
  const minimoPosible = Math.ceil(out.length / 2); // 7
  assert.ok(story <= minimoPosible, `storytelling se llevó ${story}, el mínimo posible era ${minimoPosible}`);
  assert.ok(out.filter((x) => x === "pregunta").length >= 6, "el otro patrón debe tener presencia real");
});

test("el tope se respeta cuando hay patrones suficientes para absorberlo", () => {
  const out = allocateByLift(
    [lift("storytelling", 4), lift("pregunta", 1.5), lift("pov", 1.2), lift("contrarian", 1.1)],
    20,
  );
  const story = out.filter((x) => x === "storytelling").length;
  assert.ok(story / out.length <= MAX_PATTERN_SHARE, `storytelling se llevó ${story}/20`);
  assert.equal(new Set(out).size, 4, "los cuatro patrones deben aparecer");
});

test("con un solo patron ganador no se aplica el tope", () => {
  const out = allocateByLift([lift("pov", 1.6)], 10);
  assert.equal(out.length, 10);
  assert.ok(out.every((x) => x === "pov"), "sin alternativa, el único ganador cubre todo");
});
