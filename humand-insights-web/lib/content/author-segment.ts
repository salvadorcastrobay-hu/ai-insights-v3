/**
 * Quién es el autor: segmentación, no ranking.
 *
 * Un post de un CEO y uno de una analista de RRHH con el mismo hook no rinden
 * por las mismas razones: el primero trae autoridad prestada del cargo. Sin
 * esto la síntesis mezcla los dos y recomienda "escribí en primera persona"
 * cuando lo que funcionaba era quién lo firmaba.
 *
 * Regex sobre la bio / headline, a propósito sin modelo: el headline de
 * LinkedIn es un texto corto y codificado ("CHRO | Speaker | Top Voice") y un
 * diccionario lo resuelve igual de bien, gratis y de forma reproducible.
 */

export const AUTHOR_ROLES = [
  "ceo_fundador",
  "lider_rrhh",
  "rrhh_operativo",
  "consultor_coach",
  "creador_contenido",
  "empresa",
  "otro",
] as const;
export type AuthorRole = (typeof AUTHOR_ROLES)[number];

export const AUTHOR_KINDS = ["own_brand", "competitor", "referente", "descubierto"] as const;
export type AuthorKind = (typeof AUTHOR_KINDS)[number];

/**
 * En orden: gana el primer rol que matchea. El cargo ejecutivo va antes que el
 * de RRHH porque "CEO | People & Culture" firma como CEO, y el de consultor va
 * después de los cargos porque casi todos se describen además como "mentor".
 */
const ROLE_PATTERNS: Array<[AuthorRole, RegExp]> = [
  ["ceo_fundador", /\b(ceo|co-?founder|founder|fundador[a]?|cofundador[a]?|s[oó]ci[oa][ -]fundador[a]?|managing director|managing partner|(?<!vice[- ])(presidente|presidenta|president)|s[oó]ci[oa] director[a]?)\b/i],
  [
    "lider_rrhh",
    /\b(chro|cpo|head of (people|talent|hr)|vp (of )?(people|hr)|people director|director[a]? de (rrhh|recursos humanos|personas|talento|gente)|diretor[a]? de (rh|recursos humanos|pessoas|gente)|gerente de (rrhh|rh|recursos humanos|personas|pessoas|gente)|chief people)\b/i,
  ],
  // "People and Sustainability Vice-President", "VP Talento": el área y el
  // cargo pueden venir en cualquier orden y con texto en el medio.
  [
    "lider_rrhh",
    /\b(people|personas|pessoas|talent[oe]?|rrhh|hr)\b[^|]{0,30}\b(vice-?president[ea]?|vp|director[a]?|head)\b|\b(vice-?president[ea]?|vp|head)\b[^|]{0,15}\b(people|personas|pessoas|talent[oe]?|rrhh|hr)\b/i,
  ],
  [
    "rrhh_operativo",
    /\b(analista|especialista|business partner|hrbp|recruiter|recrutador[a]?|reclutador[a]?|talent acquisition|tech recruiter|generalista|coordinador[a]? de (rrhh|rh|personas)|coordenador[a]? de (rh|pessoas)|recursos humanos|gest[aã]o de pessoas|gesti[oó]n de talento|atracci[oó]n de talento|desarrollo organizacional|rrhh|\brh\b)/i,
  ],
  ["consultor_coach", /\b(consultor[a]?|consultant|consulting|coach|coaching|mentor[a]?|facilitador[a]?|speaker|palestrante|palestras|conferencista|training|treinamentos?|advisor)\b/i],
  ["creador_contenido", /\b(creador[a]? de contenido|criador[a]? de conte[uú]do|content creator|influencer|influenciador[a]?|youtuber|podcaster|podcast|host|autor[a]? de)\b/i],
];

/** Cuentas de empresa: Instagram no distingue, la bio sí suele delatarlas. */
const COMPANY_PATTERN = /\b(editorial|agencia|ag[eê]ncia|software|plataforma|platform|soluciones|solu[cç][oõ]es|somos|nuestra empresa|nossa empresa|ltda|s\.a\.|s\.l\.|inc\b|app\b)/i;

export function authorRole(bio: string | null | undefined, isCompanyPage = false): AuthorRole {
  if (isCompanyPage) return "empresa";
  const text = (bio ?? "").trim();
  if (!text) return "otro";
  for (const [role, re] of ROLE_PATTERNS) {
    if (re.test(text)) return role;
  }
  return COMPANY_PATTERN.test(text) ? "empresa" : "otro";
}

/** "LinkedIn Top Voice" lo escriben en el headline quienes lo tienen; no hay otro campo. */
export function isTopVoice(bio: string | null | undefined): boolean {
  return /top\s*voices?/i.test(bio ?? "");
}

/**
 * De qué tipo de fuente vino. Un autor puede venir de varias: gana la más
 * deliberada, porque "lo sembramos como competidor" dice más que "apareció en
 * una búsqueda".
 */
export function authorKind(sourceKinds: Array<string | null | undefined>): AuthorKind {
  const kinds = new Set(sourceKinds);
  if (kinds.has("own_brand")) return "own_brand";
  if (kinds.has("competitor_profile")) return "competitor";
  if (kinds.has("profile")) return "referente";
  return "descubierto";
}
