import type { AdSource } from "./types";

// LinkedIn/Google Ads son WIP: solo visibles/ejecutables para estos emails
// hasta que se validen en producción. Sacar esta lista cuando se libere.
export const AD_SOURCE_WIP_EMAILS: readonly string[] = ["salvador.castrobay@humand.co"];

export function isAdSourceWipEnabled(email: string | null): boolean {
  return !!email && AD_SOURCE_WIP_EMAILS.includes(email.toLowerCase());
}

// Competidores a monitorear en las ad libraries (vía ScrapeCreators).
// Curado para acotar créditos: ~3 créditos por competidor por refresh (3 pages).
// `query` se pasa como companyName; si el match por nombre es ambiguo, completar
// `pageId` (id de la página en el Ad Library), que es más preciso.
export type MonitoredCompetitor = {
  /** Nombre canónico (debe matchear la taxonomía si aplica). */
  name: string;
  /** Fuente: meta_ads | linkedin_ads | google_ads. */
  source: AdSource;
  /** companyName para buscar (Meta) o company para buscar (LinkedIn). */
  query: string;
  /** Opcional: pageId exacto del Ad Library (Meta, más preciso que el nombre). */
  pageId?: string;
  /**
   * Opcional: dominio del sitio del competidor, para Google Ads Transparency
   * Center (más preciso que buscar por nombre — la búsqueda por nombre trae
   * homónimos de otras empresas/regiones sin relación).
   */
  googleDomain?: string;
  region: "latam" | "emea" | "north_america" | "apac";
  /** Páginas de cursor a traer en cada refresh (~20 ads/página, 1 crédito c/u). Default 1. */
  maxPages?: number;
  /** Idioma de la síntesis. Default "es-AR". */
  language?: string;
  /** Handle de Instagram (sin @). Si está presente, se scrapea el orgánico vía Apify. */
  instagramHandle?: string;
  /** Marca propia para benchmarks orgánicos (no cuenta como competidor). */
  ownBrand?: boolean;
};

export const MONITORED_COMPETITORS: MonitoredCompetitor[] = [
  { name: "Humand",   source: "meta_ads", query: "Humand",       region: "latam", maxPages: 1, language: "es-AR", instagramHandle: "humand.es", ownBrand: true },
  { name: "Buk",         source: "meta_ads", query: "Buk",          pageId: "208911196408595", region: "latam", maxPages: 3, language: "es-AR", instagramHandle: "buk_chile" },
  { name: "Caju",        source: "meta_ads", query: "Caju",         pageId: "702340783527508", region: "latam", maxPages: 3, language: "pt-BR", instagramHandle: "caju" },
  { name: "Factorial",   source: "meta_ads", query: "Factorial HR", pageId: "110204987823596", region: "latam", maxPages: 3, language: "pt-BR", instagramHandle: "factorial_br" },
  { name: "Naaloo HR",   source: "meta_ads", query: "Naaloo HR",    pageId: "112904337293640", region: "latam", maxPages: 3, language: "es-AR", instagramHandle: "naaloohr" },
  { name: "Mandü HR",    source: "meta_ads", query: "Mandü HR",     pageId: "679832985204438", region: "latam", maxPages: 3, language: "es-AR", instagramHandle: "manduhr.pe" },
  { name: "Tu Recibo",   source: "meta_ads", query: "Tu Recibo",    region: "latam", maxPages: 3, language: "es-AR" },
  { name: "Crehana",     source: "meta_ads", query: "Crehana",      pageId: "1422292788065754", region: "latam", maxPages: 3, language: "es-AR", instagramHandle: "crehanacom" },
  { name: "Rankmi",      source: "meta_ads", query: "Rankmi",       pageId: "200938459759013", region: "latam", maxPages: 3, language: "es-AR", instagramHandle: "rankmioficial" },
  { name: "PeopleForce", source: "meta_ads", query: "PeopleForce",  pageId: "104448368352333", region: "latam", maxPages: 3, language: "es-AR", instagramHandle: "peopleforce.io" },

  // LinkedIn Ad Library (ScrapeCreators). La búsqueda por `query` es fuzzy
  // (matchea homónimos, ej. "Buk" también trae "Buket"/"Bukhara") — el
  // conector filtra por advertiser exacto antes de guardar.
  { name: "Buk",         source: "linkedin_ads", query: "Buk",          region: "latam", language: "es-AR" },
  { name: "Caju",        source: "linkedin_ads", query: "Caju",         region: "latam", language: "pt-BR" },
  { name: "Factorial",   source: "linkedin_ads", query: "Factorial HR", region: "latam", language: "pt-BR" },
  { name: "Naaloo HR",   source: "linkedin_ads", query: "Naaloo",       region: "latam", language: "es-AR" },
  { name: "Mandü HR",    source: "linkedin_ads", query: "Mandü",        region: "latam", language: "es-AR" },
  { name: "Tu Recibo",   source: "linkedin_ads", query: "Tu Recibo",    region: "latam", language: "es-AR" },
  { name: "Crehana",     source: "linkedin_ads", query: "Crehana",      region: "latam", language: "es-AR" },
  { name: "Rankmi",      source: "linkedin_ads", query: "Rankmi",       region: "latam", language: "es-AR" },
  { name: "PeopleForce", source: "linkedin_ads", query: "PeopleForce",  region: "latam", language: "es-AR" },

  // Google Ads Transparency Center (ScrapeCreators). Se busca por dominio
  // (más preciso que por nombre de empresa — confirmado contra la API real).
  { name: "Buk",         source: "google_ads", query: "Buk",          googleDomain: "buk.cl",              region: "latam", language: "es-AR" },
  { name: "Caju",        source: "google_ads", query: "Caju",         googleDomain: "caju.com.br",          region: "latam", language: "pt-BR" },
  { name: "Factorial",   source: "google_ads", query: "Factorial HR", googleDomain: "factorialhr.com.br",   region: "latam", language: "pt-BR" },
  { name: "Naaloo HR",   source: "google_ads", query: "Naaloo",       googleDomain: "naaloo.com",           region: "latam", language: "es-AR" },
  { name: "Mandü HR",    source: "google_ads", query: "Mandü",        googleDomain: "mandu.pe",             region: "latam", language: "es-AR" },
  { name: "Tu Recibo",   source: "google_ads", query: "Tu Recibo",    googleDomain: "turecibo.com",         region: "latam", language: "es-AR" },
  { name: "Crehana",     source: "google_ads", query: "Crehana",      googleDomain: "crehana.com",          region: "latam", language: "es-AR" },
  { name: "Rankmi",      source: "google_ads", query: "Rankmi",       googleDomain: "rankmi.com",           region: "latam", language: "es-AR" },
  { name: "PeopleForce", source: "google_ads", query: "PeopleForce",  googleDomain: "peopleforce.io",       region: "latam", language: "es-AR" },
];
