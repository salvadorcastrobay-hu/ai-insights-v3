export type AdSource = "meta_ads" | "linkedin_ads" | "google_ads";

// Forma normalizada de un aviso de competidor (lo que guardamos y mostramos).
export type CompetitorAd = {
  source: AdSource;
  competitor: string;
  ad_archive_id: string;
  collation_id: string | null; // id de campaña (Meta) → agrupa variantes
  page_id: string | null;
  page_name: string | null;
  is_active: boolean | null;
  ad_start_date: string | null; // ISO
  ad_end_date: string | null; // ISO
  publisher_platform: string[];
  display_format: string | null;
  body_text: string | null;
  title: string | null;
  cta_text: string | null;
  cta_type: string | null;
  link_url: string | null;
  categories: string[];
  media: { images: string[]; videos: string[] };
  country: string | null;
  raw: unknown; // objeto crudo de la API (para debug / re-mapeo)
};
