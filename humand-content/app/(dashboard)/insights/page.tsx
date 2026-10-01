import { Badge, Bar, Callout, Card, EmptyState, PageHeader, SectionLabel } from "@/components/ui";
import {
  loadMarketPositions,
  loadOwnBrandComparisons,
  loadSyntheses,
} from "@/lib/content/queries";
import {
  regionLabel,
  type CopyShapeRow,
  type MarketPosition,
  type OwnBrandComparison,
  type PatternContrast,
  type PatternLift,
  type RegionSynthesis,
  type SynthesisAxis,
} from "@/lib/content/types";

export const dynamic = "force-dynamic";

/**
 * El lift es un dato intrínsecamente comparativo, así que se muestra con una
 * barra y no solo con el número: escrito como texto, un 3,2× y un 1,1× ocupan
 * el mismo espacio y se ven igual.
 */

const STANCE_LABELS: Record<string, string> = {
  a_favor: "A favor",
  en_contra: "En contra",
  condicional: "Con condiciones",
  descriptivo: "Sin tomar partido",
};

/**
 * Una tensión del mercado: sobre qué se discute, quién sostiene cada lado, y
 * cuál de los dos rinde.
 *
 * Es lo único de toda la app que dice QUÉ decir. El lift de hooks dice un
 * formato —"empezá en primera persona"— y las piezas que salen de ahí pueden
 * decir cualquier cosa. Esto dice de qué lado pararse, con la evidencia al
 * lado para poder discutirlo.
 */
function Tension({ position }: { position: MarketPosition }) {
  const [mejor, ...resto] = position.sides;
  return (
    <div className="rounded-[var(--r-m)] border border-[var(--border)] p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-[14px] font-semibold leading-[1.4]">{position.object_label}</h3>
        <span className="text-[12px] text-[var(--faint)]">
          {position.posts} posts · {position.authors} autores
        </span>
        {position.is_tension ? (
          <Badge tone="brand">está en disputa</Badge>
        ) : (
          <Badge tone="muted">hay consenso</Badge>
        )}
        {position.is_tension && position.asymmetry && position.asymmetry >= 1.5 ? (
          <span className="ml-auto text-[12px] font-semibold text-[var(--brand-ink)]">
            un lado rinde {position.asymmetry}×
          </span>
        ) : null}
      </div>

      <div className="space-y-2">
        {[mejor, ...resto].filter(Boolean).map((side, index) => (
          <div
            key={side.stance}
            className={index === 0 && position.is_tension ? "rounded-[var(--r-s)] bg-[var(--brand-soft)] p-2" : "p-2"}
          >
            <p className="mb-1 text-[12px] leading-[1.4]">
              <span className="font-semibold">{STANCE_LABELS[side.stance] ?? side.stance}</span>
              <span className="text-[var(--faint)]">
                {" "}
                · {side.posts} posts, {side.authors} autores
                {side.median_outlier ? ` · mediana ${side.median_outlier.toFixed(1)}×` : ""}
              </span>
              {index === 0 && position.is_tension ? (
                <span className="ml-2 font-semibold text-[var(--brand-ink)]">← este lado rinde</span>
              ) : null}
            </p>
            <ul className="space-y-0.5">
              {side.claims.slice(0, 3).map((c) => (
                <li key={c.post_url ?? c.claim} className="text-[14px] leading-[1.4]">
                  <span className="text-[var(--muted)]">“{c.claim}”</span>{" "}
                  {c.post_url ? (
                    <a
                      href={c.post_url}
                      target="_blank"
                      rel="noreferrer"
                      className="whitespace-nowrap text-[12px] text-[var(--brand-ink)] hover:underline"
                    >
                      @{c.author_handle}
                      {c.outlier_factor ? ` ${c.outlier_factor.toFixed(1)}×` : ""} ↗
                    </a>
                  ) : (
                    <span className="text-[12px] text-[var(--faint)]">@{c.author_handle}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Etiquetas legibles para los enums nuevos. Lo que no está acá se muestra con espacios. */
const KEY_LABELS: Record<string, string> = {
  texto: "solo texto",
  multi_imagen: "varias imágenes",
  articulo_link: "link a artículo",
  pregunta_abierta: "pregunta al lector",
  // Rinde porque pide comentarios, y los comentarios pesan más en el ranking.
  comentar_palabra_clave: "comentá palabra (lead magnet, infla comentarios)",
  guardar_o_compartir: "guardá / compartí",
  ir_a_link: "ir a un link",
  inscribirse_evento: "inscribite a un evento",
  contacto_comercial: "contacto comercial",
  ninguno: "no pide nada",
  efemeride: "efeméride",
  casero: "casero (celular, sin diseño)",
  plantilla: "plantilla (tipo Canva)",
  producido: "producido",
  sin_persona: "sin persona",
  primer_plano: "primer plano",
  plano_medio: "plano medio",
  cuerpo_entero: "cuerpo entero",
  // Tipo de pieza
  foto_real: "foto real",
  foto_stock: "foto de stock",
  placa_texto: "placa de texto",
  infografia_dato: "infografía o dato",
  // Persona y lugar
  persona_real: "persona real",
  modelo_stock: "modelo de stock",
  persona_ilustrada: "persona ilustrada",
  fondo_diseno: "fondo de diseño, sin lugar",
  casa_remoto: "en casa / remoto",
  evento_escenario: "evento o escenario",
  estudio_fondo_liso: "estudio, fondo liso",
  logo_discreto: "logo discreto",
  marca_dominante: "la marca es protagonista",
  // Video, juzgado por la portada
  cabeza_parlante: "alguien hablando a cámara",
  pov_situacion: "POV / situación actuada",
  animacion_motion: "animación",
  entrevista_dialogo: "entrevista o diálogo",
  tutorial_pantalla: "tutorial grabando pantalla",
  registro_evento: "registro de un evento",
  montaje_broll: "montaje de tomas",
  // Palabras sobre la portada, por tramo
  "0": "sin texto",
  "1-8": "1 a 8 palabras",
  "9-25": "9 a 25 palabras",
  ">25": "más de 25 palabras",
  // Intención y evidencia
  opinion_liderazgo: "opinión / liderazgo de ideas",
  educativo_practico: "educativo, práctico",
  promocion_producto: "promoción de producto",
  evento_webinar: "evento o webinar",
  cultura_propia_employer_brand: "cultura propia (employer brand)",
  dato_o_noticia: "dato o noticia",
  celebracion_logro: "celebración de un logro",
  ninguna: "sin respaldo",
  experiencia_personal: "experiencia personal",
  dato_propio: "dato propio",
  dato_externo_citado: "dato externo citado",
  caso_empresa_cliente: "caso de una empresa",
  cita_autoridad: "cita de autoridad",
  equipo_empleados: "el equipo / empleados",
  autor: "el propio autor",
  experto_externo: "un experto externo",
  el_lector: "el lector",
  nadie: "nadie en particular",
  inquietud_miedo: "inquietud o miedo",
  neutra: "neutra",
  indignacion_frustracion: "indignación o frustración",
  identificacion_humor: "identificación o humor",
  generico: "genérico",
  algo_concreto: "algo concreto",
  muy_concreto: "muy concreto (nombres, cifras, casos)",
  // Escritura
  yo: "primera persona (yo)",
  nosotros: "nosotros",
  vos_usted: "le habla al lector",
  impersonal: "impersonal",
  con_numero: "abre con un número",
  pregunta: "pregunta",
  ni_numero_ni_pregunta: "ni número ni pregunta",
  con_lista: "con lista",
  sin_lista: "sin lista",
  sin_link: "sin link",
  en_comentario: "link en el comentario",
  // Quién firma
  ceo_fundador: "CEO o fundador",
  lider_rrhh: "líder de RRHH (CHRO, Head of People)",
  rrhh_operativo: "RRHH operativo (analista, recruiter)",
  consultor_coach: "consultor o coach",
  creador_contenido: "creador de contenido",
  empresa: "cuenta de empresa",
  menos_de_1_por_semana: "menos de 1 post por semana",
  "1_a_3_por_semana": "1 a 3 por semana",
  mas_de_3_por_semana: "más de 3 por semana",
  titular_corto: "titular corto",
  manana: "mañana",
  lun: "lunes",
  mar: "martes",
  mie: "miércoles",
  jue: "jueves",
  vie: "viernes",
  sab: "sábado",
  dom: "domingo",
};

function label(key: string): string {
  return KEY_LABELS[key] ?? key.replace(/_/g, " ");
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Lift contra una muestra de control. Se muestran las dos proporciones y no
 * solo el múltiplo: "2×" sobre 4% contra 2% y sobre 60% contra 30% no son la
 * misma noticia.
 */
function ContrastList({ title, rows }: { title: string; rows: PatternContrast[] }) {
  const winners = rows.filter((r) => r.lift > 1).slice(0, 4);
  if (!winners.length) return null;
  const max = Math.max(...winners.map((r) => r.lift));
  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="space-y-2.5">
        {winners.map((row) => (
          <li key={row.key}>
            <div className="mb-1 flex items-baseline gap-2 text-[14px] leading-[1.4]">
              <span className="min-w-0 flex-1 truncate" title={row.key}>
                {label(row.key)}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{row.lift}×</span>
              <span className="shrink-0 text-[12px] text-[var(--faint)] tabular-nums">
                {pct(row.top_share)} arriba · {pct(row.rest_share)} resto
              </span>
            </div>
            <Bar value={row.lift} max={max} />
          </li>
        ))}
      </ul>
    </div>
  );
}

const COPY_METRICS: Record<CopyShapeRow["metric"], string> = {
  first_line_chars: "Largo de la primera línea (caracteres)",
  paragraphs: "Párrafos",
  emoji_count: "Emojis",
  copy_length: "Largo total (caracteres)",
  slide_count: "Placas por carrusel",
  has_external_link: "Lleva link externo",
  ends_with_question: "Cierra con pregunta",
};

/**
 * Cómo está escrito lo que funciona. Es lo que se copia de un post sin copiar
 * su tema, y todo sale contado, no inferido.
 */
function CopyShape({ rows }: { rows: CopyShapeRow[] }) {
  // Solo las filas donde arriba y resto difieren de verdad: una tabla donde
  // todo es igual no le dice nada a quien escribe.
  const notable = rows.filter((r) => {
    if (r.kind === "share") return Math.abs(r.top - r.rest) >= 0.08;
    const base = Math.max(1, r.rest);
    return Math.abs(r.top - r.rest) / base >= 0.2;
  });
  if (!notable.length) return null;
  const fmt = (r: CopyShapeRow, v: number) =>
    r.kind === "share" ? pct(v) : Math.round(v).toLocaleString("es");

  return (
    <div className="mb-5">
      <SectionLabel>Cómo está escrito lo que funciona</SectionLabel>
      <table className="w-full text-[14px] leading-[1.4]">
        <thead>
          <tr className="text-left text-[12px] text-[var(--faint)]">
            <th className="pb-1 font-normal">Mediana o proporción</th>
            <th className="pb-1 text-right font-semibold text-[var(--text)]">Arriba</th>
            <th className="pb-1 text-right font-normal">Resto</th>
          </tr>
        </thead>
        <tbody>
          {notable.map((r) => (
            <tr key={r.metric} className="border-t border-[var(--border)]">
              <td className="py-1.5">{COPY_METRICS[r.metric]}</td>
              <td className="py-1.5 text-right font-semibold tabular-nums">{fmt(r, r.top)}</td>
              <td className="py-1.5 text-right tabular-nums text-[var(--muted)]">{fmt(r, r.rest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Timing({ timing }: { timing: NonNullable<RegionSynthesis["timing"]> }) {
  const days = timing.weekday.filter((r) => r.lift > 1).slice(0, 3);
  const parts = timing.daypart.filter((r) => r.lift > 1).slice(0, 2);
  if (!days.length && !parts.length) return null;
  return (
    <div className="mb-5">
      <SectionLabel>Cuándo publican los que funcionan</SectionLabel>
      <p className="mb-2 text-[12px] leading-[1.4] text-[var(--faint)]">
        Descriptivo, no una receta: sobre {timing.sample} posts de perfiles seguidos en orden
        cronológico, en hora del mercado (Hispam con ±2h de error). Dice cuándo publica quien
        rinde, no que publicar ese día haga rendir.
      </p>
      <div className="flex flex-wrap gap-1">
        {[...days, ...parts].map((r) => (
          <Badge key={r.key} tone="brand">
            {label(r.key)} · {r.lift}×
          </Badge>
        ))}
      </div>
    </div>
  );
}

/**
 * Humand publica como empresa, y casi todo el corpus son personas. Con tan
 * pocas páginas no hay lift posible: se muestran los casos.
 */
function CompanyPages({ data }: { data: NonNullable<RegionSynthesis["company_pages"]> }) {
  return (
    <div className="mb-5 rounded-[var(--r-m)] border border-[var(--border)] p-3">
      <SectionLabel>Páginas de empresa</SectionLabel>
      <p className="mb-2 text-[14px] leading-[1.4]">
        {data.posts} posts de {data.authors} {data.authors === 1 ? "página" : "páginas"}
        {data.median_outlier !== null && data.person_median_outlier !== null
          ? ` · rinden ${data.median_outlier}× su promedio, contra ${data.person_median_outlier}× de las personas`
          : ""}
        .
      </p>
      <p className="mb-2 text-[12px] leading-[1.4] text-[var(--faint)]">
        Son pocos para sacar un patrón: son casos para mirar, no una tendencia. Lo que rinde a una
        persona —su historia, su cara— no se traslada solo a una marca.
      </p>
      <ul className="space-y-1">
        {data.examples.map((e) => (
          <li key={e.post_url ?? e.hook ?? e.author_handle} className="text-[14px] leading-[1.4]">
            <span className="text-[var(--muted)]">“{e.hook ?? "(sin texto)"}”</span>{" "}
            {e.post_url ? (
              <a
                href={e.post_url}
                target="_blank"
                rel="noreferrer"
                className="whitespace-nowrap text-[12px] text-[var(--brand-ink)] hover:underline"
              >
                @{e.author_handle}
                {e.format ? ` · ${label(e.format)}` : ""}
                {e.outlier_factor ? ` · ${e.outlier_factor.toFixed(1)}×` : ""} ↗
              </a>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Los ejes que sumó la auditoría, agrupados por la decisión que informan.
 * Agrupados y no en una grilla única: doce listas sueltas se leen como un
 * volcado, y lo que Content decide es qué decir, cómo escribirlo y —en el
 * caso del rol— si el resultado es trasladable a una cuenta de empresa.
 */
const AXIS_GROUPS: Array<{
  title: string;
  hint?: string;
  axes: Array<[SynthesisAxis, string]>;
}> = [
  {
    title: "Qué dice lo que funciona",
    axes: [
      ["content_intent", "Para qué está hecho"],
      ["evidence_type", "Con qué respalda lo que dice"],
      ["protagonist", "De quién habla"],
      ["emotional_trigger", "Qué emoción busca"],
      ["specificity", "Qué tan concreto es"],
    ],
  },
  {
    title: "Cómo está escrito",
    axes: [
      ["narrative_voice", "Desde qué voz"],
      ["first_line", "Cómo abre"],
      ["has_list", "Listas"],
      ["link_placement", "Dónde va el link"],
      ["aspect_ratio", "Formato de pantalla"],
    ],
  },
  {
    title: "Quién lo firma",
    hint:
      "Si lo que rinde lo firman CEOs, parte del resultado es la autoridad del cargo y no el copy: " +
      "ojo antes de trasladarlo tal cual a la cuenta de Humand.",
    axes: [
      ["author_role", "Rol de quien firma"],
      ["author_cadence", "Cuánto publica"],
    ],
  },
];

/**
 * Por debajo de esto el "ganador" es ruido: con un corte de veinte posts, 1,03×
 * es un post de diferencia. Los ejes nuevos tienen muchos valores casi
 * parejos y sin este piso la sección se llenaba de empates.
 */
const MIN_AXIS_LIFT = 1.15;

function Axes({ axes }: { axes: Partial<Record<SynthesisAxis, PatternLift[]>> }) {
  const strong = (key: SynthesisAxis) => (axes[key] ?? []).filter((r) => r.lift >= MIN_AXIS_LIFT);
  const groups = AXIS_GROUPS.map((g) => ({
    ...g,
    axes: g.axes.filter(([key]) => strong(key).length),
  })).filter((g) => g.axes.length);
  if (!groups.length) return null;
  return (
    <div className="mt-5 space-y-5">
      {groups.map((g) => (
        <div key={g.title}>
          <h3 className="mb-1 text-[14px] font-semibold leading-[1.4]">{g.title}</h3>
          {g.hint ? (
            <p className="mb-2 text-[12px] leading-[1.4] text-[var(--faint)]">{g.hint}</p>
          ) : null}
          <div className="grid gap-6 sm:grid-cols-2">
            {g.axes.map(([key, title]) => (
              <LiftList key={key} title={title} rows={strong(key)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LiftList({ title, rows }: { title: string; rows: PatternLift[] }) {
  const winners = rows.filter((r) => r.lift > 1).slice(0, 6);
  if (!winners.length) return null;
  const max = Math.max(...winners.map((r) => r.lift));

  return (
    <div>
      <SectionLabel>{title}</SectionLabel>
      <ul className="space-y-2.5">
        {winners.map((row) => (
          <li key={row.key}>
            <div className="mb-1 flex items-baseline gap-2 text-[14px] leading-[1.4]">
              <span className="min-w-0 flex-1 truncate" title={row.key}>
                {label(row.key)}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">{row.lift}×</span>
              <span className="shrink-0 text-[12px] text-[var(--faint)]">
                {row.top_count} arriba
              </span>
            </div>
            <Bar value={row.lift} max={max} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Lo que pide el prompt maestro del brief: comparar el desempeño propio contra
 * los patrones detectados. Sin esto sabemos qué funciona pero no si lo estamos
 * aplicando.
 *
 * Los tres hallazgos van separados y con su propio encabezado. Antes se
 * emitían como tres párrafos unidos con " · ", o sea la parte más accionable de
 * la app formateada como un CSV.
 */
function OwnBrand({ cmp }: { cmp: OwnBrandComparison }) {
  if (!cmp.own_posts) return null;
  const own = cmp.own_median_engagement;
  const ref = cmp.reference_median_engagement;

  const blocks = [
    {
      title: "Funcionan y casi no usamos",
      items: cmp.missing_patterns.map((p) => `${p.key.replace(/_/g, " ")} · ${p.lift}×`),
      tone: "brand" as const,
    },
    {
      title: "Formatos que funcionan y casi no publicamos",
      items: (cmp.missing_formats ?? []).map((f) => `${label(f.key)} · ${f.lift}×`),
      tone: "brand" as const,
    },
    {
      title: "Temas que funcionan y no tocamos",
      items: cmp.missing_themes.map((t) => `${t.key.replace(/_/g, " ")} · ${t.lift}×`),
      tone: "brand" as const,
    },
    {
      title: "Usamos mucho, sin evidencia de que rinda",
      items: cmp.overused_patterns.map(
        (p) => `${p.key.replace(/_/g, " ")} · ${Math.round(p.own_share * 100)}% de lo nuestro`,
      ),
      tone: "muted" as const,
    },
  ].filter((b) => b.items.length);

  return (
    <div className="mt-5 rounded-[var(--r-m)] border border-[var(--border)] bg-[var(--surface-sunk)] p-4">
      <SectionLabel>Humand contra estos patrones</SectionLabel>

      {own !== null && ref !== null ? (
        <p className="mb-1 text-[14px] leading-[1.4]">
          Engagement mediano propio{" "}
          <span className="font-semibold tabular-nums">{own.toLocaleString("es")}</span> contra{" "}
          <span className="font-semibold tabular-nums">{ref.toLocaleString("es")}</span> de los
          referentes
        </p>
      ) : null}

      <p className="mb-3 text-[12px] leading-[1.4] text-[var(--faint)]">
        Se comparan nuestros {cmp.own_posts} posts contra los patrones de este mercado. Son los
        mismos posts en los tres: publicamos global, los patrones son locales.
      </p>

      {blocks.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {blocks.map((block) => (
            <div key={block.title}>
              <p className="mb-1.5 text-[12px] font-semibold leading-[1.4]">{block.title}</p>
              <div className="flex flex-wrap gap-1">
                {block.items.map((item) => (
                  <Badge key={item} tone={block.tone}>
                    {item}
                  </Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[14px] leading-[1.4] text-[var(--muted)]">
          Sin diferencias claras contra los patrones de este mercado.
        </p>
      )}
    </div>
  );
}

export default async function InsightsPage() {
  const [syntheses, ownComparisons, marketPositions] = await Promise.all([
    loadSyntheses(),
    loadOwnBrandComparisons().catch(() => []),
    loadMarketPositions().catch(() => []),
  ]);
  const tensiones = marketPositions.filter((p) => p.is_tension);
  const ownByRegion = new Map(ownComparisons.map((c) => [c.region, c.comparison]));

  if (!syntheses.length) {
    return (
      <>
        <PageHeader title="Patrones" />
        <EmptyState title="Todavía no hay síntesis generada" />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Patrones"
        subtitle="El lift compara cuánto aparece un patrón arriba contra cuánto aparece en el total. Mayor a 1 significa que funciona mejor de lo que su frecuencia explicaría."
      />

      {/*
        Las tensiones van arriba y son del RUBRO, no de un mercado.
        Por mercado hay ~100 claims relevantes y ninguna práctica junta los
        autores que hacen falta; agrupando los tres, sí. Y tiene sentido de
        fondo: que se discuta si la encuesta de clima sirve no es un debate
        brasileño ni español. Lo que sí es por mercado es qué formato y qué
        hook rinden, y eso está más abajo.
      */}
      {tensiones.length ? (
        <Card className="mb-6">
          <div className="mb-3">
            <h2 className="text-[18px] font-semibold leading-[1.4]">
              Sobre qué está dividido el rubro
            </h2>
            <p className="mt-1 text-[14px] leading-[1.4] text-[var(--muted)]">
              Temas donde los referentes sostienen posiciones opuestas, con cuánto rinde
              cada lado. Se calcula sobre los tres mercados juntos: el debate es del
              rubro, no de un país.
            </p>
          </div>
          <div className="space-y-2">
            {tensiones.slice(0, 5).map((p) => (
              <Tension key={p.object_label} position={p} />
            ))}
          </div>
        </Card>
      ) : null}

      <div className="space-y-6">
        {syntheses.map((s) => (
          <Card key={s.region}>
            <div className="mb-4 flex flex-wrap items-baseline gap-3">
              <h2 className="text-[18px] font-semibold leading-[1.4]">{regionLabel(s.region)}</h2>
              <span className="text-[12px] text-[var(--faint)]">
                {s.posts_considered} posts relevantes · corte superior {s.top_posts_count}
                {s.excluded_collabs
                  ? ` · ${s.excluded_collabs} collabs fuera del cálculo (alcance compartido)`
                  : ""}
              </span>
            </div>

            {s.insufficient_sample ? (
              <div className="mb-4">
                <Callout>{s.insufficient_sample}</Callout>
              </div>
            ) : null}

            {/* Primero de qué se discute, después con qué formato: el formato
                sin el mensaje no le dice a nadie qué escribir. */}
            {s.positions?.length ? (
              <div className="mb-5">
                <SectionLabel>
                  {s.positions.some((p) => p.is_tension)
                    ? "Sobre qué discute el mercado"
                    : "De qué se habla, y desde qué postura"}
                </SectionLabel>
                {/*
                  Cuando no hay ninguna tensión hay que decirlo. Una lista de
                  consensos bajo el título "sobre qué se discute" haría pensar
                  que el mercado está dividido cuando no lo está — y lo
                  interesante para Content es justamente lo contrario: un tema
                  donde todos dicen lo mismo es un tema donde tomar la posición
                  contraria no tiene competencia.
                */}
                {!s.positions.some((p) => p.is_tension) ? (
                  <p className="mb-2 text-[12px] leading-[1.4] text-[var(--faint)]">
                    Ningún tema tiene los dos lados sostenidos por varias voces: en este
                    mercado hay consenso, no debate. Hace falta más volumen de posts para
                    detectar una tensión real.
                  </p>
                ) : null}
                <div className="space-y-2">
                  {s.positions.slice(0, 5).map((p) => (
                    <Tension key={p.object_label} position={p} />
                  ))}
                </div>
              </div>
            ) : null}

            {s.visual_lift ? (
              <div className="mb-5">
                <SectionLabel>Cómo se ve lo que funciona</SectionLabel>
                <p className="mb-3 text-[12px] leading-[1.4] text-[var(--faint)]">
                  {s.visual_lift.top_n} piezas del corte superior contra una muestra de{" "}
                  {s.visual_lift.rest_n} del resto del mercado. Es asociación, no causa: dice qué
                  aparece más en lo que rinde.
                </p>
                <div className="grid gap-6 sm:grid-cols-2">
                  <ContrastList title="Tipo de pieza" rows={s.visual_lift.creative_type} />
                  <ContrastList title="Nivel de producción" rows={s.visual_lift.production_level} />
                  <ContrastList title="Quién aparece" rows={s.visual_lift.person_identity ?? []} />
                  <ContrastList title="Cómo aparece la persona" rows={s.visual_lift.person_framing} />
                  <ContrastList title="Dónde transcurre" rows={s.visual_lift.setting ?? []} />
                  <ContrastList title="Cuánto se ve la marca" rows={s.visual_lift.brand_treatment ?? []} />
                  <ContrastList title="Texto sobre la imagen" rows={s.visual_lift.text_on_image} />
                  <ContrastList title="Palabras en la portada" rows={s.visual_lift.cover_text ?? []} />
                  {/* Leído de la portada, no del video entero: por eso solo entre videos. */}
                  <ContrastList title="Estilo de video (entre videos)" rows={s.visual_lift.video_style ?? []} />
                </div>
              </div>
            ) : s.visual_mix?.length ? (
              <div className="mb-5">
                <SectionLabel>Cómo se ve lo que funciona</SectionLabel>
                {/*
                  Sin muestra de control todavía: se compara DENTRO del corte,
                  no contra el resto, y llamarlo lift sería afirmar algo que el
                  dato no sostiene.
                */}
                <p className="mb-2 text-[12px] leading-[1.4] text-[var(--faint)]">
                  Sobre las piezas del corte superior que pudimos analizar visualmente. Es
                  una comparación entre las que funcionaron, no contra el resto del mercado.
                </p>
                <ul className="space-y-2">
                  {s.visual_mix.slice(0, 6).map((v) => (
                    <li
                      key={v.key}
                      className="flex items-baseline gap-2 text-[14px] leading-[1.4]"
                    >
                      <span className="min-w-0 flex-1 truncate">{label(v.key)}</span>
                      <span className="shrink-0 tabular-nums text-[var(--muted)]">
                        {v.posts} posts · {v.authors} autores
                      </span>
                      {v.median_outlier ? (
                        <span className="shrink-0 font-semibold tabular-nums">
                          {v.median_outlier.toFixed(1)}×
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {s.copy_shape?.length ? <CopyShape rows={s.copy_shape} /> : null}

            <div className="grid gap-6 sm:grid-cols-2">
              <LiftList title="Hooks que ganan" rows={s.winning_hooks ?? []} />
              <LiftList title="Temas que ganan" rows={s.winning_themes ?? []} />
              <LiftList title="Estructuras que ganan" rows={s.winning_structures ?? []} />
              <LiftList title="Formatos que ganan" rows={s.winning_formats ?? []} />
              <LiftList title="Qué le piden al lector" rows={s.winning_ctas ?? []} />
              <LiftList title="Vigencia" rows={s.winning_timeliness ?? []} />
            </div>

            {s.winning_axes ? <Axes axes={s.winning_axes} /> : null}

            <div className="mt-5">
              {s.timing ? <Timing timing={s.timing} /> : null}
              {s.company_pages ? <CompanyPages data={s.company_pages} /> : null}
            </div>

            {s.top_topics.length ? (
              <div className="mt-5">
                <SectionLabel>De qué hablan</SectionLabel>
                <div className="flex flex-wrap gap-1">
                  {s.top_topics.slice(0, 10).map((t) => (
                    <Badge key={t.key} tone="muted">
                      {t.key}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {ownByRegion.has(s.region) ? <OwnBrand cmp={ownByRegion.get(s.region)!} /> : null}
          </Card>
        ))}
      </div>

      <p className="mt-6 text-[12px] leading-[1.4] text-[var(--faint)]">
        Las ideas replicables que antes se listaban acá son el feed de{" "}
        <a href="/discovery" className="font-semibold text-[var(--brand-ink)] hover:underline">
          Qué funciona
        </a>{" "}
        — eran los mismos posts mostrados dos veces.
      </p>
    </>
  );
}
