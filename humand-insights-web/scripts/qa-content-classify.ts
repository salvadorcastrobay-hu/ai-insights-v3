/**
 * QA del clasificador de posts: un juez gpt-4o revisa campo por campo.
 *
 * Mismo criterio que `qa_evaluator.py` del pipeline de transcripts: el juez es
 * siempre gpt-4o, nunca el mini que clasifica — un modelo no se audita a sí
 * mismo. Revisa los campos donde el error cambia una decisión: el hook (que
 * es lo que se muestra), el CTA y su tipo, la vigencia, y si el lead magnet
 * detectado por regla es de verdad un lead magnet.
 *
 * Uso:
 *   npx tsx scripts/qa-content-classify.ts --sample 40
 *   npx tsx scripts/qa-content-classify.ts --sample 40 --out ../artifacts/content_qa.json
 *   npx tsx scripts/qa-content-classify.ts --sample 40 --version 2026-09-23e.cta-pass
 */
import { writeFileSync } from "fs";

import { openai } from "@ai-sdk/openai";
import { createClient } from "@supabase/supabase-js";
import { generateObject } from "ai";
import { z } from "zod";

import { ANALYSIS_VERSION, CTA_TYPES, TIMELINESS, clipCaption } from "../lib/content/classify";

const JUDGE_MODEL = "gpt-4o";

const Verdict = z.object({
  hook_ok: z.boolean().describe("¿`hook` es copia literal (o casi) de la apertura real del texto?"),
  cta_type_ok: z.boolean().describe("¿`cta_type` describe bien lo que el texto le pide al lector?"),
  cta_type_expected: z.enum(CTA_TYPES).describe("El cta_type que vos pondrías."),
  timeliness_ok: z.boolean(),
  timeliness_expected: z.enum(TIMELINESS),
  comment_bait_ok: z
    .boolean()
    .describe("¿`comment_bait` (pide comentar una palabra a cambio de algo) es correcto?"),
  notes: z.string().describe("Una línea: qué está mal, si algo está mal. Vacío si todo bien."),
});

const SYSTEM = [
  "Auditás la clasificación automática de posts de LinkedIn e Instagram del rubro RRHH.",
  "Te paso el texto del post y lo que extrajo el clasificador. Juzgá cada campo con",
  "rigor pero sin pedantería: un hook al que le falta un emoji sigue siendo literal;",
  "uno parafraseado no lo es.",
  "",
  "cta_type: ninguno, pregunta_abierta (pide opinión), comentar_palabra_clave",
  "('comentá X y te mando'), guardar_o_compartir, etiquetar, ir_a_link (leer/ver/",
  "descargar), seguir, inscribirse_evento (evento, webinar, curso, programa),",
  "contacto_comercial (demo, DM). Si pide varias cosas, cuenta la principal.",
  "",
  // Las MISMAS reglas que el clasificador. Con una definición más vaga, el juez
  // marcaba como error "coyuntura" en un webinar con fecha porque para él era
  // "efeméride": medía la diferencia entre dos definiciones, no errores.
  "timeliness, con estas reglas y no otras:",
  "- efemeride: nombra un día o campaña del calendario (Setembro Amarelo, Día de",
  "  la Mujer, Día del Reclutador, Pride, fin de año, vuelta de vacaciones).",
  "- coyuntura: invita a algo CON FECHA (webinar, evento, congreso, programa,",
  "  búsqueda laboral abierta), o depende de un hecho reciente que nombra (una",
  "  ley, una noticia, un estudio de este año, un lanzamiento). Un evento con",
  "  fecha es coyuntura, NO efeméride.",
  "- evergreen: todo lo demás. Un tema de moda sin hecho concreto es evergreen.",
  "",
  "Marcá `_ok: false` solo si tu valor esperado es DISTINTO del extraído.",
].join("\n");

async function main() {
  const args = process.argv.slice(2);
  const sampleArg = args.indexOf("--sample");
  const sample = sampleArg >= 0 ? Number(args[sampleArg + 1]) : 40;
  const outArg = args.indexOf("--out");
  const out = outArg >= 0 ? args[outArg + 1] : null;
  // Por defecto la versión actual; con --version se audita otra que siga viva
  // en la tabla (un backfill parcial deja filas de dos versiones).
  const versionArg = args.indexOf("--version");
  const version = versionArg >= 0 ? args[versionArg + 1] : ANALYSIS_VERSION;

  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data, error } = await sb
    .from("content_posts")
    .select("platform, post_id, caption, analysis, features")
    .eq("analysis_version", version)
    .not("caption", "is", null)
    .limit(1000);
  if (error) throw error;

  // Muestra estratificada a mano: los casos raros (lead magnet, evento,
  // efeméride) son pocos y un sorteo simple no los traería.
  const rows = (data ?? []) as Array<{
    platform: string;
    post_id: string;
    caption: string;
    analysis: Record<string, unknown>;
    features: Record<string, unknown> | null;
  }>;
  const rare = rows.filter(
    (r) =>
      r.features?.comment_bait ||
      (r.analysis.cta_type && r.analysis.cta_type !== "ninguno") ||
      r.analysis.timeliness !== "evergreen",
  );
  const common = rows.filter((r) => !rare.includes(r));
  const shuffle = <T>(list: T[]) =>
    list
      .map((v, i) => ({ v, k: Math.sin(i * 9301 + 49297) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.v);
  const picked = [
    ...shuffle(rare).slice(0, Math.ceil(sample / 2)),
    ...shuffle(common),
  ].slice(0, sample);

  console.log(`QA de ${picked.length} posts (${version}) con ${JUDGE_MODEL}…`);
  const results: Array<{ post_id: string; platform: string; extracted: unknown; verdict: z.infer<typeof Verdict> }> = [];
  for (const row of picked) {
    const extracted = {
      hook: row.analysis.hook,
      cta: row.analysis.cta,
      cta_type: row.analysis.cta_type,
      timeliness: row.analysis.timeliness,
      comment_bait: row.features?.comment_bait ?? null,
    };
    const { object } = await generateObject({
      model: openai(JUDGE_MODEL),
      schema: Verdict,
      system: SYSTEM,
      prompt: `TEXTO DEL POST:\n${clipCaption(row.caption)}\n\nEXTRAÍDO:\n${JSON.stringify(extracted, null, 2)}`,
    });
    results.push({ post_id: row.post_id, platform: row.platform, extracted, verdict: object });
  }

  const rate = (key: keyof z.infer<typeof Verdict>) =>
    `${Math.round((100 * results.filter((r) => r.verdict[key] === true).length) / results.length)}%`;
  const summary = {
    version,
    judge: JUDGE_MODEL,
    n: results.length,
    hook: rate("hook_ok"),
    cta_type: rate("cta_type_ok"),
    timeliness: rate("timeliness_ok"),
    comment_bait: rate("comment_bait_ok"),
    // Lo que decide el calendario es si la pieza vence o no; coyuntura contra
    // efeméride es un matiz. Se reporta aparte para no esconder ninguno.
    timeliness_vence_o_no: `${Math.round(
      (100 *
        results.filter(
          (r) =>
            (r.extracted as { timeliness?: string }).timeliness === "evergreen" ===
            (r.verdict.timeliness_expected === "evergreen"),
        ).length) /
        results.length,
    )}%`,
  };
  console.log(summary);
  for (const r of results.filter((x) => x.verdict.notes)) {
    console.log(`- ${r.platform}/${r.post_id}: ${r.verdict.notes}`);
  }
  if (out) writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
