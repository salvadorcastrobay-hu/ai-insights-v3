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
};

export const MONITORED_COMPETITORS: MonitoredCompetitor[] = [
  // Arrancamos con uno solo para validar el flujo y no quemar créditos.
  // Sumar más / otras fuentes acá cuando confirmemos el flujo end-to-end.
  { name: "Buk", source: "meta_ads", query: "Buk", pageId: "208911196408595", region: "latam" },
];
