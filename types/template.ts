export interface Template {
  id: number;
  template_id: string;
  name: string;
  slug: string;
  author_name?: string;
  author_id?: string;
  storefront_url: string;
  live_preview_url: string;
  designer_preview_url?: string;
  price?: string;
  short_description?: string;
  screenshot_path?: string;
  screenshot_thumbnail_path?: string;
  subcategories: string[];
  styles: string[];
  is_featured_author?: boolean;
  position?: number;
  [key: string]: unknown;
}
