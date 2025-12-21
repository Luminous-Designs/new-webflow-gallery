/**
 * Asset URL utilities for screenshot URLs.
 *
 * Screenshots are stored in Cloudflare R2 and served via a custom domain.
 * The scraper stores full URLs (e.g., https://screenshots.luminardigital.com/slug.webp).
 *
 * For legacy data that may have relative paths (e.g., /screenshots/slug.webp),
 * this module can convert them to full URLs using R2_PUBLIC_URL.
 */

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

/**
 * Get the base URL for screenshot assets (R2 public URL).
 */
export function getAssetBaseUrl(): string {
  const envBase =
    process.env.R2_PUBLIC_URL ||
    process.env.NEXT_PUBLIC_ASSET_BASE_URL ||
    process.env.ASSET_BASE_URL ||
    '';
  return stripTrailingSlashes(envBase);
}

/**
 * Converts a stored screenshot path or URL into a full public URL.
 *
 * - Full URLs (https://...) are returned as-is
 * - Relative paths (/screenshots/foo.webp or screenshots/foo.webp) are
 *   converted to full URLs using the R2 public domain
 * - Slug-only values (foo.webp or foo) are converted to full R2 URLs
 * - Empty/null values return null
 */
export function toAssetUrl(pathOrUrl?: string | null): string | null {
  if (!pathOrUrl) return null;
  const value = String(pathOrUrl).trim();
  if (!value) return null;

  // Already a full URL - return as-is
  if (/^https?:\/\//i.test(value)) return value;

  const baseUrl = getAssetBaseUrl();
  if (!baseUrl) {
    // No base URL configured, return value as-is
    return value;
  }

  // Handle legacy paths like /screenshots/slug.webp
  if (value.startsWith('/screenshots/')) {
    const filename = value.replace('/screenshots/', '');
    return `${baseUrl}/${filename}`;
  }

  // Handle paths like screenshots/slug.webp
  if (value.startsWith('screenshots/')) {
    const filename = value.replace('screenshots/', '');
    return `${baseUrl}/${filename}`;
  }

  // Handle just the filename (slug.webp)
  if (value.endsWith('.webp') || value.endsWith('.jpg') || value.endsWith('.png')) {
    return `${baseUrl}/${value}`;
  }

  // Handle just the slug (add .webp extension)
  if (/^[a-z0-9-]+$/i.test(value)) {
    return `${baseUrl}/${value}.webp`;
  }

  // Unknown format - return as-is
  return value;
}
