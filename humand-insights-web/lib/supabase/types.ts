export const LOAD_DATA_COLUMNS = [
  "id",
  "transcript_id",
  "deal_id",
  "deal_name",
  "company_name",
  "region",
  "country",
  "segment",
  "industry",
  "deal_stage",
  "deal_owner",
  "call_date",
  "amount",
  "insight_type",
  "insight_subtype",
  "module",
  "summary",
  "verbatim_quote",
  "confidence",
  "competitor_name",
  "competitor_relationship",
  "feature_name",
  "gap_description",
  "gap_priority",
  "insight_type_display",
  "insight_subtype_display",
  "module_display",
  "module_status",
  "hr_category_display",
  "pain_theme",
  "pain_scope",
  "feature_display",
  "feature_is_seed",
  "competitor_relationship_display",
] as const;

export type InsightType =
  | "pain"
  | "product_gap"
  | "competitive_signal"
  | "deal_friction"
  | "faq";

export type GapPriority = "must_have" | "nice_to_have" | "dealbreaker" | null;
export type ModuleStatus = "existing" | "missing" | null;
export type PainScope = "general" | "module_linked" | null;
export type AcquisitionChannel =
  | "Inbound"
  | "Outbound"
  | "Partner / Referral"
  | "Otros"
  | null;

export type InsightRow = {
  id: string;
  transcript_id: string;
  deal_id: string | null;
  deal_name: string | null;
  company_name: string | null;
  region: string | null;
  country: string | null;
  segment: string | null;
  industry: string | null;
  deal_stage: string | null;
  deal_owner: string | null;
  call_date: string | null;
  amount: number | null;
  insight_type: InsightType;
  insight_subtype: string;
  module: string | null;
  summary: string;
  verbatim_quote: string | null;
  confidence: number;
  competitor_name: string | null;
  competitor_relationship: string | null;
  feature_name: string | null;
  gap_description: string | null;
  gap_priority: GapPriority;
  insight_type_display: string;
  insight_subtype_display: string;
  module_display: string | null;
  module_status: ModuleStatus;
  hr_category_display: string | null;
  pain_theme: string | null;
  pain_scope: PainScope;
  feature_display: string | null;
  feature_is_seed: boolean | null;
  competitor_relationship_display: string | null;
  deal_source?: string | null;
  deal_source_detail?: string | null;
  acquisition_channel?: AcquisitionChannel;
  inbound_source?: string | null;
  partner_name?: string | null;
  is_own_brand_competitor?: boolean;
};

export type DealSourceFields = {
  deal_source: string | null;
  deal_source_detail: string | null;
  inbound_source: string | null;
  partner_name: string | null;
};

export type EnrichedDealSourceFields = DealSourceFields & {
  acquisition_channel: AcquisitionChannel;
};
