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

// ─── País ──────────────────────────────────────────────────────────────────
// Consolida duplicados del mismo país (acentos / ES-EN). Keys con normalizeKey
// (lowercase + sin acentos). Valores no mapeados pasan tal cual.
// CRÍTICO: mantener en sync con _norm_country (SQL).
const COUNTRY_ALIASES: Record<string, string> = {
  brasil: "Brasil",
  brazil: "Brasil",
  mexico: "México",
  peru: "Perú",
  panama: "Panamá",
  espana: "España",
  spain: "España",
  "republica dominicana": "República Dominicana",
  venezuela: "Venezuela",
  "venezuela, bolivarian republic of": "Venezuela",
  usa: "Estados Unidos",
  "united states": "Estados Unidos",
  "united states of america": "Estados Unidos",
  canada: "Canadá",
};

// ─── Industria ───────────────────────────────────────────────────────────────
// Toque liviano: los enums UPPER_SNAKE de HubSpot pasan a su nombre legible y
// se mergean SOLO cuando son literalmente la misma industria. Lo no mapeado
// con underscores se "prettifica"; el resto pasa tal cual.
// CRÍTICO: mantener en sync con _norm_industry (SQL).
const INDUSTRY_ALIASES: Record<string, string> = {
  // Merges (misma industria, distinta escritura)
  "financial services": "Financial services",
  financial_services: "Financial services",
  banking: "Banking",
  "software companies & it services": "Software Companies & IT services",
  computer_software: "Software Companies & IT services",
  information_technology_and_services: "Software Companies & IT services",
  "information technology and services": "Software Companies & IT services",
  "it services and it consulting": "Software Companies & IT services",
  computer_networking: "Software Companies & IT services",
  pharmaceuticals: "Pharmaceuticals",
  "pharmaceutical manufacturing": "Pharmaceuticals",
  healthcare: "Healthcare",
  "hospitals and health care": "Healthcare",
  hospital_health_care: "Healthcare",
  telecomunications: "Telecommunications",
  telecommunications: "Telecommunications",
  wireless: "Telecommunications",
  automotive: "Automotive",
  retail: "Retail",
  construction: "Construction",
  insurance: "Insurance",
  restaurants: "Restaurants",
  "real state": "Real Estate",
  real_estate: "Real Estate",
  mining: "Mining",
  mining_metals: "Mining",
  "chemicals/quimicas": "Chemicals/Químicas",
  chemicals: "Chemicals/Químicas",
  agriculture: "Agriculture",
  farming: "Agriculture",
  "gambling & casinos": "Gambling & Casinos",
  gambling_casinos: "Gambling & Casinos",
  "nonprofit organizations": "Nonprofit Organizations",
  non_profit_organization_management: "Nonprofit Organizations",
  "transportation & logistics": "Transportation & Logistics",
  transportation_trucking_railroad: "Transportation & Logistics",
  "transportation/trucking/railroad": "Transportation & Logistics",
  "transportation, logistics, supply chain and storage": "Transportation & Logistics",
  logistics_and_supply_chain: "Transportation & Logistics",
  "consumer goods": "Consumer Goods",
  consumer_goods: "Consumer Goods",
  "legal & accounting services": "Legal & Accounting services",
  legal_services: "Legal & Accounting services",
  accounting: "Legal & Accounting services",
  "hr/staffing services": "HR/Staffing Services",
  human_resources: "HR/Staffing Services",
  manufacturing: "Manufacturing",
  mechanical_or_industrial_engineering: "Manufacturing",
  "consulting services": "Consulting Services",
  "business consulting and services": "Consulting Services",
  "oil & energy": "Oil & Energy",
  oil_energy: "Oil & Energy",
  "security services": "Security Services",
  security_and_investigations: "Security Services",
  "hospitality & tourism": "Hospitality & Tourism",
  hospitality: "Hospitality & Tourism",
  "media & entertainment": "Media & Entertainment",
  entertainment: "Media & Entertainment",
  "management consulting": "Management Consulting",
  management_consulting: "Management Consulting",
  food_beverages: "Food & Beverages",
  food_production: "Food & Beverages",
  "food and beverage manufacturing": "Food & Beverages",
  renewables_environment: "Renewables & Environment",
  "renewable energy semiconductor manufacturing": "Renewables & Environment",
  // Solo renombrar (enum → legible, quedan separadas)
  consumer_services: "Consumer Services",
  individual_family_services: "Individual & Family Services",
  investment_management: "Investment Management",
  professional_training_coaching: "Professional Training & Coaching",
  research: "Research",
  civil_engineering: "Civil Engineering",
  building_materials: "Building Materials",
  apparel_fashion: "Apparel & Fashion",
  sporting_goods: "Sporting Goods",
  marketing_and_advertising: "Marketing & Advertising",
  graphic_design: "Graphic Design",
  publishing: "Publishing",
  printing: "Printing",
  public_relations_and_communications: "Public Relations & Communications",
  higher_education: "Higher Education",
  education_management: "Education Management",
  primary_secondary_education: "Primary/Secondary Education",
  fishery: "Fishery",
  paper_forest_products: "Paper & Forest Products",
  industrial_automation: "Industrial Automation",
  public_safety: "Public Safety",
  international_affairs: "International Affairs",
  airlines_aviation: "Airlines & Aviation",
  events_services: "Events Services",
  leisure_travel_tourism: "Leisure, Travel & Tourism",
  health_wellness_and_fitness: "Health, Wellness & Fitness",
};

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

export function normalizeCountry(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const aliased = COUNTRY_ALIASES[normalizeKey(value)];
  return aliased ?? value.trim();
}

/** Title-case de un enum UPPER_SNAKE/whitespace ("FOO_BAR" → "Foo Bar"). */
function prettifyEnum(value: string): string {
  return value
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizeIndustry(value: string | null | undefined): string | null {
  if (!value || !value.trim()) return null;
  const aliased = INDUSTRY_ALIASES[normalizeKey(value)];
  if (aliased) return aliased;
  // Enums sin mapear (snake_case) → prettify; el resto pasa tal cual.
  return value.includes("_") ? prettifyEnum(value) : value.trim();
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
