import type { AdSource } from "./types";

// Competidores a monitorear en las ad libraries (vía ScrapeCreators).
// Curado para acotar créditos: ~3 créditos por competidor por refresh (3 pages).
// `query` se pasa como companyName; si el match por nombre es ambiguo, completar
// `pageId` (id de la página en el Ad Library), que es más preciso.
export type MonitoredCompetitor = {
  /** Nombre canónico (debe matchear la taxonomía si aplica). */
  name: string;
  /** Fuente. Por ahora meta_ads; linkedin_ads/google_ads se suman después. */
  source: AdSource;
  /** companyName para buscar en el Ad Library (Meta). */
  query: string;
  /** Opcional: pageId exacto del Ad Library (más preciso que el nombre). */
  pageId?: string;
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
  { name: "Buk",      source: "meta_ads", query: "Buk",          pageId: "208911196408595", region: "latam", maxPages: 3, language: "es-AR", instagramHandle: "buk_chile" },
  { name: "Caju",     source: "meta_ads", query: "Caju",         pageId: "702340783527508", region: "latam", maxPages: 3, language: "pt-BR", instagramHandle: "caju" },
  { name: "Factorial",source: "meta_ads", query: "Factorial HR", pageId: "110204987823596", region: "latam", maxPages: 3, language: "pt-BR", instagramHandle: "factorial_br" },
];
