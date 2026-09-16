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
  topic: string;
  relevance_reason: string;
  angle: string;
  audience_signal: Audience;
  target_profiles: TargetProfile[];
  // Copy in: el texto dentro de la pieza.
  hook: string | null;
  hook_pattern: string;
  development: string;
  structure: string;
  cta: string | null;
  keywords: string[];
  expressions: string[];
  tone: string;
  // Copy out: el texto que la acompaña.
  hashtag_strategy: string;
  replicability: "alta" | "media" | "baja";
  humand_angle: string | null;
  why_it_worked: string;
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
  viral_score: number | null;
  analysis: PostAnalysis | null;
};

export type PatternLift = {
  key: string;
  top_count: number;
  lift: number;
};

export type RegionSynthesis = {
  region: string;
  posts_considered: number;
  top_posts_count: number;
  winning_hooks: PatternLift[] | null;
  winning_themes: PatternLift[] | null;
  top_topics: Array<{ key: string; count: number }>;
  tone_mix: Array<{ key: string; count: number }>;
  replicable_ideas: Array<{
    post_url: string | null;
    author_handle: string;
    hook: string | null;
    hook_pattern: string;
    theme: string;
    humand_angle: string;
    outlier_factor: number | null;
  }>;
  insufficient_sample?: string;
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
