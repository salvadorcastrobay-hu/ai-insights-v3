import type { InsightRow, InsightType } from "@/lib/supabase/types";

export type AnalyticsDimensionKey =
  | "insight_type_display"
  | "region"
  | "country"
  | "segment"
  | "industry"
  | "deal_stage"
  | "deal_owner"
  | "module_display"
  | "hr_category_display"
  | "acquisition_channel"
  | "deal_source"
  | "pain_subtype"
  | "faq_topic"
  | "friction_subtype"
  | "feature_gap"
  | "competitor"
  | "competitor_relationship";

type AnalyticsField = keyof InsightRow;

export type AnalyticsDimension = {
  key: AnalyticsDimensionKey;
  label: string;
  field: AnalyticsField;
  scopeType?: InsightType;
  excludeOwnBrand?: boolean;
};

export type AnalyticsRow = {
  insight_type?: InsightType | null;
  is_own_brand_competitor?: boolean | null;
} & Partial<Record<AnalyticsField, unknown>>;

export const ANALYTICS_DIMENSIONS: AnalyticsDimension[] = [
  { key: "insight_type_display", label: "Tipo de insight", field: "insight_type_display" },
  { key: "region", label: "Región", field: "region" },
  { key: "country", label: "País", field: "country" },
  { key: "segment", label: "Segmento", field: "segment" },
  { key: "industry", label: "Industria", field: "industry" },
  { key: "deal_stage", label: "Deal stage", field: "deal_stage" },
  { key: "deal_owner", label: "Deal owner", field: "deal_owner" },
  { key: "module_display", label: "Módulo", field: "module_display" },
  { key: "hr_category_display", label: "Categoría HR", field: "hr_category_display" },
  { key: "acquisition_channel", label: "Canal de adquisición", field: "acquisition_channel" },
  { key: "deal_source", label: "Fuente del deal", field: "deal_source" },
  { key: "pain_subtype", label: "Pain", field: "insight_subtype_display", scopeType: "pain" },
  { key: "faq_topic", label: "FAQ topic", field: "insight_subtype_display", scopeType: "faq" },
  { key: "friction_subtype", label: "Fricción", field: "insight_subtype_display", scopeType: "deal_friction" },
  { key: "feature_gap", label: "Feature gap", field: "feature_display", scopeType: "product_gap" },
  {
    key: "competitor",
    label: "Competidor",
    field: "competitor_name",
    scopeType: "competitive_signal",
    excludeOwnBrand: true,
  },
  {
    key: "competitor_relationship",
    label: "Relación competitiva",
    field: "competitor_relationship_display",
    scopeType: "competitive_signal",
    excludeOwnBrand: true,
  },
];

export const ANALYTICS_DIMENSION_BY_KEY = Object.fromEntries(
  ANALYTICS_DIMENSIONS.map((dimension) => [dimension.key, dimension]),
) as Record<AnalyticsDimensionKey, AnalyticsDimension>;

export function normalizeAnalyticsDimensionKey(value: string | null | undefined): AnalyticsDimensionKey {
  if (!value || value === "insight_subtype_display") return "pain_subtype";
  if (value in ANALYTICS_DIMENSION_BY_KEY) return value as AnalyticsDimensionKey;
  return "insight_type_display";
}

export function getAnalyticsDimension(value: string | null | undefined): AnalyticsDimension {
  return ANALYTICS_DIMENSION_BY_KEY[normalizeAnalyticsDimensionKey(value)];
}

export function rowMatchesAnalyticsDimension(row: AnalyticsRow, dimension: AnalyticsDimension): boolean {
  if (dimension.scopeType && row.insight_type !== dimension.scopeType) return false;
  if (dimension.excludeOwnBrand && row.is_own_brand_competitor) return false;
  return true;
}

export function getAnalyticsDimensionValue(row: AnalyticsRow, dimension: AnalyticsDimension): string {
  const value = row[dimension.field];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export function filterRowsForAnalyticsDimension<T extends AnalyticsRow>(
  rows: T[],
  dimension: AnalyticsDimension,
): T[] {
  return rows.filter((row) => rowMatchesAnalyticsDimension(row, dimension));
}

export function availableAnalyticsDimensions<T extends AnalyticsRow>(
  rows: T[],
  dimensions = ANALYTICS_DIMENSIONS,
): AnalyticsDimension[] {
  return dimensions.filter((dimension) =>
    rows.some((row) => rowMatchesAnalyticsDimension(row, dimension) && getAnalyticsDimensionValue(row, dimension)),
  );
}
