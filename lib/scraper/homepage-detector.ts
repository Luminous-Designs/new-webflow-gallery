/**
 * Homepage Detection Utility
 *
 * Detects if a Webflow template has an alternate homepage (not the index page)
 * and returns the best URL to screenshot.
 *
 * Many Webflow templates have an "intro" landing page at / and the real
 * homepage is at a slug like /home-1, /homepage-a, /landing/landing-1, etc.
 */

import { Page } from 'playwright';

// Target slug patterns for homepage detection (subdirectory-agnostic).
// We ONLY match explicit home/homepage first variants to avoid false positives
// like /portfolio, /demo, /landing, etc.
// IMPORTANT: We only match the FIRST variant (1, one, a, v1).
const HOMEPAGE_SLUG_PATTERNS: RegExp[] = [
  // home variations - ONLY first variants (1, one, a)
  /^home$/i,
  /^home[-_]?1$/i,               // home-1, home_1, home1
  /^home[-_]?a$/i,               // home-a, home_a
  /^home[-_]?one$/i,             // home-one, home_one
  /^home[-_]?v1$/i,              // home-v1

  // homepage variations - ONLY first variants
  /^homepage$/i,
  /^homepage[-_]?1$/i,           // homepage-1
  /^homepage[-_]?a$/i,           // homepage-a
  /^homepage[-_]?one$/i,         // homepage-one
  /^homepage[-_]?v1$/i,          // homepage-v1
];

// Full path patterns that should be matched exactly
// IMPORTANT: Only match first variants (1, one, a)
const HOMEPAGE_FULL_PATH_PATTERNS: RegExp[] = [
  // /homepages/ subdirectory - only first variants
  /^\/homepages?\/(home[-_]?[1a]?|home[-_]?one|homepage[-_]?[1a]?|homepage[-_]?one)$/i,

  // /layouts/ subdirectory (like /layouts-1/home-1) - only first variants
  /^\/layouts?[-_]?[1-9]?\/(home[-_]?[1a]?|home[-_]?one)$/i,

  // /pages/ subdirectory - only first variants
  /^\/pages?\/(home[-_]?[1a]?|home[-_]?one|homepage[-_]?[1a]?|homepage[-_]?one)$/i,

  // /demos/ subdirectory that still uses home slugs - only first variants
  /^\/demos?\/(home[-_]?[1a]?|home[-_]?one|homepage[-_]?[1a]?|homepage[-_]?one)$/i,
];

export interface HomepageDetectionResult {
  /** The URL to use for screenshotting */
  screenshotUrl: string;
  /** Whether an alternate homepage was detected */
  isAlternateHomepage: boolean;
  /** The original index URL */
  originalUrl: string;
  /** The detected homepage path (e.g., '/home-1', '/homepages/home-a') */
  detectedPath?: string;
  /** All candidate links found on the page */
  candidateLinks?: string[];
}

/**
 * Extract the final path segment from a URL path
 */
function getPathSegments(urlPath: string): string[] {
  return urlPath.split('/').filter(s => s.length > 0);
}

/**
 * Check if a path matches any of our homepage patterns
 */
function matchesHomepagePattern(urlPath: string): boolean {
  // Remove leading slash and get segments
  const normalizedPath = urlPath.startsWith('/') ? urlPath : '/' + urlPath;
  const cleanedPath = normalizedPath.split(/[?#]/)[0];
  const segments = getPathSegments(cleanedPath);

  if (segments.length === 0) return false;

  // Check full path patterns first (for subdirectory patterns)
  for (const pattern of HOMEPAGE_FULL_PATH_PATTERNS) {
    if (pattern.test(cleanedPath)) {
      return true;
    }
  }

  // Check last segment against slug patterns (subdirectory-agnostic)
  const lastSegment = segments[segments.length - 1];
  for (const pattern of HOMEPAGE_SLUG_PATTERNS) {
    if (pattern.test(lastSegment)) {
      return true;
    }
  }

  return false;
}

/**
 * Calculate a priority score for a homepage candidate
 * Higher score = more likely to be the actual homepage
 */
function calculateHomepagePriority(path: string): number {
  const normalizedPath = path.toLowerCase();
  const segments = getPathSegments(normalizedPath);
  const lastSegment = segments[segments.length - 1] || '';

  let score = 0;

  // Prefer simpler paths (fewer segments)
  score -= segments.length * 10;

  // Prefer paths with "home" in the last segment
  if (lastSegment.includes('home')) score += 50;
  if (lastSegment === 'home' || lastSegment === 'homepage') score += 30;

  // Prefer numbered variants (usually -1 is the primary)
  if (lastSegment.endsWith('-1') || lastSegment.endsWith('_1') || lastSegment.endsWith('1')) score += 20;
  if (lastSegment.endsWith('-a') || lastSegment.endsWith('_a') || lastSegment.endsWith('a')) score += 15;

  // Common subdirectories get a small boost
  if (normalizedPath.includes('/homepages/')) score += 10;
  if (normalizedPath.includes('/layouts')) score += 5;

  return score;
}

/**
 * Extract all internal links from a page
 */
async function extractInternalLinks(page: Page, baseUrl: string): Promise<string[]> {
  const baseUrlObj = new URL(baseUrl);
  const baseHost = baseUrlObj.host;

  const links = await page.evaluate((host: string) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const hrefs: string[] = [];

    for (const anchor of anchors) {
      const href = anchor.getAttribute('href');
      if (!href) continue;

      // Skip external links, anchors, javascript, etc.
      if (href.startsWith('#')) continue;
      if (href.startsWith('javascript:')) continue;
      if (href.startsWith('mailto:')) continue;
      if (href.startsWith('tel:')) continue;

      // Handle absolute URLs
      if (href.startsWith('http://') || href.startsWith('https://')) {
        try {
          const url = new URL(href);
          if (url.host === host) {
            hrefs.push(url.pathname);
          }
        } catch {
          // Invalid URL, skip
        }
      } else if (href.startsWith('/')) {
        // Relative path from root
        hrefs.push(href);
      } else {
        // Relative path from current page - convert to absolute
        hrefs.push('/' + href);
      }
    }

    // Deduplicate
    return [...new Set(hrefs)];
  }, baseHost);

  return links;
}

/**
 * Detect the best homepage URL for a template
 *
 * @param page - Playwright page that has already loaded the live preview URL
 * @param livePreviewUrl - The template's live preview URL (index page)
 * @returns Detection result with the best URL to screenshot
 */
export async function detectHomepage(
  page: Page,
  livePreviewUrl: string
): Promise<HomepageDetectionResult> {
  const result: HomepageDetectionResult = {
    screenshotUrl: livePreviewUrl,
    isAlternateHomepage: false,
    originalUrl: livePreviewUrl,
    candidateLinks: [],
  };

  try {
    // Extract all internal links from the page
    const links = await extractInternalLinks(page, livePreviewUrl);
    result.candidateLinks = links;

    // Filter links that match homepage patterns
    const homepageCandidates = links
      .filter(path => matchesHomepagePattern(path))
      .map(path => ({
        path,
        score: calculateHomepagePriority(path),
      }))
      .sort((a, b) => b.score - a.score);

    // If we found homepage candidates, use the best one
    if (homepageCandidates.length > 0) {
      const bestCandidate = homepageCandidates[0];
      const baseUrl = new URL(livePreviewUrl);
      const fullUrl = new URL(bestCandidate.path, baseUrl.origin).toString();

      result.screenshotUrl = fullUrl;
      result.isAlternateHomepage = true;
      result.detectedPath = bestCandidate.path;
    }
  } catch (error) {
    // If detection fails, fall back to original URL
    console.error('Homepage detection failed:', error);
  }

  return result;
}

/**
 * Batch detect homepages for multiple URLs
 * This is more efficient as it can reuse browser context
 *
 * @param page - Playwright page to use for detection
 * @param urls - Array of live preview URLs to check
 * @returns Map of original URL to detection result
 */
export async function batchDetectHomepages(
  page: Page,
  urls: string[]
): Promise<Map<string, HomepageDetectionResult>> {
  const results = new Map<string, HomepageDetectionResult>();

  for (const url of urls) {
    try {
      // Navigate to the URL
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 15000, // Quick timeout for detection
      });

      const detection = await detectHomepage(page, url);
      results.set(url, detection);
    } catch (error) {
      // On error, return the original URL
      results.set(url, {
        screenshotUrl: url,
        isAlternateHomepage: false,
        originalUrl: url,
      });
    }
  }

  return results;
}

/**
 * Quick check if a URL path looks like an alternate homepage
 * Used for display purposes without actually visiting the page
 */
export function isLikelyAlternateHomepage(path: string): boolean {
  return matchesHomepagePattern(path);
}

/**
 * Get the patterns being used for homepage detection
 * Useful for debugging and admin display
 */
export function getHomepagePatterns(): { slugPatterns: string[]; pathPatterns: string[] } {
  return {
    slugPatterns: HOMEPAGE_SLUG_PATTERNS.map(p => p.source),
    pathPatterns: HOMEPAGE_FULL_PATH_PATTERNS.map(p => p.source),
  };
}
