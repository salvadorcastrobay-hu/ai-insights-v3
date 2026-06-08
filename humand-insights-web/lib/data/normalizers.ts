import type { AcquisitionChannel } from "@/lib/supabase/types";
import { OFFICIAL_REGION_OPTIONS } from "./constants";

const OFFICIAL_REGION_SET = new Set<string>(OFFICIAL_REGION_OPTIONS);

export { OFFICIAL_REGION_OPTIONS };

type OfficialRegion = (typeof OFFICIAL_REGION_OPTIONS)[number];

const REGION_ALIASES: Record<string, OfficialRegion> = {
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

// País → región canónica. Fuente de verdad cuando el campo `region` de la DB
// trae ciudades/provincias/estados sueltos (ej: "Montevideo Department",
// "Île-de-France", "Texas") que no podemos enumerar exhaustivamente.
// Las keys se comparan con normalizeKey() (lowercase + sin acentos).
const COUNTRY_TO_REGION: Record<string, OfficialRegion> = {
  // HISPAM (LATAM hispanohablante)
  argentina: "HISPAM",
  mexico: "HISPAM",
  colombia: "HISPAM",
  chile: "HISPAM",
  peru: "HISPAM",
  uruguay: "HISPAM",
  paraguay: "HISPAM",
  bolivia: "HISPAM",
  ecuador: "HISPAM",
  venezuela: "HISPAM",
  "costa rica": "HISPAM",
  panama: "HISPAM",
  guatemala: "HISPAM",
  honduras: "HISPAM",
  "el salvador": "HISPAM",
  nicaragua: "HISPAM",
  "dominican republic": "HISPAM",
  "republica dominicana": "HISPAM",
  cuba: "HISPAM",
  "puerto rico": "HISPAM",
  // Brazil
  brazil: "Brazil",
  brasil: "Brazil",
  // ANGLO AMERICA
  "united states": "ANGLO AMERICA",
  usa: "ANGLO AMERICA",
  us: "ANGLO AMERICA",
  "united states of america": "ANGLO AMERICA",
  canada: "ANGLO AMERICA",
  // EMEA
  spain: "EMEA",
  espana: "EMEA",
  france: "EMEA",
  germany: "EMEA",
  italy: "EMEA",
  italia: "EMEA",
  portugal: "EMEA",
  netherlands: "EMEA",
  belgium: "EMEA",
  switzerland: "EMEA",
  austria: "EMEA",
  sweden: "EMEA",
  norway: "EMEA",
  denmark: "EMEA",
  finland: "EMEA",
  poland: "EMEA",
  ireland: "EMEA",
  greece: "EMEA",
  "czech republic": "EMEA",
  czechia: "EMEA",
  romania: "EMEA",
  hungary: "EMEA",
  "united kingdom": "EMEA",
  uk: "EMEA",
  "great britain": "EMEA",
  england: "EMEA",
  scotland: "EMEA",
  wales: "EMEA",
  "northern ireland": "EMEA",
  bulgaria: "EMEA",
  croatia: "EMEA",
  slovakia: "EMEA",
  slovenia: "EMEA",
  estonia: "EMEA",
  latvia: "EMEA",
  lithuania: "EMEA",
  ukraine: "EMEA",
  serbia: "EMEA",
  // South Africa cae típicamente en EMEA en go-to-market B2B
  "south africa": "EMEA",
  nigeria: "EMEA",
  kenya: "EMEA",
  // APAC
  japan: "APAC",
  china: "APAC",
  india: "APAC",
  australia: "APAC",
  "new zealand": "APAC",
  singapore: "APAC",
  thailand: "APAC",
  vietnam: "APAC",
  philippines: "APAC",
  indonesia: "APAC",
  malaysia: "APAC",
  "south korea": "APAC",
  korea: "APAC",
  "hong kong": "APAC",
  taiwan: "APAC",
  // MENA
  "united arab emirates": "MENA",
  uae: "MENA",
  "saudi arabia": "MENA",
  egypt: "MENA",
  israel: "MENA",
  turkey: "MENA",
  qatar: "MENA",
  kuwait: "MENA",
  bahrain: "MENA",
  oman: "MENA",
  jordan: "MENA",
  lebanon: "MENA",
  morocco: "MENA",
  tunisia: "MENA",
  algeria: "MENA",
};

const COMPETITOR_ALIASES: Record<string, string> = {
  humand: "Humand",
  human: "Humand",
  "human d": "Humand",
  book: "Buk",
  "buk hr": "Buk",
  bukhr: "Buk",
  buc: "Buk",
  senior: "Senior",
  solides: "Sólides",
  solids: "Sólides",
  fids: "Feedz",
  feedz: "Feedz",
  totus: "Totvs",
  tots: "Totvs",
  totvs: "Totvs",
  sesame: "Sesame",
  cesame: "Sesame",
  "sesame hr": "Sesame",
  odu: "Odoo",
  odoo: "Odoo",
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

export function normalizeRegion(
  value: string | null | undefined,
  country?: string | null | undefined,
): string | null {
  // 1) Si `region` ya es una región oficial → usarla.
  if (value) {
    const cleaned = value.trim().replace(/\s+/g, " ");
    if (OFFICIAL_REGION_SET.has(cleaned)) return cleaned;
    const aliased = REGION_ALIASES[normalizeKey(cleaned)];
    if (aliased) return aliased;
  }
  // 2) Fallback al país. Para valores sucios como "Montevideo Department" o
  //    "Île-de-France", el `country` de HubSpot es la única señal confiable.
  if (country) {
    const byCountry = COUNTRY_TO_REGION[normalizeKey(country)];
    if (byCountry) return byCountry;
  }
  // 3) Sin match: devolvemos null para que las páginas que agregan por región
  //    excluyan estas filas en vez de mostrarlas como columnas sueltas.
  return null;
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

// ─── Funnel phase ─────────────────────────────────────────────────────────────
// Mapea las 13 stages del Humand Customer Journey de HubSpot a 3 buckets
// canónicos. Solo string.toLowerCase() + includes() — sin regex unicode.
export type FunnelPhase = "pre_sale" | "closed" | "post_sale";

const POST_SALE_KEYWORDS = ["onboarding churned", "success red list", "success churned"];
const CLOSED_KEYWORDS = ["closed won", "closed lost", "postponed", "won", "lost"];
const PRE_SALE_KEYWORDS = [
  "lead",
  "early stage",
  "discovery",
  "champion",
  "decision maker",
  "pilot",
  "final negotiation",
];

export function getFunnelPhase(
  dealStage: string | null | undefined,
): FunnelPhase | null {
  if (!dealStage || typeof dealStage !== "string") return null;
  const lowered = dealStage.toLowerCase();
  for (const kw of POST_SALE_KEYWORDS) if (lowered.includes(kw)) return "post_sale";
  for (const kw of CLOSED_KEYWORDS) if (lowered.includes(kw)) return "closed";
  for (const kw of PRE_SALE_KEYWORDS) if (lowered.includes(kw)) return "pre_sale";
  return null;
}

// Outcome más granular dentro de "closed": distingue Won de Lost.
// Postponed se trata como Lost (no cerró pero salió del pipeline activo).
export type DealOutcome = "won" | "lost";

export function getDealOutcome(
  dealStage: string | null | undefined,
): DealOutcome | null {
  if (!dealStage || typeof dealStage !== "string") return null;
  const lowered = dealStage.toLowerCase();
  // "Won" matchea "Won" y "Closed Won". El check de "closed" sale primero
  // por si en algún momento hubiera "Closed Lost" — el orden previene falsos
  // positivos donde "won" matchearía antes de chequear "lost".
  if (lowered.includes("closed won") || lowered.includes("won")) return "won";
  if (lowered.includes("closed lost") || lowered.includes("lost")) return "lost";
  if (lowered.includes("postponed")) return "lost";
  return null;
}
