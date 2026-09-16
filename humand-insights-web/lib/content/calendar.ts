/**
 * Generador de calendario de contenidos.
 *
 * El pedido original de la reunión: dejar de armar el calendario "a ciegas y
 * por subjetividad", y que salga de lo que efectivamente funcionó.
 *
 * Reparto de responsabilidades, igual que en `src/agents/marketing_advisor.py`:
 * todo lo que se puede decidir con datos se decide en CÓDIGO —cuántos posts,
 * qué días, qué mezcla de hooks, sobre qué evidencia— y el modelo solo escribe
 * el texto de cada pieza. Así dos corridas sobre los mismos datos dan el mismo
 * esqueleto, y la mezcla de hooks refleja el lift medido y no la intuición del
 * modelo.
 */
import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import type { RegionSynthesis } from "./synthesize";

function calendarModel(): string {
  return (
    process.env.CONTENT_CALENDAR_MODEL ??
    process.env.CONTENT_ANALYSIS_MODEL ??
    "gpt-4o"
  );
}

/** Tope de participación de un patrón en el mes. */
export const MAX_PATTERN_SHARE = 0.45;

/** Lunes a viernes: el contenido B2B de RRHH no se consume el fin de semana. */
const PUBLISH_WEEKDAYS = [1, 2, 3, 4, 5];

export type CalendarSlot = {
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** Patrón asignado determinísticamente según el lift medido. */
  hook_pattern: string;
  theme: string;
};

/**
 * Reparte los patrones ganadores proporcionalmente a su lift.
 *
 * Es el corazón de "que no sea subjetivo": si `pov` mide 1.65x y `pregunta`
 * 1.58x en Brasil, el calendario los usa en esa proporción. Un patrón con lift
 * menor a 1 —se usa pero rinde por debajo— no entra.
 */
export function allocateByLift(
  patterns: Array<{ key: string; lift: number }>,
  slots: number,
  fallback = "pov",
): string[] {
  const winners = patterns.filter((p) => p.lift > 1);
  if (!winners.length || slots <= 0) return Array(Math.max(0, slots)).fill(fallback);

  const totalLift = winners.reduce((acc, p) => acc + p.lift, 0);

  // Reparto proporcional con redondeo hacia abajo...
  const exact = winners.map((p) => ({ key: p.key, want: (p.lift / totalLift) * slots }));
  const counts = new Map<string, number>(exact.map((e) => [e.key, Math.floor(e.want)]));

  // ...y los que sobran van a los de mayor resto, que preserva la proporción sin
  // favorecer sistemáticamente al primero de la lista.
  const remainders = exact
    .map((item) => ({ key: item.key, rest: item.want - Math.floor(item.want) }))
    .sort((a, b) => b.rest - a.rest);
  let assigned = [...counts.values()].reduce((a, b) => a + b, 0);
  let index = 0;
  while (assigned < slots && remainders.length) {
    const key = remainders[index % remainders.length].key;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    assigned += 1;
    index += 1;
  }

  // Tope por patrón: un lift alto medido sobre pocos posts no justifica que un
  // patrón se coma el mes. En España, storytelling (3.71x sobre 3 posts) se
  // llevaba las primeras seis piezas seguidas.
  if (winners.length > 1) {
    const cap = Math.max(1, Math.ceil(slots * MAX_PATTERN_SHARE));
    for (const [key, count] of counts) {
      if (count <= cap) continue;
      let excess = count - cap;
      counts.set(key, cap);
      for (const other of winners) {
        if (!excess) break;
        if (other.key === key) continue;
        const take = Math.min(excess, cap - (counts.get(other.key) ?? 0));
        if (take > 0) {
          counts.set(other.key, (counts.get(other.key) ?? 0) + take);
          excess -= take;
        }
      }
      // Si nadie puede absorberlo, se lo queda igual: mejor exceder el tope que
      // devolver menos piezas de las pedidas.
      if (excess) counts.set(key, cap + excess);
    }
  }

  return interleave(counts, slots);
}

/**
 * Alterna los patrones en vez de emitirlos en bloques.
 *
 * El reparto proporcional daba la cantidad correcta pero en tandas: las
 * primeras seis piezas del mes salían todas iguales. Para un calendario lo que
 * importa es que se alternen.
 */
function interleave(counts: Map<string, number>, slots: number): string[] {
  const pending = [...counts.entries()]
    .filter(([, n]) => n > 0)
    .map(([key, n]) => ({ key, left: n }))
    .sort((a, b) => b.left - a.left);

  const out: string[] = [];
  while (out.length < slots && pending.some((p) => p.left > 0)) {
    // En cada vuelta se toma el que más pendientes tenga, evitando repetir el
    // anterior siempre que haya alternativa.
    const candidates = pending.filter((p) => p.left > 0);
    const next =
      candidates.find((p) => p.key !== out[out.length - 1]) ?? candidates[0];
    out.push(next.key);
    next.left -= 1;
    pending.sort((a, b) => b.left - a.left);
  }
  return out.slice(0, slots);
}

/**
 * Fechas de publicación del mes, repartidas de lunes a viernes.
 *
 * Determinístico a propósito: la fecha no es una decisión creativa y dejársela
 * al modelo solo agrega variación entre corridas.
 */
export function planDates(monthStart: Date, postsPerWeek: number): string[] {
  const year = monthStart.getUTCFullYear();
  const month = monthStart.getUTCMonth();
  const dates: string[] = [];

  const weekdays: Date[] = [];
  for (let day = 1; day <= 31; day++) {
    const d = new Date(Date.UTC(year, month, day));
    if (d.getUTCMonth() !== month) break;
    if (PUBLISH_WEEKDAYS.includes(d.getUTCDay())) weekdays.push(d);
  }
  if (!weekdays.length) return dates;

  // Se reparte parejo a lo largo del mes en vez de amontonar al principio.
  const totalSlots = Math.max(1, Math.round((weekdays.length / 5) * postsPerWeek));
  const step = weekdays.length / totalSlots;
  for (let i = 0; i < totalSlots; i++) {
    const picked = weekdays[Math.min(weekdays.length - 1, Math.floor(i * step))];
    dates.push(picked.toISOString().slice(0, 10));
  }
  return dates;
}

/** Mínimo de temas distintos para que el calendario no sea monotema. */
export const MIN_THEME_VARIETY = 3;

/**
 * Candidatos a tema, con variedad garantizada.
 *
 * El reparto por lift a secas colapsa: en Brasil solo `clima_cultura` superó el
 * umbral de lift, así que las 13 piezas del mes salían del mismo tema. Un
 * calendario monotema no le sirve a nadie. Cuando faltan ganadores claros se
 * completa con los temas que efectivamente aparecen arriba, aunque su lift no
 * los destaque — están presentes en lo que funcionó, que es suficiente para
 * variar sin inventar.
 */
export function themeCandidates(synthesis: RegionSynthesis): Array<{ key: string; lift: number }> {
  const winners = (synthesis.winning_themes ?? []).filter((t) => t.lift > 1);
  if (winners.length >= MIN_THEME_VARIETY) return winners;

  const seen = new Set(winners.map((t) => t.key));
  const extra = (synthesis.winning_themes ?? [])
    .filter((t) => !seen.has(t.key))
    .sort((a, b) => b.lift - a.lift)
    // Lift levemente por debajo de 1 es "se usa tanto arriba como abajo": vale
    // como relleno de variedad, no como recomendación.
    .map((t) => ({ key: t.key, lift: Math.max(1.01, t.lift) }));

  return [...winners, ...extra].slice(0, MIN_THEME_VARIETY);
}

/** Arma el esqueleto del calendario, sin LLM. */
export function planSlots(
  synthesis: RegionSynthesis,
  monthStart: Date,
  postsPerWeek: number,
): CalendarSlot[] {
  let dates = planDates(monthStart, postsPerWeek);

  // Con evidencia floja, generar un mes entero produce la misma idea parafraseada
  // N veces. Mejor pocas piezas respaldadas que muchas inventadas.
  if (synthesis.insufficient_sample) {
    const cap = Math.max(1, synthesis.replicable_ideas.length * 2);
    dates = dates.slice(0, cap);
  }

  const hooks = allocateByLift(synthesis.winning_hooks ?? [], dates.length, "pov");
  const themes = allocateByLift(themeCandidates(synthesis), dates.length, "clima_cultura");
  return dates.map((date, i) => ({
    date,
    hook_pattern: hooks[i] ?? "pov",
    theme: themes[i] ?? "clima_cultura",
  }));
}

const CalendarEntrySchema = z.object({
  slot_index: z.number().int(),
  title: z.string().describe("Título interno de la pieza, corto y concreto."),
  hook: z.string().describe("La primera línea del post, tal como se publicaría."),
  angle: z.string().describe("De qué trata y qué sostiene, en una o dos oraciones."),
  format: z
    .enum(["texto", "carrusel", "video", "imagen"])
    .describe("Formato sugerido para la pieza."),
  cta: z.string().nullable().describe("Cierre o llamada a la acción. Null si no corresponde."),
  based_on: z
    .string()
    .describe("Qué evidencia del brief respalda esta pieza: el post o patrón concreto."),
});

const CalendarSchema = z.object({ entries: z.array(CalendarEntrySchema) });

export type CalendarEntry = z.infer<typeof CalendarEntrySchema> & CalendarSlot;

export type ContentCalendar = {
  region: string;
  month: string;
  generated_at: string;
  model: string;
  /** Evidencia sobre la que se generó, para poder auditar el calendario. */
  evidence: {
    posts_considered: number;
    top_posts_count: number;
    winning_hooks: Array<{ key: string; lift: number }>;
    winning_themes: Array<{ key: string; lift: number }>;
  };
  entries: CalendarEntry[];
  warnings: string[];
};

function buildBrief(synthesis: RegionSynthesis, slots: CalendarSlot[]): string {
  const lines: string[] = [];
  lines.push(`MERCADO: ${synthesis.region}`);
  lines.push(`Base: ${synthesis.posts_considered} posts de referentes de RRHH que rindieron.`);

  if (synthesis.winning_hooks?.length) {
    lines.push("\nHOOKS QUE MEJOR RINDEN (lift sobre su frecuencia base):");
    for (const h of synthesis.winning_hooks.slice(0, 6)) {
      lines.push(`- ${h.key}: ${h.lift}x (${h.top_count} posts en el corte superior)`);
    }
  }
  if (synthesis.winning_themes?.length) {
    lines.push("\nTEMAS QUE MEJOR RINDEN:");
    for (const t of synthesis.winning_themes.slice(0, 6)) {
      lines.push(`- ${t.key}: ${t.lift}x (${t.top_count})`);
    }
  }
  if (synthesis.top_topics.length) {
    lines.push("\nDE QUÉ SE HABLA: " + synthesis.top_topics.map((t) => t.key).join(", "));
  }
  if (synthesis.tone_mix.length) {
    lines.push("TONOS: " + synthesis.tone_mix.map((t) => t.key).join(", "));
  }
  if (synthesis.replicable_ideas.length) {
    lines.push("\nPOSTS CONCRETOS QUE FUNCIONARON:");
    for (const idea of synthesis.replicable_ideas) {
      lines.push(
        `- [${idea.hook_pattern}] "${idea.hook ?? ""}" (${
          idea.outlier_factor ? `${idea.outlier_factor.toFixed(1)}x` : "?"
        } sobre el promedio del autor)`,
      );
      lines.push(`  ángulo para Humand: ${idea.humand_angle}`);
    }
  }

  lines.push("\nPIEZAS A ESCRIBIR (el patrón y el tema ya están asignados, respetalos):");
  slots.forEach((slot, i) => {
    lines.push(`${i + 1}. ${slot.date} · hook_pattern=${slot.hook_pattern} · tema=${slot.theme}`);
  });

  return lines.join("\n");
}

const SYSTEM = [
  "Sos el equipo de Content de Humand, software de RRHH (comunicación interna,",
  "cultura, gestión de personas) para empresas medianas y grandes.",
  "",
  "Te paso evidencia de qué contenido funcionó en un mercado y una lista de piezas",
  "a escribir, cada una con su patrón de hook y su tema ya asignados —salieron de",
  "medir el rendimiento real, no los cambies—.",
  "",
  "Para cada pieza escribí el hook como se publicaría, en el idioma del mercado",
  "(portugués para Brasil, español para España e HISPAM).",
  "",
  "Reglas:",
  "- Le hablás a quien GESTIONA personas, no a quien busca trabajo.",
  "- Nada de vender Humand de frente: el contenido aporta valor, el producto",
  "  aparece a lo sumo como cierre natural.",
  "- En `based_on` citá la evidencia concreta del brief que respalda la pieza.",
  "- Devolvé una entrada por pieza, con su slot_index.",
].join("\n");

/**
 * Genera el calendario de un mercado para un mes.
 *
 * Devuelve `warnings` en vez de fallar cuando la evidencia es floja: un
 * calendario armado sobre 4 posts es una opinión disfrazada de dato, y quien lo
 * lea tiene que saberlo.
 */
export async function generateCalendar(
  synthesis: RegionSynthesis,
  monthStart: Date,
  postsPerWeek = 3,
): Promise<ContentCalendar> {
  const warnings: string[] = [];
  if (synthesis.insufficient_sample) warnings.push(synthesis.insufficient_sample);
  if (!synthesis.winning_hooks?.length) {
    warnings.push(
      "Sin patrones de hook medidos: el reparto cae a un default y el calendario " +
        "no está respaldado por evidencia de este mercado.",
    );
  }

  const slots = planSlots(synthesis, monthStart, postsPerWeek);
  const month = monthStart.toISOString().slice(0, 7);
  const model = calendarModel();

  const evidence = {
    posts_considered: synthesis.posts_considered,
    top_posts_count: synthesis.top_posts_count,
    winning_hooks: (synthesis.winning_hooks ?? []).map((h) => ({ key: h.key, lift: h.lift })),
    winning_themes: (synthesis.winning_themes ?? []).map((t) => ({ key: t.key, lift: t.lift })),
  };

  if (!slots.length) {
    return {
      region: synthesis.region,
      month,
      generated_at: new Date().toISOString(),
      model,
      evidence,
      entries: [],
      warnings: [...warnings, "No se pudieron planificar fechas para el mes."],
    };
  }

  const { object } = await generateObject({
    model: openai(model),
    schema: CalendarSchema,
    system: SYSTEM,
    prompt: buildBrief(synthesis, slots),
  });

  const entries: CalendarEntry[] = [];
  for (const entry of object.entries) {
    const slot = slots[entry.slot_index - 1];
    if (!slot) continue;
    // La fecha, el patrón y el tema los pone el código, no el modelo.
    entries.push({ ...entry, date: slot.date, hook_pattern: slot.hook_pattern, theme: slot.theme });
  }
  entries.sort((a, b) => a.date.localeCompare(b.date));

  if (entries.length < slots.length) {
    warnings.push(`Se planificaron ${slots.length} piezas y el modelo devolvió ${entries.length}.`);
  }
  if (synthesis.insufficient_sample) {
    warnings.push(
      `Calendario acotado a ${slots.length} piezas por falta de evidencia: con más ` +
        "se repetiría la misma idea.",
    );
  }

  return {
    region: synthesis.region,
    month,
    generated_at: new Date().toISOString(),
    model,
    evidence,
    entries,
    warnings,
  };
}
