/**
 * Chat de Content: responde con los datos de la herramienta y nada más.
 *
 * Cómo se evita que invente (lo pidió el equipo: "conciso, que no invente"):
 *   1. El modelo no tiene datos propios: todo número, post o patrón sale de
 *      una herramienta que lee la base. El prompt le prohíbe afirmar sin
 *      haberla llamado y le pide decir "no tengo datos" cuando no alcanza.
 *   2. Cada post que devuelve una herramienta lleva una referencia corta
 *      ([p1], [p2]…). La respuesta los cita y la pantalla muestra esos posts
 *      debajo, así se puede chequear. Una referencia que no salió de una
 *      herramienta se borra antes de mostrarla.
 *   3. Las herramientas devuelven lo mismo que muestran las pantallas
 *      (marketPatterns, ownContrast, themeTrends): el chat no tiene una
 *      lectura distinta de los datos que Inspiración o Insights claves.
 *
 * Modelo: gpt-5.5 por defecto (CONTENT_CHAT_MODEL); con gpt-4o el copy salía genérico. El mini sigue peor las
 * reglas de no afirmar sin dato.
 */
import { openai } from "@ai-sdk/openai";
import { generateText, stepCountIs, tool, type ModelMessage } from "ai";
import { z } from "zod";

import { APP_NAME } from "./brand";
import { FORMAT_GROUPS, label } from "./labels";
import { cluesFor, ownContrast } from "./own";
import {
  loadOwnAds,
  loadOwnHandles,
  loadOwnPosts,
  loadRankedPosts,
  loadSyntheses,
  loadTrendRows,
} from "./queries";
import { themeTrends } from "./trends";
import { regionLabel, type ContentPost, type OwnAd } from "./types";
import { marketPatterns } from "./why";

const MODEL = () => process.env.CONTENT_CHAT_MODEL ?? "gpt-5.5";
const MAX_HISTORY = 10;
/** Un post cuenta como ejemplo si rindió al menos esto contra su propia cuenta. */
const MIN_EXAMPLE_OUTLIER = 1.3;

export const THEMES = [
  "comunicacion_interna",
  "clima_cultura",
  "desempeno",
  "onboarding",
  "reconocimiento",
  "rotacion_retencion",
  "liderazgo",
  "dei",
  "futuro_del_trabajo",
  "reclutamiento",
  "compensacion_beneficios",
  "nomina_administracion",
  "legal_laboral",
  "bienestar_salud_mental",
  "desarrollo_aprendizaje",
  "tecnologia_ia_rrhh",
  "employer_branding",
] as const;

export function systemPrompt(today: string): string {
  return `Sos el asistente de ${APP_NAME}, la herramienta del equipo de Content de Humand (software de RRHH). Ayudás a decidir qué publicar en redes, con los datos de la herramienta: posts de referentes y competidores de RRHH medidos contra su propia cuenta, patrones por mercado, nuestras cuentas y nuestros anuncios de Meta. Hoy es ${today}.

Quién publica: los posts que se piden son para las cuentas de Humand (@humand.es en HISPAM y España, @humand.br en Brasil, Humand en LinkedIn). Humand es una plataforma para empleados: comunicación interna, RRHH y gestión de personas en una app. Le habla a líderes de RRHH y de empresas. El copy habla como Humand, la marca: nunca dejes "[nombre de la empresa]" ni hables como si Humand fuera la empresa del lector. Humand no se cuenta a sí misma como caso ("en Humand centralizamos…") salvo que sea un anuncio propio; lo normal es aportar al lector y nombrar a Humand en el cierre o el llamado a la acción.

Reglas, en este orden:
1. No inventes. Todo número, post, cuenta, patrón o tendencia tiene que salir de una herramienta que llamaste en esta conversación. Si no llamaste una, llamala antes de afirmar. Si las herramientas no traen lo que hace falta, decilo en una línea ("No tengo datos de X") y ofrecé lo más cercano que sí hay. Nunca completes con conocimiento general presentado como dato ni des motivos que no vengan de una herramienta ("suele atraer", "genera urgencia").
2. Largo según lo que piden. Análisis o preguntas: hasta 120 palabras. Una pieza (post, carrusel, reel): hasta 350. Sin introducción, sin repetir la pregunta, sin cierre de cortesía ni frase final que resuma o generalice ("este enfoque combina…", "esto puede captar…"): terminá con el último dato o con la pieza. Bullets cortos; sublistas con dos espacios.
3. Citá los posts en los que te basás con su referencia entre corchetes, tal cual la dio la herramienta: [p1], [p4]. Solo referencias que devolvió una herramienta, y como ejemplo a imitar solo posts que rindieron más que su habitual. Un post respalda una decisión solo si coincide de verdad en tema o en formato con lo pedido; si no hay ninguno así, escribí "sin ejemplo de X" y apoyate en el patrón. Nunca estires un post para que parezca respaldo (un post de prensa no respalda un formato, una foto de equipo no respalda una apertura). Si citás un post para comparar, fijate que sea comparable (un post para partners le habla a otra audiencia). No uses corchetes para ninguna otra cosa.
4. Leé bien los números:
   - "3× su engagement habitual" es contra el promedio de la cuenta que lo publicó, no contra el mercado. Al citar un post, poné su número: "[p2], 20,9× su habitual".
   - Los patrones de mercado son correlaciones: "aparece 2,1× más entre lo que rinde", nunca "rinde 2,1× más".
   - Para explicar por qué rindió un post, usá solo las pistas o patrones que devolvió la herramienta. Si varias pistas dicen lo mismo (caso, cliente, empresa), juntalas en una. Si hay peores posts, contá en qué se diferencian.
   - Las pistas de nuestras cuentas comparan nuestros posts entre sí; no son patrones del mercado. Los patrones de mercado no se separan por red ni por audiencia.
   - Si una herramienta trae un "aviso", decilo.
   - En preguntas de estrategia o de comparación, cruzá orgánico con ads (nuestros_ads) cuando el tema coincide: que un tema nos rinda poco en el feed y traiga leads baratos en pauta, o al revés, es justo lo que sirve saber.
   - Números con separador de miles y decimales con coma: 1.463; 2,1×. Con pocos posts o pocas cuentas, decilo.
   - Ads: compará el costo por lead de una pieza contra el de las campañas de leads de esa cuenta (costo_por_lead_campañas_de_leads), no contra toda la cuenta. Una pieza con muestra_chica (menos de 30 leads) se reporta sin sacar aprendizaje; una lección necesita al menos 30 leads o repetirse en dos piezas. Empezá por la pieza barata con más leads. Lo que dice la pieza (título, texto) podés describirlo; por qué funcionó, no lo sabés. No sumes monedas distintas.
5. Argentina y México se filtran por el país de la cuenta, pero sus patrones son los de HISPAM.
6. Si te piden una pieza (post, carrusel, reel, copy) o qué publicar — y solo entonces; a una pregunta de análisis ("¿qué rindió mejor?", "¿cómo lo repetimos?") respondé con el análisis y, si piden cómo repetirlo, con la receta en 2 o 3 bullets usando el post real como molde (sin X ni Y), sin escribir la pieza:
   - Consultá ejemplos del mercado (buscar_posts con la red, el formato y el tema pedidos), patrones (patrones_mercado) y qué nos rinde a nosotros (nuestras_cuentas, cuenta del mercado). Si nuestros datos dicen algo distinto que el mercado (por ejemplo, a nosotros nos rinden los casos de clientes), priorizá lo nuestro y decilo.
   - Arrancá con la decisión, tres líneas: **Formato**, **Ángulo**, **Apertura**, cada una con el post o patrón que la respalda.
   - Después la pieza completa, lista para producir, según el formato:
     · Reel: 5 escenas numeradas, 15 a 20 segundos en total, cada una con lo que se ve, el texto en pantalla y, si hay, la voz. Que cuenten una historia (situación, tensión, giro, salida), no una lista de tips. Después el caption, corto.
     · Carrusel: 6 slides, cada una con un titular de hasta 8 palabras y una bajada corta. Después el caption, corto.
     · Post: el caption entero.
   - La pieza ejecuta el ángulo que decidiste. Si el ángulo necesitaría un cliente o un dato que no tenés, elegí otro ángulo. Humand y el producto aparecen en una sola escena o slide, la última.
   - El copy tiene que poder publicarse tal cual: nada de corchetes, marcadores, "[link]", ni huecos para completar. Si una idea necesitaría una cifra, un cliente o un resultado que no te dio una herramienta, escribila de otra forma que no lo necesite. Las cifras y clientes nuestros que devolvió una herramienta sí se pueden usar.
   - Ganchos concretos sin inventar, escritos para este tema: una escena puntual, un error con nombre propio, un contraste entre lo esperado y lo que pasa, o una pregunta que filtra a la audiencia. Nada de frases hechas ("es clave", "no es un lujo, es una necesidad", "¿sabías que…?") ni variables sueltas (X, Y, "N colaboradores"). Tampoco cantidades puntuales en escenas dramatizadas ("14 links, 6 grupos"): suenan a dato y no lo son.
   - Tomá de los referentes la estructura, nunca su texto. Humand habla en el cierre o el llamado a la acción, no se pone de ejemplo. Hashtags: como mucho tres, específicos.
   - Al final, solo si aporta algo específico de esta pieza, una línea **Para adaptar:** con lo que Content podría sumar y dónde, escrito como instrucción. Si sería genérica ("sumar un caso de cliente"), no la pongas.
   - Idioma del mercado: portugués para Brasil, español para HISPAM y España.
7. Solo temas de contenido y redes de Humand. Si preguntan otra cosa, decí que no es para esta herramienta.
Respondé en español rioplatense (vos).`;
}

// ─── Registro de referencias ─────────────────────────────────────────────────

/** Los posts que las herramientas devolvieron en esta respuesta, por referencia. */
export class PostRegistry {
  private byRef = new Map<string, ContentPost>();
  private refById = new Map<string, string>();

  ref(post: ContentPost): string {
    const existing = this.refById.get(post.id);
    if (existing) return existing;
    const ref = `p${this.byRef.size + 1}`;
    this.byRef.set(ref, post);
    this.refById.set(post.id, ref);
    return ref;
  }

  get(ref: string): ContentPost | undefined {
    return this.byRef.get(ref);
  }
}

/**
 * Deja solo las citas que existen y devuelve los posts citados, en orden de
 * aparición. Una cita inventada se borra del texto en vez de mostrarse rota.
 */
export function resolveCitations(text: string, registry: PostRegistry): { text: string; cited: Array<{ ref: string; post: ContentPost }> } {
  const cited: Array<{ ref: string; post: ContentPost }> = [];
  const clean = text
    .replace(/\[(p\d+)\]/g, (match, ref: string) => {
      const post = registry.get(ref);
      if (!post) return "";
      if (!cited.some((c) => c.ref === ref)) cited.push({ ref, post });
      return match;
    })
    // Corchetes con ids que no son posts (ej. [CA_HUMAND_LATAM], [patrones_mercado])
    // y marcadores para completar ([Enlace], [link a…]) se borran.
    .replace(/\[[A-Z0-9_]{4,}\]/g, "")
    .replace(/\[[a-z_]{4,}\]/g, "")
    .replace(/\[(?:enlace|link|url)[^\]]*\]/gi, "")
    .replace(/[ \t]+([.,;:])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
  return { text: clean.trim(), cited };
}

// ─── Lo que ve el modelo de cada cosa ───────────────────────────────────────

function round(n: number | null | undefined, digits = 1): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function postForModel(post: ContentPost, registry: PostRegistry) {
  const a = post.analysis;
  return {
    ref: registry.ref(post),
    cuenta: `@${post.author_handle}`,
    red: post.platform,
    mercados: (post.regions ?? []).map(regionLabel),
    fecha: post.posted_at?.slice(0, 10) ?? null,
    formato: post.features?.format_detail ? label(post.features.format_detail) : post.format,
    tema: a?.theme && a.theme !== "otro" ? label(a.theme) : null,
    apertura: a?.hook ?? null,
    // El copy entero (recortado) para que el modelo vea la estructura, no solo la primera línea.
    copy: post.caption?.replace(/\s+/g, " ").slice(0, 400) ?? null,
    como_arranca: a?.hook_pattern && a.hook_pattern !== "otro" ? label(a.hook_pattern) : null,
    idea: a?.claim ?? null,
    respaldo: a?.evidence_type && a.evidence_type !== "ninguna" ? label(a.evidence_type) : null,
    veces_su_engagement_habitual: round(post.outlier_factor),
    likes: post.likes_count,
    comentarios: post.comments_count,
    ...(post.native_insights
      ? {
          alcance: post.native_insights.reach,
          guardados: post.native_insights.saved,
          compartidos: post.native_insights.shares,
        }
      : {}),
    ...(post.promoted ? { pautado: true } : {}),
  };
}

const MARKETS = ["hispam", "ar", "mx", "br", "es"] as const;
const AUDIENCE_KEYS = ["rrhh", "empleados", "management_ceo", "pymes", "candidatos"] as const;

function matchesText(post: ContentPost, text: string): boolean {
  const words = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (!words.length) return true;
  const hay = [post.caption, post.analysis?.hook, post.analysis?.claim, post.analysis?.claim_object]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
  return words.some((w) => hay.includes(w));
}

function summarizeAds(ads: OwnAd[]) {
  const sum = (rows: OwnAd[]) =>
    rows.reduce(
      (t, a) => ({ spend: t.spend + a.spend, impressions: t.impressions + a.impressions, clicks: t.clicks + a.clicks, leads: t.leads + a.leads }),
      { spend: 0, impressions: 0, clicks: 0, leads: 0 },
    );
  const byAccount = new Map<string, OwnAd[]>();
  for (const a of ads) byAccount.set(a.ad_account_id, [...(byAccount.get(a.ad_account_id) ?? []), a]);

  return [...byAccount.values()].map((rows) => {
    const t = sum(rows);
    const pieces = new Map<string, OwnAd[]>();
    for (const r of rows) pieces.set(r.ig_shortcode ?? r.ad_id, [...(pieces.get(r.ig_shortcode ?? r.ad_id) ?? []), r]);
    const pieceRows = [...pieces.values()]
      .map((group) => {
        const pt = sum(group);
        const lead = group.sort((x, y) => y.spend - x.spend)[0];
        return {
          titulo: lead.creative_title,
          texto: lead.creative_body?.slice(0, 120) ?? null,
          campaña: lead.campaign_name,
          invertido: Math.round(pt.spend),
          leads: pt.leads,
          costo_por_lead: pt.leads ? Math.round(pt.spend / pt.leads) : null,
          ctr_pct: pt.impressions ? round((pt.clicks / pt.impressions) * 100, 2) : null,
          ...(pt.leads < 30 ? { muestra_chica: true } : {}),
        };
      })
      .filter((p) => p.leads >= 5);
    const campaigns = new Map<string, OwnAd[]>();
    for (const r of rows) campaigns.set(r.campaign_name ?? "—", [...(campaigns.get(r.campaign_name ?? "—") ?? []), r]);
    // El promedio de toda la cuenta mezcla campañas de alcance (sin leads):
    // contra eso cualquier pieza de leads parece barata.
    const leadRows = [...campaigns.values()].filter((g) => g.some((r) => r.leads > 0)).flat();
    const lt = sum(leadRows);
    return {
      cuenta: rows[0].ad_account_name,
      moneda: rows[0].currency,
      periodo: `${rows[0].period_start} a ${rows[0].period_end}`,
      anuncios: rows.length,
      invertido: Math.round(t.spend),
      impresiones: t.impressions,
      clics: t.clicks,
      ctr_pct: t.impressions ? round((t.clicks / t.impressions) * 100, 2) : null,
      leads: t.leads,
      costo_por_lead: t.leads ? Math.round(t.spend / t.leads) : null,
      costo_por_lead_campañas_de_leads: lt.leads ? Math.round(lt.spend / lt.leads) : null,
      piezas_mas_baratas_por_lead: [...pieceRows].sort((a, b) => (a.costo_por_lead ?? 1e18) - (b.costo_por_lead ?? 1e18)).slice(0, 5),
      campañas_con_mas_inversion: [...campaigns.entries()]
        .map(([name, group]) => {
          const ct = sum(group);
          return { campaña: name, invertido: Math.round(ct.spend), leads: ct.leads, costo_por_lead: ct.leads ? Math.round(ct.spend / ct.leads) : null };
        })
        .sort((a, b) => b.invertido - a.invertido)
        .slice(0, 6),
      nota: "Leads según la atribución de Meta. Los anuncios usan piezas hechas para pauta, no posts del feed.",
    };
  });
}

// ─── Herramientas ────────────────────────────────────────────────────────────

export function chatTools(registry: PostRegistry) {
  return {
    buscar_posts: tool({
      description:
        "Posts de referentes y competidores (no los nuestros) que más superaron el engagement habitual de su propia cuenta. Solo posts relevantes para RRHH y de cuentas con línea base. Usala para ejemplos e inspiración.",
      inputSchema: z.object({
        mercado: z.enum([...MARKETS, "todos"]).default("todos").describe("hispam = Hispanoamérica; ar y mx = solo cuentas de ese país; br = Brasil; es = España"),
        audiencia: z.enum([...AUDIENCE_KEYS, "todas"]).default("rrhh").describe("A quién le habla el post. Por defecto rrhh."),
        red: z.enum(["instagram", "linkedin", "todas"]).default("todas"),
        formato: z.enum([...FORMAT_GROUPS.map((g) => g.key) as [string, ...string[]], "todos"]).default("todos"),
        tema: z.enum([...THEMES, "todos"]).default("todos"),
        texto: z.string().optional().describe("Palabras a buscar en el copy, opcional"),
        orden: z.enum(["rendimiento", "debate"]).default("rendimiento").describe("debate = posts que se comentaron mucho más de lo habitual"),
      }),
      execute: async ({ mercado, audiencia, red, formato, tema, texto, orden }) => {
        const own = await loadOwnHandles();
        const posts = await loadRankedPosts({
          region: mercado === "todos" ? undefined : mercado,
          audience: audiencia === "todas" ? undefined : audiencia,
          platform: red === "todas" ? undefined : red,
          formats: FORMAT_GROUPS.find((g) => g.key === formato)?.formats,
          sortBy: orden === "debate" ? "debate" : "outlier",
          onlyRelevant: true,
          onlyMeasured: true,
          excludeHandles: own,
          limit: 200,
        });
        const pick = (list: ContentPost[], useText: boolean) =>
          list
            .filter((p) => tema === "todos" || p.analysis?.theme === tema)
            .filter((p) => !useText || !texto || matchesText(p, texto))
            // Un ejemplo que rindió por debajo de su habitual no es inspiración.
            .filter((p) => orden === "debate" || (p.outlier_factor ?? 0) >= MIN_EXAMPLE_OUTLIER)
            .slice(0, 6);
        let hits = pick(posts, true);
        const loosened: string[] = [];
        // Sin resultados se suelta de a un filtro, del menos al más importante,
        // y se dice cuál: mejor un ejemplo cercano avisado que ninguno.
        if (!hits.length && texto) {
          hits = pick(posts, false);
          loosened.push("texto");
        }
        if (!hits.length && (formato !== "todos" || red !== "todas" || audiencia !== "todas")) {
          const wider = await loadRankedPosts({
            region: mercado === "todos" ? undefined : mercado,
            sortBy: orden === "debate" ? "debate" : "outlier",
            onlyRelevant: true,
            onlyMeasured: true,
            excludeHandles: own,
            limit: 300,
          });
          hits = pick(wider, false);
          loosened.push(...[formato !== "todos" && "formato", red !== "todas" && "red", audiencia !== "todas" && "audiencia"].filter((x): x is string => Boolean(x)));
        }
        if (!hits.length && mercado !== "todos") {
          const anywhere = await loadRankedPosts({ sortBy: "outlier", onlyRelevant: true, onlyMeasured: true, excludeHandles: own, limit: 300 });
          hits = pick(anywhere, false);
          loosened.push("mercado");
        }
        return {
          encontrados: hits.length,
          ...(loosened.length
            ? {
                filtros_sueltos: loosened,
                aviso: `No hubo posts con todos los filtros. Estos ejemplos ya no cumplen: ${loosened
                  .map((f) => (f === "mercado" ? `mercado (no son de ${regionLabel(mercado)})` : f))
                  .join(", ")}. Decíselo a quien pregunta.`,
              }
            : {}),
          posts: hits.map((p) => postForModel(p, registry)),
          ...(hits.length ? {} : { nota: "Sin posts con esos filtros, ni soltándolos." }),
        };
      },
    }),

    patrones_mercado: tool({
      description:
        "Qué se repite entre los posts que más rinden en un mercado (formatos, aperturas, temas, respaldo) y qué temas vienen creciendo. Son correlaciones, no causas.",
      inputSchema: z.object({ mercado: z.enum(["hispam", "br", "es"]).describe("Para Argentina o México usá hispam") }),
      execute: async ({ mercado }) => {
        const [syntheses, own] = await Promise.all([loadSyntheses(), loadOwnHandles()]);
        const s = syntheses.find((x) => x.region === mercado);
        if (!s) return { nota: `No hay síntesis para ${regionLabel(mercado)}.` };
        if (s.insufficient_sample) return { nota: `La muestra de ${regionLabel(mercado)} es chica: no hay patrones confiables.` };
        const rows = await loadTrendRows(own).catch(() => []);
        const { trends, windowEnd } = themeTrends(rows, mercado);
        return {
          mercado: regionLabel(mercado),
          alcance_de_los_datos: "Patrones del mercado entero: Instagram y LinkedIn juntos, todas las audiencias de RRHH.",
          posts_considerados: s.posts_considered,
          posts_que_mas_rinden: s.top_posts_count,
          patrones: marketPatterns(s, 8).map((p) => ({
            rasgo: p.text,
            veces_mas_frecuente_entre_lo_que_rinde: round(p.lift),
            cuentas_distintas: p.authors,
          })),
          temas_en_alza: trends.slice(0, 3).map((t) => ({
            tema: label(t.theme),
            posts_ultimo_mes: t.recent,
            cuentas: t.authors,
            veces_su_peso_anterior: round(t.ratio),
          })),
          datos_hasta: windowEnd?.slice(0, 10) ?? null,
        };
      },
    }),

    nuestras_cuentas: tool({
      description:
        "Nuestras cuentas (@humand.es, @humand.br, LinkedIn de Humand): engagement, alcance si lo hay, nuestros mejores y peores posts contra el promedio de cada cuenta, y pistas de qué se repite en lo que más y menos rinde.",
      inputSchema: z.object({
        cuenta: z.string().optional().describe("Handle sin @, ej. humand.es o humand.br. Vacío = todas"),
      }),
      execute: async ({ cuenta }) => {
        const { posts, accounts } = await loadOwnPosts();
        const wanted = cuenta?.replace(/^@/, "").toLowerCase();
        const chosen = accounts.filter((a) => !wanted || a.handle.toLowerCase() === wanted);
        if (!chosen.length) return { nota: `No tenemos la cuenta ${cuenta}. Cuentas: ${accounts.map((a) => "@" + a.handle).join(", ")}` };
        return chosen.map((acc) => {
          const mine = posts.filter((p) => p.platform === acc.platform && p.author_handle === acc.handle && !p.promoted);
          const ranked = mine.filter((p) => p.outlier_factor != null).sort((a, b) => (b.outlier_factor ?? 0) - (a.outlier_factor ?? 0));
          const contrast = acc.platform === "instagram" ? ownContrast(mine) : { tercile: 0, works: [], fails: [] };
          const native = mine.map((p) => p.native_insights).filter((n): n is NonNullable<typeof n> => Boolean(n));
          const med = (vals: Array<number | null>) => {
            const v = vals.filter((x): x is number => x != null).sort((a, b) => a - b);
            return v.length ? v[Math.floor(v.length / 2)] : null;
          };
          return {
            cuenta: `@${acc.handle}`,
            red: acc.platform,
            seguidores: acc.followers,
            posts: acc.posts,
            posts_medidos: acc.measured,
            interacciones_por_post_mediana: round(acc.medianEngagement, 0),
            ...(native.length
              ? {
                  alcance_mediano: med(native.map((n) => n.reach)),
                  guardados_medianos: med(native.map((n) => n.saved)),
                  compartidos_medianos: med(native.map((n) => n.shares)),
                }
              : { nota_alcance: "Sin alcance: la cuenta no está conectada a Meta." }),
            desde: acc.firstPost?.slice(0, 10),
            hasta: acc.lastPost?.slice(0, 10),
            mejores: ranked.slice(0, 3).map((p) => ({ ...postForModel(p, registry), pistas: cluesFor(p, contrast.works).map((c) => c.text) })),
            peores: ranked.length >= 6 ? ranked.slice(-3).reverse().map((p) => postForModel(p, registry)) : [],
            pistas: contrast.tercile
              ? {
                  nota: `Comparan el tercio de mejores (${contrast.tercile} posts) con el de peores de esta misma cuenta. Son pistas, no conclusiones, y no dicen nada del mercado.`,
                  se_repite_en_lo_que_rinde: contrast.works.map((c) => `${c.text} (${c.inTop} vs ${c.inBottom})`),
                  se_repite_en_lo_que_no_rinde: contrast.fails.map((c) => `${c.text} (${c.inBottom} vs ${c.inTop})`),
                }
              : null,
          };
        });
      },
    }),

    nuestros_ads: tool({
      description:
        "Nuestros anuncios de Meta de los últimos 90 días, por cuenta publicitaria: inversión, leads, costo por lead, piezas con leads más baratos y campañas con más inversión.",
      inputSchema: z.object({}),
      execute: async () => {
        const ads = await loadOwnAds().catch(() => []);
        if (!ads.length) return { nota: "No hay anuncios cargados." };
        return summarizeAds(ads);
      },
    }),
  };
}

// ─── La respuesta ────────────────────────────────────────────────────────────

export type ChatTurn = { role: "user" | "assistant"; content: string };

export type ChatAnswer = {
  text: string;
  cited: Array<{ ref: string; post: ContentPost }>;
  tools: string[];
};

/** Todos los números que aparecen en lo que devolvieron las herramientas. */
export function numbersIn(value: unknown, out: number[] = []): number[] {
  if (typeof value === "number" && Number.isFinite(value)) out.push(value);
  else if (typeof value === "string") {
    for (const m of value.matchAll(/\d+(?:[.,]\d+)?/g)) out.push(Number(m[0].replace(",", ".")));
  } else if (Array.isArray(value)) value.forEach((v) => numbersIn(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => numbersIn(v, out));
  return out;
}

/**
 * Los números de la respuesta que no salen de ninguna herramienta.
 *
 * Es el control que el prompt solo no garantiza: en las pruebas, un borrador
 * de post traía "un 30% más de participación" que no existía en ningún lado.
 * Se aceptan redondeos y porcentajes de tasas (0,0261 → 2,61%). Los números
 * chicos (≤ 10) y los años no se miran: son conteos de la propia respuesta
 * ("tres ejemplos") o fechas.
 */
export function ungroundedNumbers(text: string, known: number[]): string[] {
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(0.051, Math.abs(b) * 0.006);
  const candidates = (token: string): number[] => {
    const bare = token.replace("%", "");
    const out = new Set<number>();
    // "14.627" o "1,463" como miles; "2,61" o "2.7" como decimales.
    out.add(Number(bare.replace(/[.,]/g, "")));
    if (/^\d+[.,]\d+$/.test(bare)) out.add(Number(bare.replace(",", ".")));
    if (/^\d{1,3}([.,]\d{3})+([.,]\d+)?$/.test(bare)) {
      const lastSep = Math.max(bare.lastIndexOf("."), bare.lastIndexOf(","));
      out.add(Number(bare.slice(0, lastSep).replace(/[.,]/g, "") + "." + bare.slice(lastSep + 1)));
    }
    return [...out].filter(Number.isFinite);
  };
  const scaled = known.flatMap((k) => [k, k * 100]);
  const bad: string[] = [];
  // Fuera de la revisión: referencias, tiempos de escena ("0-3s", "12s") y
  // números de slide o escena, que son estructura de la pieza y no cifras.
  const clean = text
    .replace(/\[p\d+\]/g, "")
    .replace(/\d+\s*[-–]\s*\d+\s*(?:s|seg)\b/gi, "")
    .replace(/\b\d+\s*(?:s|seg)\b/gi, "")
    .replace(/\b(?:slide|escena|cena|lámina)\s+\d+/gi, "");
  for (const m of clean.matchAll(/\d+(?:[.,]\d+)*%?/g)) {
    const token = m[0];
    const values = candidates(token);
    // Un número chico seguido de una unidad ("3 meses", "5%", "2×") es una
    // afirmación, no un conteo de la respuesta: ese sí se verifica.
    const after = clean.slice((m.index ?? 0) + token.length, (m.index ?? 0) + token.length + 14).toLowerCase();
    const isClaim = token.endsWith("%") || /^\s*(×|x\b|veces|vezes|d[ií]as|semanas|meses|horas|años|anos|minutos|segundos|por ?ciento|mil|millones)/.test(after);
    if (!isClaim && values.every((v) => v <= 10 || (v >= 2000 && v <= 2100 && !token.includes(".") && !token.includes(",")))) continue;
    if (!values.some((v) => scaled.some((k) => close(v, k)))) bad.push(token);
  }
  return [...new Set(bad)];
}

/** Reemplaza cada número exacto por [dato], sin tocar números que lo contengan ("3" no pisa "338"). */
export function replaceNumbers(text: string, tokens: string[]): string {
  let out = text;
  for (const token of tokens) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<![\\d.,])${escaped}(?![.,]?\\d)`, "g"), "[dato]");
  }
  return out;
}

/**
 * Saca las oraciones que tienen un número sin respaldo. Antes se reemplazaba
 * el número por [dato], pero un borrador con huecos no se puede publicar: es
 * mejor perder la oración que mostrar un marcador.
 */
export function dropSentencesWith(text: string, tokens: string[]): string {
  if (!tokens.length) return text;
  const hits = (sentence: string) =>
    tokens.some((token) => {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?<![\\d.,])${escaped}(?![.,]?\\d)`).test(sentence);
    });
  return text
    .split("\n")
    .flatMap((line) => {
      if (!hits(line)) return [line];
      const prefix = line.match(/^\s*(?:[-*>]|\d+[.)])?\s*/)?.[0] ?? "";
      const kept = line
        .slice(prefix.length)
        .split(/(?<=[.!?…])\s+/)
        .filter((sentence) => !hits(sentence))
        .join(" ");
      return kept.trim() ? [prefix + kept] : [];
    })
    .join("\n");
}

export async function answer(history: ChatTurn[]): Promise<ChatAnswer> {
  const registry = new PostRegistry();
  const messages: ModelMessage[] = history.slice(-MAX_HISTORY).map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  const today = new Date().toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  const tools = chatTools(registry);
  const run = (msgs: ModelMessage[]) =>
    generateText({
      model: openai(MODEL()),
      system: systemPrompt(today),
      messages: msgs,
      tools,
      stopWhen: stepCountIs(6),
      // Los modelos de razonamiento no aceptan temperature.
      ...(MODEL().startsWith("gpt-4") ? { temperature: 0.2 } : { providerOptions: { openai: { reasoningEffort: "low" } } }),
    });

  let result = await run(messages);
  const toolOutputs = () => result.steps.flatMap((s) => s.toolResults.map((r) => r.output));
  const known: unknown[] = [...toolOutputs(), history.map((h) => h.content)];
  const used = result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName));

  // Una sola corrección: si después sigue habiendo números sin respaldo, se
  // borran del texto antes de mostrarlo.
  let finalText = result.text;
  let bad = ungroundedNumbers(finalText, numbersIn(known));
  if (bad.length) {
    result = await run([
      ...messages,
      ...result.response.messages,
      {
        role: "user",
        content: `Revisión automática: estos números de tu respuesta no salen de ninguna herramienta: ${bad.join(", ")}. Reescribí la respuesta completa sin ellos: reformulá esas frases para que no necesiten la cifra (nada de marcadores tipo [dato]). No menciones esta revisión.`,
      },
    ]);
    known.push(...toolOutputs());
    used.push(...result.steps.flatMap((s) => s.toolCalls.map((c) => c.toolName)));
    if (result.text.trim()) finalText = result.text;
    bad = ungroundedNumbers(finalText, numbersIn(known));
  }
  finalText = dropSentencesWith(finalText, bad);

  const { text, cited } = resolveCitations(finalText, registry);
  return { text: text || "No pude armar una respuesta con los datos. Probá reformular la pregunta.", cited, tools: used };
}
