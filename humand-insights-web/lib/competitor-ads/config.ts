// Competidores a monitorear en la Facebook Ad Library (vía ScrapeCreators).
// Curado (no toda la taxonomía) para acotar créditos: ~1 crédito por
// competidor por refresh. `query` se pasa como companyName; si el match por
// nombre es ambiguo, completar `pageId` (id de la página en el Ad Library)
// que es más preciso.
export type MonitoredCompetitor = {
  /** Nombre canónico (debe matchear la taxonomía si aplica). */
  name: string;
  /** companyName para buscar en el Ad Library. */
  query: string;
  /** Opcional: pageId exacto del Ad Library (más preciso que el nombre). */
  pageId?: string;
  region: "latam" | "emea" | "north_america" | "apac";
};

export const MONITORED_COMPETITORS: MonitoredCompetitor[] = [
  // Arrancamos con uno solo para validar el flujo y no quemar créditos.
  // Sumar más acá cuando confirmemos que el match por nombre trae lo correcto.
  { name: "Buk", query: "Buk", pageId: "208911196408595", region: "latam" },
];
