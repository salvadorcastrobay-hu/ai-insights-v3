export type ConversationItem = {
  id: string;
  title: string;
  initial_question?: string | null;
  created_at?: string | null;
};

export type DataTablePayload = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

export type ChartPayload = {
  type: "bar" | "metric";
  title?: string | null;
  labelKey?: string | null;
  valueKey?: string | null;
  series: Array<Record<string, unknown>>;
};

export type SearchResult = {
  chunk_text?: string;
  company_name?: string;
  call_date?: string;
  segment?: string;
  region?: string;
  country?: string;
  deal_name?: string;
  deal_owner?: string;
  deal_stage?: string;
  source_type?: string;
  similarity?: number;
};

export type CampaignAngle = {
  rank: number;
  action_type: string;
  title: string;
  target_audience: string;
  hero_message: string;
  core_message: string;
  key_pain_addressed: string;
  supporting_data: string;
  qualification_checks: string[];
  channels: string[];
  content_ideas: string[];
  priority: string;
  launch_readiness: string;
  rationale?: string;
};

export type MarketingRecommendation = {
  segment_summary: string;
  recommended_market_language: string;
  market_tone: string;
  confidence_reason: string;
  freshness_window: string;
  qualification_summary: string[];
  recommended_angles: CampaignAngle[];
  what_not_to_do: string[];
  data_confidence: string;
  sample_size?: number;
  filters_applied?: Record<string, unknown>;
  model_used?: string;
  error?: string;
};

export type AdvisorMetadata = {
  pipeline_deals?: number;
  pipeline_revenue?: number;
  insight_sample_size?: number;
};

export type ExternalSourceRecord = {
  url: string;
  excerpt?: string;
  error?: string;
};

export type ChatMessageModel = {
  id: string;
  role: "user" | "assistant";
  content: string;
  mode?: "chat" | "sql" | "hybrid" | "search" | "advisor_recommendation" | "advisor_followup";
  warnings?: string[];
  sql?: string | null;
  quant_sql?: string | null;
  qual_sql?: string | null;
  search_query?: string | null;
  search_filters?: string | null;
  search_sql?: string | null;
  table?: DataTablePayload | null;
  quant_table?: DataTablePayload | null;
  qual_table?: DataTablePayload | null;
  search_sql_table?: DataTablePayload | null;
  chart?: ChartPayload | null;
  search_results?: SearchResult[];
  recommendation?: MarketingRecommendation | null;
  metadata?: AdvisorMetadata | null;
  pipeline?: Record<string, unknown> | null;
  insights?: Record<string, unknown> | null;
  filters_applied?: Record<string, unknown> | null;
};
