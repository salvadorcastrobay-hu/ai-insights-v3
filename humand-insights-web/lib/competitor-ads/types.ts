// Forma normalizada de un aviso de competidor (lo que guardamos y mostramos).
export type CompetitorAd = {
  competitor: string;
  ad_archive_id: string;
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
};
