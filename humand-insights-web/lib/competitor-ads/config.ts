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
  { name: "Buk", query: "Buk", region: "latam" },
  { name: "Factorial", query: "Factorial HR", region: "latam" },
  { name: "Sesame HR", query: "Sesame HR", region: "latam" },
  { name: "Rankmi", query: "Rankmi", region: "latam" },
  { name: "Worky", query: "Worky", region: "latam" },
  { name: "GoIntegro", query: "GOintegro", region: "latam" },
  { name: "Crehana", query: "Crehana", region: "latam" },
  { name: "Personio", query: "Personio", region: "emea" },
  { name: "BambooHR", query: "BambooHR", region: "north_america" },
  { name: "Rippling", query: "Rippling", region: "north_america" },
  { name: "Lattice", query: "Lattice", region: "north_america" },
  { name: "Culture Amp", query: "Culture Amp", region: "north_america" },
];
