const DEFAULT_ASSET_BASE_URL = 'https://templates.luminardigital.com';

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export function getAssetBaseUrl(): string {
  const envBase =
    process.env.NEXT_PUBLIC_ASSET_BASE_URL ||
    process.env.ASSET_BASE_URL ||
    DEFAULT_ASSET_BASE_URL;
  return stripTrailingSlashes(envBase);
}

/**
 * Converts a stored DB path (e.g. `/screenshots/foo.webp`) into a URL that
 * always resolves against the VPS asset host (even in localhost).
 *
 * - Absolute URLs are returned as-is
 * - `/screenshots/*` is prefixed with `getAssetBaseUrl()`
 * - Other paths are returned unchanged
 */
export function toAssetUrl(pathOrUrl?: string | null): string | null {
  if (!pathOrUrl) return null;
  const value = String(pathOrUrl).trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;

  const normalized = value.startsWith('/') ? value : `/${value}`;
  if (normalized.startsWith('/screenshots/')) {
    return `${getAssetBaseUrl()}${normalized}`;
  }

  return value;
}
