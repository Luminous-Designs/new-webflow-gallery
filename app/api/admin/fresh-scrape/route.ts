import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { promises as fs } from 'fs';
import path from 'path';
import axios from 'axios';
import { clampFreshScraperConfig } from '@/lib/scraper/fresh-scraper';

function safeJsonParse<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function readJsonBody(
  request: NextRequest
): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const text = await request.text();
    if (!text.trim()) return { ok: true, body: {} };
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ok: true, body: parsed as Record<string, unknown> };
    }
    return { ok: true, body: {} };
  } catch {
    return { ok: false, error: 'Invalid JSON body' };
  }
}

// Types
export interface FreshScrapeState {
  id: number;
  status: 'idle' | 'deleting' | 'scraping_featured' | 'scraping_regular' | 'paused' | 'completed' | 'failed';
  phase: 'none' | 'deletion' | 'discovery' | 'featured_scrape' | 'regular_scrape' | 'completed';
  total_sitemap_count: number;
  featured_author_ids: string | null;
  featured_template_urls: string | null;
  regular_template_urls: string | null;
  featured_total: number;
  featured_processed: number;
  featured_successful: number;
  featured_failed: number;
  regular_total: number;
  regular_processed: number;
  regular_successful: number;
  regular_failed: number;
  current_batch_index: number;
  current_batch_urls: string | null;
  config: string | null;
  started_at: string | null;
  paused_at: string | null;
  resumed_at: string | null;
  completed_at: string | null;
  deletion_completed_at: string | null;
  featured_completed_at: string | null;
  last_error: string | null;
  error_count: number;
  created_at: string;
  updated_at: string;
}

export interface FreshScrapeConfig {
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
  timeout: number;
  screenshotAnimationWaitMs: number;
  screenshotNudgeScrollRatio: number;
  screenshotNudgeWaitMs: number;
  screenshotNudgeAfterMs: number;
  screenshotStabilityStableMs: number;
  screenshotStabilityMaxWaitMs: number;
  screenshotStabilityCheckIntervalMs: number;
  screenshotJpegQuality: number;
  screenshotWebpQuality: number;
  thumbnailWebpQuality: number;
}

interface FreshScrapeScreenshot {
  id: number;
  fresh_scrape_id: number;
  template_name: string | null;
  template_slug: string | null;
  screenshot_thumbnail_path: string | null;
  is_featured_author: boolean;
  captured_at: string;
}

// Helper to check for active fresh scrape
async function getActiveFreshScrape(): Promise<FreshScrapeState | null> {
  const state = await db.getAsync<FreshScrapeState>(
    `SELECT * FROM fresh_scrape_state
     WHERE status IN ('deleting', 'scraping_featured', 'scraping_regular', 'paused')
     ORDER BY created_at DESC LIMIT 1`
  );
  return state || null;
}

// Helper to get latest fresh scrape state
async function getLatestFreshScrape(): Promise<FreshScrapeState | null> {
  const state = await db.getAsync<FreshScrapeState>(
    `SELECT * FROM fresh_scrape_state ORDER BY created_at DESC LIMIT 1`
  );
  return state || null;
}

async function getLastScreenshotForScrape(stateId: number): Promise<{
  template_name: string | null;
  template_slug: string | null;
  screenshot_thumbnail_path: string | null;
  screenshot_path: string | null;
  captured_at: string;
} | null> {
  const row = await db.getAsync<{
    template_name: string | null;
    template_slug: string | null;
    screenshot_thumbnail_path: string | null;
    captured_at: string;
  }>(
    `SELECT template_name, template_slug, screenshot_thumbnail_path, captured_at
     FROM fresh_scrape_screenshots
     WHERE fresh_scrape_id = ?
     ORDER BY captured_at DESC
     LIMIT 1`,
    [stateId]
  );
  if (!row) return null;
  return {
    ...row,
    screenshot_path: row.template_slug ? `/screenshots/${row.template_slug}.webp` : null
  };
}

// Helper to fetch sitemap URLs
async function fetchSitemapUrls(): Promise<string[]> {
  const sitemapUrl = 'https://templates.webflow.com/sitemap.xml';
  const response = await axios.get(sitemapUrl);
  const xml = response.data;

  const htmlTemplateRegex = /<loc>(https:\/\/templates\.webflow\.com\/html\/[^<]+)<\/loc>/g;
  const urls: string[] = [];
  let match;
  while ((match = htmlTemplateRegex.exec(xml)) !== null) {
    urls.push(match[1]);
  }

  return urls;
}

// Helper to delete all template data and files
async function deleteAllData(): Promise<{ templatesDeleted: number; screenshotsDeleted: number; thumbnailsDeleted: number }> {
  let templatesDeleted = 0;
  let screenshotsDeleted = 0;
  let thumbnailsDeleted = 0;

  // Count templates before deletion
  const countResult = await db.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM templates');
  templatesDeleted = countResult?.count || 0;

  // Clear visitor's template references first (foreign key to templates)
  await db.runAsync('UPDATE visitors SET selected_template_id = NULL');

  // Clear purchases template references (but keep purchase records)
  // Note: purchases has FK to templates, need to handle this
  await db.runAsync('DELETE FROM purchases WHERE template_id IS NOT NULL');

  // Delete preview_metrics (has FK to templates)
  await db.runAsync('DELETE FROM preview_metrics');

  // Delete thumbnail_jobs (has FK to templates)
  await db.runAsync('DELETE FROM thumbnail_jobs');

  // Delete ultra_featured_templates (has FK to templates)
  await db.runAsync('DELETE FROM ultra_featured_templates');

  // Delete junction tables (have FK to templates)
  await db.runAsync('DELETE FROM template_features');
  await db.runAsync('DELETE FROM template_styles');
  await db.runAsync('DELETE FROM template_subcategories');

  // Now delete templates
  await db.runAsync('DELETE FROM templates');

  // Clean up orphaned metadata
  await db.runAsync('DELETE FROM features');
  await db.runAsync('DELETE FROM styles');
  await db.runAsync('DELETE FROM subcategories');

  // Reset batch scraping tables (respect FK order: children first)
  await db.runAsync('DELETE FROM batch_templates');
  await db.runAsync('DELETE FROM session_resume_points');
  await db.runAsync('DELETE FROM scrape_batches');
  await db.runAsync('DELETE FROM scrape_sessions');

  // Reset legacy scrape jobs (respect FK order)
  await db.runAsync('DELETE FROM scrape_logs');
  await db.runAsync('DELETE FROM scrape_jobs');

  // Clear old fresh scrape screenshots (but keep current state)
  await db.runAsync('DELETE FROM fresh_scrape_screenshots WHERE fresh_scrape_id NOT IN (SELECT id FROM fresh_scrape_state WHERE status IN ("deleting", "scraping_featured", "scraping_regular", "paused"))');

  // Delete screenshot files
  const screenshotDir = path.join(process.cwd(), 'public', 'screenshots');
  const thumbnailDir = path.join(process.cwd(), 'public', 'thumbnails');

  try {
    const screenshotFiles = await fs.readdir(screenshotDir);
    for (const file of screenshotFiles) {
      if (file.endsWith('.webp') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) {
        await fs.unlink(path.join(screenshotDir, file));
        screenshotsDeleted++;
      }
    }
  } catch {
    // Directory may not exist
  }

  try {
    const thumbnailFiles = await fs.readdir(thumbnailDir);
    for (const file of thumbnailFiles) {
      if (file.endsWith('.webp') || file.endsWith('.jpg') || file.endsWith('.jpeg') || file.endsWith('.png')) {
        await fs.unlink(path.join(thumbnailDir, file));
        thumbnailsDeleted++;
      }
    }
  } catch {
    // Directory may not exist
  }

  // Vacuum database
  await db.runAsync('VACUUM');

  return { templatesDeleted, screenshotsDeleted, thumbnailsDeleted };
}

// POST handler
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const body = parsed.body;
    const action = typeof body.action === 'string' ? body.action : undefined;
    const config = body.config as Partial<FreshScrapeConfig> | undefined;
    const urls = body.urls as string[] | undefined;

    switch (action) {
      case 'start': {
        // Check for existing active scrape
        const existing = await getActiveFreshScrape();
        if (existing) {
          return NextResponse.json(
            { error: 'A fresh scrape is already in progress', state: existing },
            { status: 400 }
          );
        }

        // Get featured authors
        const featuredAuthors = await db.allAsync<{ author_id: string }>(
          'SELECT author_id FROM featured_authors WHERE is_active = 1'
        );
        const featuredAuthorIds = featuredAuthors.map(a => a.author_id);

        // Create initial config (sanitized/clamped)
        const baseConfig: FreshScrapeConfig = {
          concurrency: 5,
          browserInstances: 2,
          pagesPerBrowser: 5,
          batchSize: 10,
          timeout: 45000,
          screenshotAnimationWaitMs: 3000,
          screenshotNudgeScrollRatio: 0.2,
          screenshotNudgeWaitMs: 500,
          screenshotNudgeAfterMs: 500,
          screenshotStabilityStableMs: 1000,
          screenshotStabilityMaxWaitMs: 7000,
          screenshotStabilityCheckIntervalMs: 250,
          screenshotJpegQuality: 80,
          screenshotWebpQuality: 75,
          thumbnailWebpQuality: 60
        };
        const defaultConfig: FreshScrapeConfig = {
          ...baseConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        // Create fresh scrape state
        const { lastID } = await db.runAsync(
          `INSERT INTO fresh_scrape_state (
            status, phase, featured_author_ids, config, started_at
          ) VALUES (?, ?, ?, ?, datetime('now'))`,
          ['deleting', 'deletion', JSON.stringify(featuredAuthorIds), JSON.stringify(defaultConfig)]
        );

        const state = await db.getAsync<FreshScrapeState>(
          'SELECT * FROM fresh_scrape_state WHERE id = ?',
          [lastID]
        );

        return NextResponse.json({
          message: 'Fresh scrape started',
          state,
          featuredAuthorCount: featuredAuthorIds.length
        });
      }

      case 'confirm_delete': {
        // Get the active scrape in deletion phase
        const state = await getActiveFreshScrape();
        if (!state || state.phase !== 'deletion') {
          return NextResponse.json(
            { error: 'No active deletion pending' },
            { status: 400 }
          );
        }

        // Perform deletion
        const deletionResult = await deleteAllData();

        // Update state to discovery phase
        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            phase = 'discovery',
            deletion_completed_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`,
          [state.id]
        );

        return NextResponse.json({
          message: 'Deletion complete, starting discovery',
          deletionResult,
          stateId: state.id
        });
      }

      case 'discover': {
        // Get the active scrape in discovery phase
        const state = await getActiveFreshScrape();
        if (!state) {
          return NextResponse.json(
            { error: 'No active fresh scrape' },
            { status: 400 }
          );
        }

        // Fetch sitemap
        const allUrls = await fetchSitemapUrls();

        // Get featured author IDs
        const featuredAuthorIds: string[] = safeJsonParse(state.featured_author_ids, []);

        // We need to categorize URLs - but we don't know which templates belong to featured authors
        // until we scrape them. So we'll just set all URLs and handle prioritization during scraping.
        // The scraper will identify featured author templates as it processes them.

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            total_sitemap_count = ?,
            regular_template_urls = ?,
            regular_total = ?,
            phase = 'featured_scrape',
            status = 'scraping_featured',
            updated_at = datetime('now')
          WHERE id = ?`,
          [allUrls.length, JSON.stringify(allUrls), allUrls.length, state.id]
        );

        const updatedState = await db.getAsync<FreshScrapeState>(
          'SELECT * FROM fresh_scrape_state WHERE id = ?',
          [state.id]
        );

        return NextResponse.json({
          message: 'Discovery complete',
          totalUrls: allUrls.length,
          featuredAuthorCount: featuredAuthorIds.length,
          state: updatedState
        });
      }

      case 'check_new': {
        const active = await getActiveFreshScrape();
        if (active) {
          return NextResponse.json(
            { error: 'A scrape is already in progress', state: active },
            { status: 400 }
          );
        }

        const sitemapUrls = await fetchSitemapUrls();

        const existingSlugs = await db.allAsync<{ slug: string }>('SELECT slug FROM templates');
        const existingSlugSet = new Set(existingSlugs.map(r => r.slug));

        const missingTemplates = sitemapUrls
          .map(url => {
            const slug = url.split('/').filter(Boolean).pop() || '';
            return { url, slug };
          })
          .filter(t => t.slug && !existingSlugSet.has(t.slug))
          .map(t => {
            const displayName = t.slug
              .split('-')
              .map(part => part ? (part[0].toUpperCase() + part.slice(1)) : part)
              .join(' ');
            return { ...t, displayName };
          });

        return NextResponse.json({
          discovery: {
            totalInSitemap: sitemapUrls.length,
            existingInDb: existingSlugSet.size,
            missingCount: missingTemplates.length,
            missingTemplates: missingTemplates.slice(0, 200)
          }
        });
      }

      case 'start_update': {
        const existing = await getActiveFreshScrape();
        if (existing) {
          return NextResponse.json(
            { error: 'A scrape is already in progress', state: existing },
            { status: 400 }
          );
        }

        let urlsToScrape: string[] = [];
        if (urls && Array.isArray(urls) && urls.length > 0) {
          urlsToScrape = urls;
        } else {
          // Default behavior: compute missing templates from sitemap vs DB.
          const sitemapUrls = await fetchSitemapUrls();
          const existingSlugs = await db.allAsync<{ slug: string }>('SELECT slug FROM templates');
          const existingSlugSet = new Set(existingSlugs.map(r => r.slug));
          urlsToScrape = sitemapUrls.filter(url => {
            const slug = url.split('/').filter(Boolean).pop() || '';
            return slug && !existingSlugSet.has(slug);
          });
        }

        if (urlsToScrape.length === 0) {
          return NextResponse.json(
            { error: 'No missing templates to scrape' },
            { status: 400 }
          );
        }

        const baseConfig: FreshScrapeConfig = {
          concurrency: 5,
          browserInstances: 2,
          pagesPerBrowser: 5,
          batchSize: 10,
          timeout: 45000,
          screenshotAnimationWaitMs: 3000,
          screenshotNudgeScrollRatio: 0.2,
          screenshotNudgeWaitMs: 500,
          screenshotNudgeAfterMs: 500,
          screenshotStabilityStableMs: 1000,
          screenshotStabilityMaxWaitMs: 7000,
          screenshotStabilityCheckIntervalMs: 250,
          screenshotJpegQuality: 80,
          screenshotWebpQuality: 75,
          thumbnailWebpQuality: 60
        };
        const updateConfig: FreshScrapeConfig = {
          ...baseConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        const sitemapCount = typeof body.totalSitemapCount === 'number' ? body.totalSitemapCount : 0;

        const { lastID } = await db.runAsync(
          `INSERT INTO fresh_scrape_state (
            status, phase, total_sitemap_count,
            regular_template_urls, regular_total,
            config, started_at
          ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          [
            'scraping_regular',
            'regular_scrape',
            sitemapCount,
            JSON.stringify(urlsToScrape),
            urlsToScrape.length,
            JSON.stringify(updateConfig)
          ]
        );

        const state = await db.getAsync<FreshScrapeState>(
          'SELECT * FROM fresh_scrape_state WHERE id = ?',
          [lastID]
        );

        return NextResponse.json({
          message: 'Update scrape started',
          state
        });
      }

      case 'update_config': {
        // Update config for active scrape (applies to next batch)
        const state = await getActiveFreshScrape();
        if (!state) {
          return NextResponse.json(
            { error: 'No active fresh scrape' },
            { status: 400 }
          );
        }

        const currentConfig: FreshScrapeConfig = state.config
          ? safeJsonParse(state.config, {
            concurrency: 5,
            browserInstances: 2,
            pagesPerBrowser: 5,
            batchSize: 10,
            timeout: 45000,
            screenshotAnimationWaitMs: 3000,
            screenshotNudgeScrollRatio: 0.2,
            screenshotNudgeWaitMs: 500,
            screenshotNudgeAfterMs: 500,
            screenshotStabilityStableMs: 1000,
            screenshotStabilityMaxWaitMs: 7000,
            screenshotStabilityCheckIntervalMs: 250,
            screenshotJpegQuality: 80,
            screenshotWebpQuality: 75,
            thumbnailWebpQuality: 60
          })
          : {
            concurrency: 5,
            browserInstances: 2,
            pagesPerBrowser: 5,
            batchSize: 10,
            timeout: 45000,
            screenshotAnimationWaitMs: 3000,
            screenshotNudgeScrollRatio: 0.2,
            screenshotNudgeWaitMs: 500,
            screenshotNudgeAfterMs: 500,
            screenshotStabilityStableMs: 1000,
            screenshotStabilityMaxWaitMs: 7000,
            screenshotStabilityCheckIntervalMs: 250,
            screenshotJpegQuality: 80,
            screenshotWebpQuality: 75,
            thumbnailWebpQuality: 60
          };

        const newConfig: FreshScrapeConfig = {
          ...currentConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            config = ?,
            updated_at = datetime('now')
          WHERE id = ?`,
          [JSON.stringify(newConfig), state.id]
        );

        return NextResponse.json({
          message: 'Config updated',
          config: newConfig
        });
      }

      case 'pause': {
        const state = await getActiveFreshScrape();
        if (!state) {
          return NextResponse.json(
            { error: 'No active fresh scrape to pause' },
            { status: 400 }
          );
        }

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            status = 'paused',
            paused_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`,
          [state.id]
        );

        return NextResponse.json({ message: 'Scrape paused' });
      }

      case 'resume': {
        const state = await db.getAsync<FreshScrapeState>(
          `SELECT * FROM fresh_scrape_state WHERE status = 'paused' ORDER BY created_at DESC LIMIT 1`
        );

        if (!state) {
          return NextResponse.json(
            { error: 'No paused fresh scrape to resume' },
            { status: 400 }
          );
        }

        // Determine what status to resume to based on phase
        let newStatus = 'scraping_regular';
        if (state.phase === 'featured_scrape') {
          newStatus = 'scraping_featured';
        }

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            status = ?,
            resumed_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`,
          [newStatus, state.id]
        );

        const updatedState = await db.getAsync<FreshScrapeState>(
          'SELECT * FROM fresh_scrape_state WHERE id = ?',
          [state.id]
        );

        return NextResponse.json({
          message: 'Scrape resumed',
          state: updatedState
        });
      }

      case 'cancel': {
        const state = await getActiveFreshScrape();
        if (!state) {
          return NextResponse.json(
            { error: 'No active fresh scrape to cancel' },
            { status: 400 }
          );
        }

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            status = 'failed',
            last_error = 'Cancelled by user',
            completed_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`,
          [state.id]
        );

        return NextResponse.json({ message: 'Scrape cancelled' });
      }

      case 'update_progress': {
        // Called by scraper to update progress
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }
        const isFeatured = body.isFeatured === true;
        const processed = typeof body.processed === 'number' ? body.processed : undefined;
        const successful = typeof body.successful === 'number' ? body.successful : undefined;
        const failed = typeof body.failed === 'number' ? body.failed : undefined;
        const batchIndex = typeof body.batchIndex === 'number' ? body.batchIndex : undefined;
        const currentBatchUrls = Array.isArray(body.currentBatchUrls)
          ? (body.currentBatchUrls as unknown[]).filter((u): u is string => typeof u === 'string')
          : undefined;

        const state = await db.getAsync<FreshScrapeState>(
          'SELECT * FROM fresh_scrape_state WHERE id = ?',
          [stateId]
        );

        if (!state) {
          return NextResponse.json({ error: 'State not found' }, { status: 404 });
        }

        const updates: string[] = ['updated_at = datetime("now")'];
        const params: (string | number)[] = [];

        if (isFeatured) {
          if (processed !== undefined) {
            updates.push('featured_processed = ?');
            params.push(processed);
          }
          if (successful !== undefined) {
            updates.push('featured_successful = ?');
            params.push(successful);
          }
          if (failed !== undefined) {
            updates.push('featured_failed = ?');
            params.push(failed);
          }
        } else {
          if (processed !== undefined) {
            updates.push('regular_processed = ?');
            params.push(processed);
          }
          if (successful !== undefined) {
            updates.push('regular_successful = ?');
            params.push(successful);
          }
          if (failed !== undefined) {
            updates.push('regular_failed = ?');
            params.push(failed);
          }
        }

        if (batchIndex !== undefined) {
          updates.push('current_batch_index = ?');
          params.push(batchIndex);
        }

        if (currentBatchUrls !== undefined) {
          updates.push('current_batch_urls = ?');
          params.push(JSON.stringify(currentBatchUrls));
        }

        params.push(stateId);

        await db.runAsync(
          `UPDATE fresh_scrape_state SET ${updates.join(', ')} WHERE id = ?`,
          params
        );

        return NextResponse.json({ message: 'Progress updated' });
      }

      case 'complete_featured': {
        // Mark featured scraping as complete, move to regular
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            phase = 'regular_scrape',
            status = 'scraping_regular',
            featured_completed_at = datetime('now'),
            current_batch_index = 0,
            updated_at = datetime('now')
          WHERE id = ?`,
          [stateId]
        );

        return NextResponse.json({ message: 'Featured scraping complete' });
      }

      case 'complete': {
        // Mark entire scrape as complete
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            status = 'completed',
            phase = 'completed',
            completed_at = datetime('now'),
            updated_at = datetime('now')
          WHERE id = ?`,
          [stateId]
        );

        return NextResponse.json({ message: 'Fresh scrape completed' });
      }

      case 'add_screenshot': {
        // Add screenshot to feed
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }
        const templateName = typeof body.templateName === 'string' ? body.templateName : null;
        const templateSlug = typeof body.templateSlug === 'string' ? body.templateSlug : null;
        const thumbnailPath = typeof body.thumbnailPath === 'string' ? body.thumbnailPath : null;
        const isFeaturedAuthor = body.isFeaturedAuthor === true;

        await db.runAsync(
          `INSERT INTO fresh_scrape_screenshots
            (fresh_scrape_id, template_name, template_slug, screenshot_thumbnail_path, is_featured_author)
          VALUES (?, ?, ?, ?, ?)`,
          [stateId, templateName, templateSlug, thumbnailPath, isFeaturedAuthor ? 1 : 0]
        );

        return NextResponse.json({ message: 'Screenshot added' });
      }

      case 'record_error': {
        // Record an error
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }
        const error = typeof body.error === 'string' ? body.error : 'Unknown error';

        await db.runAsync(
          `UPDATE fresh_scrape_state SET
            last_error = ?,
            error_count = error_count + 1,
            updated_at = datetime('now')
          WHERE id = ?`,
          [error, stateId]
        );

        return NextResponse.json({ message: 'Error recorded' });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Fresh scrape API error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

// GET handler
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action');

    switch (action) {
      case 'status': {
        // Get current state
        const active = await getActiveFreshScrape();
        const latest = await getLatestFreshScrape();

        // Check if there's a paused scrape that can be resumed
        const paused = await db.getAsync<FreshScrapeState>(
          `SELECT * FROM fresh_scrape_state WHERE status = 'paused' ORDER BY created_at DESC LIMIT 1`
        );

        const [pausedLastScreenshot, activeLastScreenshot] = await Promise.all([
          paused?.id ? getLastScreenshotForScrape(paused.id) : Promise.resolve(null),
          active?.id ? getLastScreenshotForScrape(active.id) : Promise.resolve(null)
        ]);

        return NextResponse.json({
          isActive: !!active,
          hasPausedScrape: !!paused,
          activeState: active,
          pausedState: paused,
          latestState: latest,
          pausedLastScreenshot,
          activeLastScreenshot
        });
      }

      case 'progress': {
        const stateId = searchParams.get('stateId');
        if (!stateId) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }

        const state = await db.getAsync<FreshScrapeState>(
          'SELECT * FROM fresh_scrape_state WHERE id = ?',
          [stateId]
        );

        if (!state) {
          return NextResponse.json({ error: 'State not found' }, { status: 404 });
        }

        // Calculate progress percentages
        const featuredProgress = state.featured_total > 0
          ? (state.featured_processed / state.featured_total) * 100
          : 0;
        const regularProgress = state.regular_total > 0
          ? (state.regular_processed / state.regular_total) * 100
          : 0;

        const totalProcessed = state.featured_processed + state.regular_processed;
        const totalCount = state.featured_total + state.regular_total;
        const overallProgress = totalCount > 0 ? (totalProcessed / totalCount) * 100 : 0;

        // Calculate ETA
        let estimatedSecondsRemaining = 0;
        if (state.started_at && totalProcessed > 0) {
          const startTime = new Date(state.started_at).getTime();
          const now = Date.now();
          const elapsedMs = now - startTime;
          const avgTimePerTemplate = elapsedMs / totalProcessed;
          const remaining = totalCount - totalProcessed;
          estimatedSecondsRemaining = Math.round((avgTimePerTemplate * remaining) / 1000);
        }

        return NextResponse.json({
          state,
          progress: {
            featured: featuredProgress,
            regular: regularProgress,
            overall: overallProgress
          },
          estimatedSecondsRemaining,
          totalProcessed,
          totalCount
        });
      }

      case 'screenshots': {
        const stateId = searchParams.get('stateId');
        const limit = parseInt(searchParams.get('limit') || '50');
        const offset = parseInt(searchParams.get('offset') || '0');

        if (!stateId) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }

        const screenshots = await db.allAsync<FreshScrapeScreenshot>(
          `SELECT * FROM fresh_scrape_screenshots
           WHERE fresh_scrape_id = ?
           ORDER BY captured_at DESC
           LIMIT ? OFFSET ?`,
          [stateId, limit, offset]
        );

        const screenshotsWithPaths = screenshots.map(s => ({
          ...s,
          screenshot_path: s.template_slug ? `/screenshots/${s.template_slug}.webp` : null
        }));

        const totalCount = await db.getAsync<{ count: number }>(
          'SELECT COUNT(*) as count FROM fresh_scrape_screenshots WHERE fresh_scrape_id = ?',
          [stateId]
        );

        return NextResponse.json({
          screenshots: screenshotsWithPaths,
          total: totalCount?.count || 0,
          hasMore: (totalCount?.count || 0) > offset + limit
        });
      }

      case 'featured_authors': {
        const authors = await db.allAsync<{ author_id: string; author_name: string }>(
          'SELECT author_id, author_name FROM featured_authors WHERE is_active = 1'
        );

        return NextResponse.json({ authors });
      }

      default:
        // Default: return status
        const active = await getActiveFreshScrape();
        const paused = await db.getAsync<FreshScrapeState>(
          `SELECT * FROM fresh_scrape_state WHERE status = 'paused' ORDER BY created_at DESC LIMIT 1`
        );

        return NextResponse.json({
          isActive: !!active,
          hasPausedScrape: !!paused,
          activeState: active,
          pausedState: paused
        });
    }
  } catch (error) {
    console.error('Fresh scrape GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
