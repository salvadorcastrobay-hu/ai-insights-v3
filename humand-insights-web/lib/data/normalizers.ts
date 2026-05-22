import type { AcquisitionChannel } from "@/lib/supabase/types";
import { OFFICIAL_REGION_OPTIONS } from "./constants";

const OFFICIAL_REGION_SET = new Set<string>(OFFICIAL_REGION_OPTIONS);

export { OFFICIAL_REGION_OPTIONS };

const REGION_ALIASES: Record<string, (typeof OFFICIAL_REGION_OPTIONS)[number]> = {
  latam: "HISPAM",
  hispam: "HISPAM",
  "santa fe province": "HISPAM",
  mendoza: "HISPAM",
  "mendoza province": "HISPAM",
  cordoba: "HISPAM",
  "cordoba capital": "HISPAM",
  "cordoba province": "HISPAM",
  "mexico city": "HISPAM",
  "ciudad de mexico": "HISPAM",
  "ciudad de mexico cdmx": "HISPAM",
  madrid: "EMEA",
  "community of madrid": "EMEA",
  "españa": "EMEA",
  espana: "EMEA",
  spain: "EMEA",
  emea: "EMEA",
  "north america": "ANGLO AMERICA",
  namer: "ANGLO AMERICA",
  "na region": "ANGLO AMERICA",
  "anglo america": "ANGLO AMERICA",
  apac: "APAC",
  mena: "MENA",
  brasil: "Brazil",
  brazil: "Brazil",
};

const COMPETITOR_ALIASES: Record<string, string> = {
  humand: "Humand",
  human: "Humand",
  "human d": "Humand",
  book: "Buk",
  "buk hr": "Buk",
  bukhr: "Buk",
  senior: "Senior",
  solides: "Sólides",
  solids: "Sólides",
  fids: "Feedz",
  feedz: "Feedz",
  totus: "Totvs",
  tots: "Totvs",
  totvs: "Totvs",
};

export const OWN_BRAND_ALIASES = new Set(["humand", "human", "human d"]);

const ACQ_CHANNEL_INBOUND = new Set([
  "marketing",
  "inbound",
  "event",
  "prensa",
  "webinar",
  "google ads",
  "meta ads",
  "landing",
  "linkedin",
  "referrals",
  "organic search",
  "paid search",
  "email marketing",
  "organic social",
  "paid social",
  "direct traffic",
  "offline sources",
  "other campaigns",
  "ai referrals",
]);

const ACQ_CHANNEL_OUTBOUND = new Set([
  "bdr",
  "ae",
  "cx",
  "external bdr",
  "outbound partner",
]);

const ACQ_CHANNEL_PARTNER = new Set([
  "partner",
  "referral partner",
  "business partner",
  "alliance",
  "hu referral",
  "standard cx referral",
  "hu coins admin panel",
]);

function normalizeKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeRegion(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.trim().replace(/\s+/g, " ");
  // Lookup with accent-stripped lowercase key for robustness
  const normalized = REGION_ALIASES[normalizeKey(cleaned)];
  if (normalized) return normalized;
  if (OFFICIAL_REGION_SET.has(cleaned)) return cleaned;
  return cleaned;
}

export function normalizeCompetitor(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = normalizeKey(value);
  return COMPETITOR_ALIASES[normalized] ?? value;
}

export function isOwnBrand(value: string | null | undefined): boolean {
  if (!value) return false;
  return OWN_BRAND_ALIASES.has(normalizeKey(value));
}

export function normalizeAcquisitionChannel(
  source: string | null,
  detail: string | null,
): Exclude<AcquisitionChannel, null> {
  for (const value of [source, detail]) {
    if (!value) continue;
    const normalized = value.toLowerCase().trim();
    if (ACQ_CHANNEL_INBOUND.has(normalized)) return "Inbound";
    if (ACQ_CHANNEL_OUTBOUND.has(normalized)) return "Outbound";
    if (ACQ_CHANNEL_PARTNER.has(normalized)) return "Partner / Referral";
  }
  return "Otros";
}

/**
 * Strip the "(<250 employees)" / "(250-1000 employees)" / etc. suffix from
 * segment labels for chart legibility. Humand employees know the segments by
 * their short name; the parenthetical is redundant in axis labels.
 */
export function shortSegmentLabel(value: string | null | undefined): string {
  if (!value) return "";
  return value.replace(/\s*\([^)]*\)\s*$/, "").trim();
}
