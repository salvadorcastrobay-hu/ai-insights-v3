/**
 * Agrupa las afirmaciones de los posts en posiciones y tensiones del mercado.
 *
 * POR QUÉ NO ALCANZA CON CONTAR CATEGORÍAS: "pov rinde 1,62×" es un hecho sobre
 * nuestras propias etiquetas. Dice un formato, no qué decir. Y la etiqueta borra
 * lo único replicable: dos posts marcados igual —contrarian + clima_cultura—
 * pueden sostener cosas opuestas.
 *
 * POR QUÉ NO SE AGRUPAN LAS AFIRMACIONES DIRECTAMENTE: "la encuesta de clima
 * sirve" y "la encuesta de clima no sirve" tienen una similitud coseno de ~0,95.
 * Agrupar por parecido semántico fusionaría los dos lados de cada debate en un
 * solo grupo, y el resultado sería incoherente de una forma que nadie nota hasta
 * que lo lee alguien de Content.
 *
 * Por eso se agrupa por OBJETO —un sustantivo corto sin postura adentro, donde
 * el parecido semántico sí funciona— y se separa por POSTURA, que viene como
 * campo categórico aparte. La polaridad nunca pasa por el embedding.
 */

/**
 * Dos objetos por encima de esto son el mismo tema.
 *
 * Calibrado sobre los objetos reales, no elegido a ojo: por encima de 0,78 casi
 * no agrupa (grupos de 3 como máximo) y por debajo de 0,70 empieza a juntar
 * cosas distintas. En 0,74 con enlace completo el grupo más grande queda en 6
 * variantes, y son variantes de verdad: "pesquisa de clima / investigación de
 * clima / encuestas de clima", incluso cruzando idiomas.
 */
const SIMILARITY_THRESHOLD = 0.74;

/** Una posición necesita varias voces. Dos posts del mismo autor no son dos. */
export const MIN_POSITION_AUTHORS = 3;

/** Para llamarlo tensión hacen falta ambos lados poblados. */
export const MIN_SIDE_AUTHORS = 2;

export type ClaimInput = {
  post_id: string;
  post_url: string | null;
  author_handle: string;
  claim: string;
  counterclaim: string | null;
  claim_object: string;
  claim_stance: string;
  outlier_factor: number | null;
  debate_factor: number | null;
};

export type Side = {
  stance: string;
  posts: number;
  authors: number;
  median_outlier: number | null;
  claims: Array<{
    claim: string;
    author_handle: string;
    post_url: string | null;
    outlier_factor: number | null;
  }>;
};

export type Position = {
  /** El nombre más frecuente del grupo, no uno inventado. */
  object_label: string;
  /** Todas las formas en que se escribió el mismo objeto. */
  variants: string[];
  posts: number;
  authors: number;
  sides: Side[];
  /**
   * Cuánto más rinde el lado que mejor rinde contra el otro. Es lo único de
   * todo el sistema que dice de qué lado conviene pararse.
   */
  asymmetry: number | null;
  is_tension: boolean;
};

/**
 * Normaliza el objeto para que dos formas del mismo tema colisionen sin gastar
 * un embedding: minúsculas, sin acentos, sin artículos, sin plural simple.
 */
export function normalizeObject(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/^(el|la|los|las|un|una|o|a|os|as)\s+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Agrupa etiquetas por similitud, con ENLACE COMPLETO.
 *
 * El enlace simple encadena: si A se parece a B y B se parece a C, los tres
 * caen en el mismo grupo aunque A y C no tengan nada que ver. Medido sobre los
 * objetos reales, eso producía un grupo de 28 variantes que metía "límites en
 * liderazgo" junto a "liderazgo efectivo" — o sea el mismo artefacto de
 * categoría amplia que el prompt acababa de eliminar, reintroducido por el
 * agrupamiento.
 *
 * Con enlace completo un objeto entra al grupo solo si se parece a TODOS los
 * que ya están. Es más caro —hay que comparar contra cada miembro— pero con
 * unos cientos de etiquetas cortas eso es irrelevante, y es lo que evita que un
 * término genérico actúe de imán.
 *
 * `embeddings` puede venir vacío: en ese caso agrupa solo por coincidencia
 * exacta del texto normalizado, que ya resuelve la mayoría y no cuesta nada.
 */
export function clusterObjects(
  labels: string[],
  embeddings: Map<string, number[]> = new Map(),
  threshold = SIMILARITY_THRESHOLD,
): Map<string, string[]> {
  const unique = [...new Set(labels.map(normalizeObject))].filter(Boolean);

  const similar = (a: string, b: string): boolean => {
    const ea = embeddings.get(a);
    const eb = embeddings.get(b);
    if (!ea || !eb) return false;
    return cosine(ea, eb) >= threshold;
  };

  const groups = new Map<string, string[]>();
  for (const label of unique) {
    // Entra al primer grupo con el que se parezca a TODOS sus miembros.
    let destino: string | null = null;
    for (const [root, members] of groups) {
      if (members.every((m) => similar(label, m))) {
        destino = root;
        break;
      }
    }
    if (destino) groups.set(destino, [...(groups.get(destino) ?? []), label]);
    else groups.set(label, [label]);
  }
  return groups;
}

/**
 * Arma las posiciones del mercado a partir de los claims.
 *
 * Los umbrales son la diferencia entre un hallazgo y un artefacto: sin ellos
 * esto reinventa "onboarding 4,95× sobre dos posts" en una altitud nueva y más
 * difícil de auditar.
 */
export function buildPositions(
  claims: ClaimInput[],
  embeddings: Map<string, number[]> = new Map(),
): Position[] {
  const groups = clusterObjects(
    claims.map((c) => c.claim_object),
    embeddings,
  );

  // De cada variante normalizada al representante de su grupo.
  const toRoot = new Map<string, string>();
  for (const [root, variants] of groups) {
    for (const v of variants) toRoot.set(v, root);
  }

  const byRoot = new Map<string, ClaimInput[]>();
  for (const claim of claims) {
    const root = toRoot.get(normalizeObject(claim.claim_object));
    if (!root) continue;
    byRoot.set(root, [...(byRoot.get(root) ?? []), claim]);
  }

  const positions: Position[] = [];
  for (const [root, items] of byRoot) {
    const authors = new Set(items.map((i) => i.author_handle));
    if (authors.size < MIN_POSITION_AUTHORS) continue;

    // El nombre que se muestra es el que más se usó, no el normalizado ni uno
    // inventado: es el término que el rubro efectivamente escribe.
    const labelCounts = new Map<string, number>();
    for (const i of items) {
      labelCounts.set(i.claim_object, (labelCounts.get(i.claim_object) ?? 0) + 1);
    }
    const object_label = [...labelCounts.entries()].sort((a, b) => b[1] - a[1])[0][0];

    const byStance = new Map<string, ClaimInput[]>();
    for (const i of items) {
      byStance.set(i.claim_stance, [...(byStance.get(i.claim_stance) ?? []), i]);
    }

    const sides: Side[] = [...byStance.entries()]
      .map(([stance, list]) => ({
        stance,
        posts: list.length,
        authors: new Set(list.map((l) => l.author_handle)).size,
        median_outlier: median(
          list.map((l) => l.outlier_factor).filter((v): v is number => v !== null),
        ),
        claims: list
          .sort((a, b) => (b.outlier_factor ?? 0) - (a.outlier_factor ?? 0))
          .slice(0, 4)
          .map((l) => ({
            claim: l.claim,
            author_handle: l.author_handle,
            post_url: l.post_url,
            outlier_factor: l.outlier_factor,
          })),
      }))
      .sort((a, b) => (b.median_outlier ?? 0) - (a.median_outlier ?? 0));

    // Tensión = las dos posturas opuestas, cada una con voces suficientes.
    const aFavor = sides.find((s) => s.stance === "a_favor");
    const enContra = sides.find((s) => s.stance === "en_contra");
    const is_tension =
      !!aFavor &&
      !!enContra &&
      aFavor.authors >= MIN_SIDE_AUTHORS &&
      enContra.authors >= MIN_SIDE_AUTHORS;

    /*
     * La asimetría compara SOLO a_favor contra en_contra, y solo cuando los dos
     * lados tienen voces suficientes.
     *
     * Calculada sobre todos los lados daba cosas como "cultura organizacional,
     * asimetría 187×", que salía de dividir la mediana de cinco posts por la de
     * UN post etiquetado 'condicional'. Ni era una comparación entre posturas
     * opuestas ni tenía muestra: era ruido con dos decimales.
     */
    const asymmetry =
      is_tension &&
      aFavor?.median_outlier &&
      enContra?.median_outlier &&
      aFavor.median_outlier > 0 &&
      enContra.median_outlier > 0
        ? Number(
            (
              Math.max(aFavor.median_outlier, enContra.median_outlier) /
              Math.min(aFavor.median_outlier, enContra.median_outlier)
            ).toFixed(2),
          )
        : null;

    positions.push({
      object_label,
      variants: groups.get(root) ?? [root],
      posts: items.length,
      authors: authors.size,
      sides,
      asymmetry,
      is_tension,
    });
  }

  // Primero las tensiones, y dentro de ellas las que más se discuten con la
  // diferencia de rendimiento más marcada: ahí es donde hay algo que decir.
  return positions.sort((a, b) => {
    if (a.is_tension !== b.is_tension) return a.is_tension ? -1 : 1;
    return b.authors * (b.asymmetry ?? 1) - a.authors * (a.asymmetry ?? 1);
  });
}
