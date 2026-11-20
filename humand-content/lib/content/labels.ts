/**
 * Etiquetas legibles para los enums del motor.
 *
 * En la llamada del 23/10 Sofía leía "afirmacion_tajante" y "clima_cultura"
 * tal cual salen de la base. Cada pantalla tenía su propio mapa a medias; este
 * es el único, y lo que no está acá se muestra con espacios en vez de guiones.
 */

const LABELS: Record<string, string> = {
  // Temas
  comunicacion_interna: "Comunicación interna",
  clima_cultura: "Clima y cultura",
  desempeno: "Desempeño",
  onboarding: "Onboarding",
  reconocimiento: "Reconocimiento",
  rotacion_retencion: "Rotación y retención",
  liderazgo: "Liderazgo",
  dei: "Diversidad e inclusión",
  futuro_del_trabajo: "Futuro del trabajo",
  reclutamiento: "Reclutamiento",
  compensacion_beneficios: "Compensación y beneficios",
  nomina_administracion: "Nómina y administración",
  legal_laboral: "Legal laboral",
  bienestar_salud_mental: "Bienestar y salud mental",
  desarrollo_aprendizaje: "Desarrollo y aprendizaje",
  tecnologia_ia_rrhh: "Tecnología e IA en RRHH",
  employer_branding: "Employer branding",

  // Cómo arranca
  pregunta: "una pregunta",
  dato_numero: "un dato con número",
  afirmacion_tajante: "una afirmación tajante",
  confesion_personal: "una confesión personal",
  escena_narrativa: "una escena",
  promesa_lista: "la promesa de una lista",
  situacion_identificable: "una situación con la que te identificás",
  cita: "una cita",
  anuncio_novedad: "un anuncio",

  // Mecanismo
  tension_con_el_consenso: "contradice lo que todos repiten",
  admision_de_error: "admite un error propio",
  ritual_interno_concreto: "muestra un ritual interno concreto",
  desmontar_practica_comun: "desarma una práctica común",
  checklist_operable: "da una checklist aplicable",
  pregunta_diagnostica: "deja una pregunta para autodiagnosticarse",
  reencuadre_de_un_termino: "le da otro sentido a un término conocido",

  // Respaldo
  experiencia_personal: "una experiencia propia",
  dato_propio: "un dato propio",
  dato_externo_citado: "un dato de otra fuente",
  caso_empresa_cliente: "el caso de una empresa",
  cita_autoridad: "lo que dijo alguien reconocido",

  // Emoción
  orgullo: "orgullo",
  indignacion_frustracion: "indignación",
  identificacion_humor: "identificación o humor",
  inspiracion: "inspiración",
  inquietud_miedo: "inquietud",
  curiosidad: "curiosidad",
  ternura: "ternura",

  // Formato
  texto: "Solo texto",
  imagen: "Imagen",
  multi_imagen: "Varias imágenes",
  carrusel: "Carrusel",
  video: "Video",
  reel: "Reel",
  articulo_link: "Link a artículo",
  newsletter: "Newsletter",
  encuesta: "Encuesta",
};

export function label(key: string | null | undefined): string {
  if (!key) return "";
  return LABELS[key] ?? key.replace(/_/g, " ");
}

/** Formatos agrupados como los piensa Content: cada uno responde a otro objetivo. */
export const FORMAT_GROUPS: Array<{ key: string; label: string; formats: string[] }> = [
  { key: "reels", label: "Reels y video", formats: ["reel", "video"] },
  { key: "carruseles", label: "Carruseles", formats: ["carrusel", "multi_imagen"] },
  { key: "estaticos", label: "Estáticos", formats: ["imagen"] },
  { key: "texto", label: "Solo texto", formats: ["texto", "articulo_link", "newsletter", "encuesta"] },
];

export function formatGroup(formatDetail: string | null | undefined): string | null {
  if (!formatDetail) return null;
  return FORMAT_GROUPS.find((g) => g.formats.includes(formatDetail))?.key ?? null;
}
