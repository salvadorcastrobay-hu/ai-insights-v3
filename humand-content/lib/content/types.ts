/** Tipos compartidos por la app. Espejan las tablas content_* de Supabase. */

export type Platform = "instagram" | "linkedin";
export type Audience = "hr_leader" | "candidate" | "general";

export type SourceKind =
  | "hashtag"
  | "keyword"
  | "profile"
  | "competitor_profile"
  | "own_brand";

export type ApprovalState = "approved" | "suggested" | "rejected";

export type ContentSource = {
  id: string;
  platform: Platform;
  kind: SourceKind;
  value: string;
  label: string | null;
  region: string;
  language: string;
  audience: string | null;
  results_limit: number;
  is_active: boolean;
  approval_state: ApprovalState;
  notes: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
};

/** Los seis perfiles objetivo de la sección 7 del brief. */
export type TargetProfile =
  | "hr_manager"
  | "people"
  | "chro"
  | "ceo"
  | "dueno_pyme"
  | "operations";

export const TARGET_PROFILE_LABELS: Record<TargetProfile, string> = {
  hr_manager: "HR Manager",
  people: "People",
  chro: "CHRO",
  ceo: "CEO",
  dueno_pyme: "Dueño PyME",
  operations: "Operations",
};

/** Espeja el schema de classify.ts en el motor. */
export type PostAnalysis = {
  is_relevant_to_hr: boolean;
  theme: string;
  audience_signal: Audience;
  target_profiles: TargetProfile[];
  // Copy in: el texto dentro de la pieza.
  hook: string | null;
  hook_pattern: string;
  structure: string;
  cta: string | null;
  tone: string;
  // Copy out: el texto que la acompaña.
  hashtag_strategy: string;
  replicability: "alta" | "media" | "baja";
  /**
   * Lo que el post AFIRMA, como oración que se puede sostener o refutar.
   * Reemplaza a humand_angle y why_it_worked, que eran relleno: el 46% de los
   * ángulos empezaba con uno de cuatro verbos genéricos y 32 "por qué
   * funcionó" arrancaban con "el post generó engagement" — circular, porque el
   * engagement es el criterio con el que se los eligió.
   */
  claim: string | null;
  counterclaim: string | null;
  claim_object: string | null;
  claim_stance: "a_favor" | "en_contra" | "condicional" | "descriptivo" | null;
  /** Qué lo hace funcionar más allá del tema. Es lo único transferible. */
  transferable_mechanism: string | null;
  copy_length: number;
  hashtag_count: number;
};

/** Comparación de lo propio contra los patrones que funcionan. */
export type OwnBrandComparison = {
  own_posts: number;
  own_median_engagement: number | null;
  reference_median_engagement: number | null;
  missing_patterns: Array<{ key: string; lift: number; own_share: number }>;
  overused_patterns: Array<{ key: string; lift: number; own_share: number }>;
  missing_themes: Array<{ key: string; lift: number }>;
};

export type ContentPost = {
  id: string;
  platform: Platform;
  post_id: string;
  author_handle: string;
  post_url: string | null;
  format: string | null;
  caption: string | null;
  posted_at: string | null;
  likes_count: number | null;
  comments_count: number | null;
  shares_count: number | null;
  outlier_factor: number | null;
  /**
   * Cuánto más se discutió el post que lo normal de su autor. Mide fricción,
   * no alcance: un post con muchos likes y pocos comentarios es asentimiento;
   * uno con el ratio disparado tocó algo. Son ejes independientes —medido,
   * correlación -0,08— así que un post puede rendir poco y discutirse mucho.
   */
  debate_factor: number | null;
  viral_score: number | null;
  analysis: PostAnalysis | null;
  /**
   * Foto de portada. Ojo: las URLs de los CDN vienen firmadas y vencen —Instagram
   * en menos de una semana, LinkedIn con un `e=` explícito en la query—, así que
   * una URL guardada hace meses devuelve 403. La UI nunca puede asumir que carga.
   */
  display_url: string | null;
  media: { images: string[]; videos: string[] } | null;
  /** Paths en nuestro bucket privado. Esto es lo durable. */
  stored_media: { images: string[]; videos: string[] } | null;
  /**
   * URL firmada lista para el `src`, resuelta en la query. No está en la tabla:
   * se emite por request y vive una hora.
   */
  image_url?: string | null;
  author: PostAuthor | null;
};

/** Lo que se necesita del autor para pintar una tarjeta. */
export type PostAuthor = {
  avatar_url: string | null;
  full_name: string | null;
  followers_count: number | null;
  is_verified: boolean | null;
};

export type PatternLift = {
  key: string;
  top_count: number;
  /** Cuántos autores distintos lo sostienen. Es la señal, no el conteo. */
  top_authors?: number;
  lift: number;
};

/** Un lado de un debate del mercado. */
export type PositionSide = {
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

/**
 * Un tema sobre el que el mercado dice cosas, agrupado por objeto y partido
 * por postura. Cuando los dos lados están poblados es una tensión — y la
 * asimetría dice cuál de los dos rinde, que es lo único del sistema que indica
 * de qué lado conviene pararse.
 */
export type MarketPosition = {
  object_label: string;
  variants: string[];
  posts: number;
  authors: number;
  sides: PositionSide[];
  asymmetry: number | null;
  is_tension: boolean;
};

export type RegionSynthesis = {
  region: string;
  posts_considered: number;
  top_posts_count: number;
  winning_hooks: PatternLift[] | null;
  winning_themes: PatternLift[] | null;
  winning_structures?: PatternLift[] | null;
  /**
   * Cómo se ve el creativo del corte superior. NO es un lift: el análisis
   * visual corre solo sobre el corte, así que no hay denominador. Compara
   * dentro de los que funcionaron, no contra el resto.
   */
  visual_mix?: Array<{
    key: string;
    posts: number;
    authors: number;
    median_outlier: number | null;
  }> | null;
  top_topics: Array<{ key: string; count: number }>;
  tone_mix: Array<{ key: string; count: number }>;
  replicable_ideas: Array<{
    post_url: string | null;
    author_handle: string;
    hook: string | null;
    hook_pattern: string;
    theme: string;
    claim: string;
    counterclaim: string | null;
    claim_object: string | null;
    claim_stance: string | null;
    mechanism: string;
    debate_factor: number | null;
    outlier_factor: number | null;
  }>;
  positions?: MarketPosition[];
  insufficient_sample?: string;
};

/** Un post real que respalda una pieza del calendario. */
export type EvidenceLink = {
  author_handle: string;
  post_url: string;
  outlier_factor: number | null;
};

export type CalendarEntry = {
  date: string;
  hook_pattern: string;
  theme: string;
  title: string;
  hook: string;
  angle: string;
  format: string;
  cta: string | null;
  based_on: string;
  /**
   * Los posts concretos que respaldan la pieza, ya resueltos por el motor. Es
   * lo que hace auditable al calendario: `based_on` es una frase que el modelo
   * escribe, esto son links que existen.
   */
  evidence_links?: EvidenceLink[];
};

export type ContentCalendar = {
  region: string;
  month: string;
  generated_at: string;
  model: string;
  evidence: {
    posts_considered: number;
    top_posts_count: number;
    winning_hooks: Array<{ key: string; lift: number }>;
    winning_themes: Array<{ key: string; lift: number }>;
  };
  entries: CalendarEntry[];
  warnings: string[];
};

export type RefreshJob = {
  id: string;
  state: "queued" | "running" | "completed" | "failed" | "cancelled";
  kind: string;
  current_label: string | null;
  progress: Record<string, number>;
  error: string | null;
  started_at: string;
  finished_at: string | null;
};

export const REGION_LABELS: Record<string, string> = {
  br: "Brasil",
  es: "España",
  hispam: "HISPAM",
  global: "Global",
};

export function regionLabel(region: string | null | undefined): string {
  if (!region) return "Sin región";
  return REGION_LABELS[region] ?? region;
}

/** Destino de una pieza sugerida — sección 10 del brief. */
export type FeedbackState =
  | "pending"
  | "approved_as_is"
  | "approved_edited"
  | "rejected"
  | "published";

export type SuggestionFeedback = {
  entry_key: string;
  region: string;
  month: string;
  publish_date: string | null;
  state: FeedbackState;
  edit_note: string | null;
  published_url: string | null;
  decided_by: string | null;
  decided_at: string | null;
};

export const FEEDBACK_LABELS: Record<FeedbackState, string> = {
  pending: "Sin revisar",
  approved_as_is: "Aprobada tal cual",
  approved_edited: "Aprobada con cambios",
  rejected: "Descartada",
  published: "Publicada",
};

export type ApprovalMetrics = {
  total_decided: number;
  approved_as_is: number;
  approved_edited: number;
  rejected: number;
  published: number;
  approved_as_is_rate: number | null;
  pending: number;
};

export type CoverageSnapshot = {
  week: string;
  platforms_covered: string[];
  sources_total: number;
  sources_ok: number;
  sources_failed: number;
  competitors_covered: number;
  posts_ingested: number;
  posts_analyzed: number;
};
