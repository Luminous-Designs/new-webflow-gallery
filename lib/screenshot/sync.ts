const DEFAULT_ASSET_BASE_URL = 'https://templates.luminardigital.com';

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

export interface ScreenshotSyncConfig {
  enabled: boolean;
  baseUrl: string | null;
  token: string | null;
  mode: 'local' | 'remote';
}

/**
 * Determines whether the scraper should sync screenshots to the VPS.
 *
 * - In production, screenshots should be written directly to the mounted volume, so remote sync is disabled by default.
 * - In localhost/dev, the UI still loads screenshots from the VPS asset domain; enabling remote sync prevents 404s.
 *
 * Env:
 * - `SCREENSHOT_SYNC_BASE_URL` (recommended): base URL of the VPS app (e.g. https://templates.luminardigital.com)
 * - `SCREENSHOT_SYNC_TOKEN` (optional): bearer token used for upload auth (defaults to `ADMIN_PASSWORD`)
 */
export function getScreenshotSyncConfig(): ScreenshotSyncConfig {
  const explicitBase = process.env.SCREENSHOT_SYNC_BASE_URL?.trim() || '';
  const defaultBase =
    process.env.NEXT_PUBLIC_ASSET_BASE_URL?.trim() ||
    process.env.ASSET_BASE_URL?.trim() ||
    DEFAULT_ASSET_BASE_URL;

  const isProd = process.env.NODE_ENV === 'production';
  const base = explicitBase || (!isProd ? defaultBase : '');
  const baseUrl = base ? stripTrailingSlashes(base) : null;

  const token =
    (process.env.SCREENSHOT_SYNC_TOKEN?.trim() || '') ||
    (process.env.ADMIN_PASSWORD?.trim() || '') ||
    null;

  const enabled = Boolean(baseUrl && token);
  return {
    enabled,
    baseUrl,
    token,
    mode: enabled ? 'remote' : 'local',
  };
}

