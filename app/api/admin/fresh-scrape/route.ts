import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import axios from 'axios';
import { clampFreshScraperConfig } from '@/lib/scraper/fresh-scraper';
import { chromium } from 'playwright';
import { isR2Configured, getR2Config, testR2WriteConnectivity } from '@/lib/r2';

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    if (!raw.trim()) return fallback;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

async function runScraperPreflight() {
  // Check R2 storage configuration and write connectivity
  const r2Config = getR2Config();
  const storage = {
    ok: false,
    mode: 'r2' as const,
    publicUrl: r2Config.publicUrl,
    bucketName: r2Config.bucketName,
    writable: false,
    error: null as string | null,
  };

  if (!isR2Configured()) {
    storage.error = 'R2 is not configured. Set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, and R2_PUBLIC_URL environment variables.';
  } else {
    // Test actual write connectivity
    const writeTest = await testR2WriteConnectivity();
    storage.writable = writeTest.ok;
    storage.ok = writeTest.ok;
    if (!writeTest.ok) {
      storage.error = `R2 write test failed: ${writeTest.error}`;
    }
  }

  const supabaseCheck = {
    ok: false,
    readOk: false,
    writeOk: false,
    error: null as string | null,
  };

  try {
    const { error: readError } = await supabase
      .from('templates')
      .select('id')
      .limit(1);
    if (readError) throw readError;
    supabaseCheck.readOk = true;

    const { error: writeError } = await supabase
      .from('supabase_activity_log')
      .insert({
        action_type: 'scraper_preflight',
        table_name: 'templates',
        record_count: 0,
        details: { source: 'fresh_scraper_preflight' },
        success: true,
      });
    if (writeError) throw writeError;
    supabaseCheck.writeOk = true;
    supabaseCheck.ok = true;
  } catch (error) {
    supabaseCheck.ok = false;
    supabaseCheck.error = error instanceof Error ? error.message : 'Supabase check failed';
  }

  const browserCheck = {
    ok: false,
    version: null as string | null,
    error: null as string | null,
  };

  try {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
    const page = await context.newPage();
    await page.setContent('<html><body><h1>Scraper preflight</h1></body></html>');
    const buffer = await page.screenshot({ type: 'jpeg', quality: 70 });
    await page.close();
    await context.close();
    browserCheck.version = browser.version();
    await browser.close();

    if (!buffer || buffer.length < 5000) {
      throw new Error('Browser screenshot too small');
    }
    browserCheck.ok = true;
  } catch (error) {
    browserCheck.ok = false;
    browserCheck.error = error instanceof Error ? error.message : 'Browser check failed';
  }

  const ok = storage.ok && supabaseCheck.ok && browserCheck.ok;

  return {
    ok,
    checkedAt: new Date().toISOString(),
    storage,
    supabase: supabaseCheck,
    browser: browserCheck,
  };
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
  jobMode?: 'full' | 'screenshots_only';
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
}

// Helper to check for active fresh scrape
async function getActiveFreshScrape(): Promise<FreshScrapeState | null> {
  const { data } = await supabase
    .from('fresh_scrape_state')
    .select('*')
    .in('status', ['deleting', 'scraping_featured', 'scraping_regular', 'paused'])
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data;
}

// Helper to get latest fresh scrape state
async function getLatestFreshScrape(): Promise<FreshScrapeState | null> {
  const { data } = await supabase
    .from('fresh_scrape_state')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data;
}

async function getLastScreenshotForScrape(stateId: number): Promise<{
  template_name: string | null;
  template_slug: string | null;
  screenshot_thumbnail_path: string | null;
  screenshot_path: string | null;
  captured_at: string;
} | null> {
  const { data: row } = await supabase
    .from('fresh_scrape_screenshots')
    .select('template_name, template_slug, screenshot_thumbnail_path, captured_at')
    .eq('fresh_scrape_id', stateId)
    .order('captured_at', { ascending: false })
    .limit(1)
    .single();

  if (!row) return null;
  return {
    ...row,
    screenshot_path: row.template_slug ? `/screenshots/${row.template_slug}.webp` : null
  };
}

interface SitemapEntry {
  url: string;
  slug: string;
  lastmod: string | null;
  lastmodMs: number | null;
}

function parseSitemapEntries(xml: string): SitemapEntry[] {
  const entries: SitemapEntry[] = [];
  const urlBlockRegex = /<url>([\s\S]*?)<\/url>/g;
  const locRegex = /<loc>([^<]+)<\/loc>/;
  const lastmodRegex = /<lastmod>([^<]+)<\/lastmod>/;

  let match: RegExpExecArray | null;
  while ((match = urlBlockRegex.exec(xml)) !== null) {
    const block = match[1] || '';
    const locMatch = locRegex.exec(block);
    if (!locMatch) continue;
    const url = locMatch[1].trim();
    if (!url.startsWith('https://templates.webflow.com/html/')) continue;
    const slug = url.split('/').filter(Boolean).pop() || '';
    if (!slug) continue;

    const lastmodMatch = lastmodRegex.exec(block);
    const lastmod = lastmodMatch ? lastmodMatch[1].trim() : null;
    const lastmodMs = lastmod ? Date.parse(lastmod) : null;

    entries.push({ url, slug, lastmod, lastmodMs: Number.isFinite(lastmodMs) ? lastmodMs : null });
  }

  return entries;
}

async function fetchSitemapEntries(): Promise<SitemapEntry[]> {
  const sitemapUrl = 'https://templates.webflow.com/sitemap.xml';
  const response = await axios.get(sitemapUrl, { timeout: 30000 });
  const xml = response.data as string;
  return parseSitemapEntries(xml);
}

async function fetchAllTemplateScrapeIndex(): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('templates')
      .select('slug, scraped_at')
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const slug = row.slug as string | null;
      const scrapedAt = row.scraped_at as string | null;
      if (!slug || !scrapedAt) continue;
      const ms = Date.parse(scrapedAt);
      if (Number.isFinite(ms)) out.set(slug, ms);
    }
    if (data.length < pageSize) break;
  }
  return out;
}

async function computeIncrementalScrapePlan(options?: { includeUpdates?: boolean; thresholdMs?: number }) {
  const includeUpdates = options?.includeUpdates !== false;
  const thresholdMs = options?.thresholdMs ?? 60_000; // ignore tiny timestamp drift

  const sitemap = await fetchSitemapEntries();
  const scrapeIndex = await fetchAllTemplateScrapeIndex();

  const urlsToScrape: string[] = [];
  let missingCount = 0;
  let updatedCount = 0;

  const samples: Array<{ url: string; slug: string; reason: 'missing' | 'updated'; lastmod: string | null }> = [];

  for (const entry of sitemap) {
    const scrapedAtMs = scrapeIndex.get(entry.slug) ?? null;
    if (!scrapedAtMs) {
      urlsToScrape.push(entry.url);
      missingCount++;
      if (samples.length < 200) samples.push({ url: entry.url, slug: entry.slug, reason: 'missing', lastmod: entry.lastmod });
      continue;
    }
    if (!includeUpdates) continue;

    if (entry.lastmodMs && entry.lastmodMs - scrapedAtMs > thresholdMs) {
      urlsToScrape.push(entry.url);
      updatedCount++;
      if (samples.length < 200) samples.push({ url: entry.url, slug: entry.slug, reason: 'updated', lastmod: entry.lastmod });
    }
  }

  return {
    totalInSitemap: sitemap.length,
    existingInDb: scrapeIndex.size,
    missingCount,
    updatedCount,
    toScrapeCount: urlsToScrape.length,
    urlsToScrape,
    samples,
  };
}

async function fetchAllStorefrontUrlsFromDatabase(): Promise<string[]> {
  const urls: string[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('templates')
      .select('storefront_url')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    for (const row of data) {
      const url = (row.storefront_url as string | null) || null;
      if (url) urls.push(url);
    }
    if (data.length < pageSize) break;
  }
  return urls;
}

// Helper to delete all template data
// Note: Screenshots in R2 are NOT deleted - they can be orphaned and cleaned up separately if needed
async function deleteAllData(): Promise<{ templatesDeleted: number }> {
  let templatesDeleted = 0;

  // Count templates before deletion
  const { count } = await supabase
    .from('templates')
    .select('*', { count: 'exact', head: true });
  templatesDeleted = count || 0;

  // Clear visitor's template references first (foreign key to templates)
  await supabase
    .from('visitors')
    .update({ selected_template_id: null })
    .not('selected_template_id', 'is', null);

  // Clear purchases template references (but keep purchase records)
  await supabase
    .from('purchases')
    .delete()
    .not('template_id', 'is', null);

  // Delete preview_metrics (has FK to templates)
  await supabase.from('preview_metrics').delete().neq('id', 0);

  // Delete thumbnail_jobs (has FK to templates)
  await supabase.from('thumbnail_jobs').delete().neq('id', 0);

  // Delete ultra_featured_templates (has FK to templates)
  await supabase.from('ultra_featured_templates').delete().neq('id', 0);

  // Delete junction tables (have FK to templates)
  await supabase.from('template_features').delete().neq('template_id', 0);
  await supabase.from('template_styles').delete().neq('template_id', 0);
  await supabase.from('template_subcategories').delete().neq('template_id', 0);

  // Now delete templates
  await supabase.from('templates').delete().neq('id', 0);

  // Clean up orphaned metadata
  await supabase.from('features').delete().neq('id', 0);
  await supabase.from('styles').delete().neq('id', 0);
  await supabase.from('subcategories').delete().neq('id', 0);

  // Reset batch scraping tables (respect FK order: children first)
  await supabase.from('batch_templates').delete().neq('id', 0);
  await supabase.from('session_resume_points').delete().neq('id', 0);
  await supabase.from('scrape_batches').delete().neq('id', 0);
  await supabase.from('scrape_sessions').delete().neq('id', 0);

  // Reset legacy scrape jobs (respect FK order)
  await supabase.from('scrape_logs').delete().neq('id', 0);
  await supabase.from('scrape_jobs').delete().neq('id', 0);

  // Clear old fresh scrape screenshots (but keep current state)
  const { data: activeStates } = await supabase
    .from('fresh_scrape_state')
    .select('id')
    .in('status', ['deleting', 'scraping_featured', 'scraping_regular', 'paused']);

  const activeIds = activeStates?.map(s => s.id) || [];

  if (activeIds.length > 0) {
    await supabase
      .from('fresh_scrape_screenshots')
      .delete()
      .not('fresh_scrape_id', 'in', `(${activeIds.join(',')})`);
  } else {
    await supabase.from('fresh_scrape_screenshots').delete().neq('id', 0);
  }

  return { templatesDeleted };
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
      case 'start_fresh': {
        const existing = await getActiveFreshScrape();
        if (existing) {
          return NextResponse.json({ error: 'A scrape is already in progress', state: existing }, { status: 400 });
        }

        const confirm = typeof body.confirm === 'string' ? body.confirm : '';
        if (confirm !== 'DELETE_ALL') {
          return NextResponse.json(
            { error: 'Confirmation required. Send { action: \"start_fresh\", confirm: \"DELETE_ALL\" } to proceed.' },
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
          jobMode: 'full',
        };
        const freshConfig: FreshScrapeConfig = {
          ...baseConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        const deletion = await deleteAllData();
        const sitemapEntries = await fetchSitemapEntries();
        const urlsToScrape = sitemapEntries.map(e => e.url);

        const { data: state, error: insertError } = await supabase
          .from('fresh_scrape_state')
          .insert({
            status: 'scraping_regular',
            phase: 'regular_scrape',
            total_sitemap_count: urlsToScrape.length,
            regular_template_urls: JSON.stringify(urlsToScrape),
            regular_total: urlsToScrape.length,
            config: JSON.stringify(freshConfig),
            started_at: new Date().toISOString(),
            deletion_completed_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) throw insertError;

        return NextResponse.json({
          message: 'Fresh scrape initialized (database + images wiped)',
          deletion,
          state
        });
      }

      case 'start_rescreenshot_all': {
        const existing = await getActiveFreshScrape();
        if (existing) {
          return NextResponse.json(
            { error: 'A scrape is already in progress', state: existing },
            { status: 400 }
          );
        }

        // Note: wipeImages option removed - screenshots are stored in R2 and will be overwritten during re-scrape

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
          jobMode: 'screenshots_only',
        };
        const rescreenshotConfig: FreshScrapeConfig = {
          ...baseConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        const urlsToScrape = await fetchAllStorefrontUrlsFromDatabase();

        const { data: state, error: insertError } = await supabase
          .from('fresh_scrape_state')
          .insert({
            status: 'scraping_regular',
            phase: 'regular_scrape',
            total_sitemap_count: urlsToScrape.length,
            regular_template_urls: JSON.stringify(urlsToScrape),
            regular_total: urlsToScrape.length,
            config: JSON.stringify(rescreenshotConfig),
            started_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (insertError) throw insertError;

        return NextResponse.json({
          message: 'Rescreenshot-all initialized',
          state
        });
      }

      case 'start': {
        // Backward compatible: "start" now runs an incremental update scrape (no destructive deletes).
        const existing = await getActiveFreshScrape();
        if (existing) {
          return NextResponse.json({ error: 'A scrape is already in progress', state: existing }, { status: 400 });
        }

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
          jobMode: 'full',
        };
        const defaultConfig: FreshScrapeConfig = {
          ...baseConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        const plan = await computeIncrementalScrapePlan({ includeUpdates: true });
        if (plan.urlsToScrape.length === 0) {
          return NextResponse.json({ error: 'No missing/updated templates to scrape' }, { status: 400 });
        }

        // Create fresh scrape state
        const { data: state, error: insertError } = await supabase
          .from('fresh_scrape_state')
          .insert({
            status: 'scraping_regular',
            phase: 'regular_scrape',
            total_sitemap_count: plan.totalInSitemap,
            regular_template_urls: JSON.stringify(plan.urlsToScrape),
            regular_total: plan.urlsToScrape.length,
            config: JSON.stringify(defaultConfig),
            started_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertError) throw insertError;

        return NextResponse.json({
          message: 'Incremental scrape started',
          state,
          discovery: plan
        });
      }

      case 'confirm_delete': {
        return NextResponse.json(
          { error: 'Full delete has been disabled. Use incremental update scraping instead.' },
          { status: 400 }
        );
      }

      case 'discover': {
        return NextResponse.json(
          { error: 'Discovery phase is no longer used. Use incremental update scraping instead.' },
          { status: 400 }
        );
      }

      case 'check_new': {
        const active = await getActiveFreshScrape();
        if (active) {
          return NextResponse.json(
            { error: 'A scrape is already in progress', state: active },
            { status: 400 }
          );
        }

        const plan = await computeIncrementalScrapePlan({ includeUpdates: true });

        const templates = plan.samples.map((t) => {
          const displayName = t.slug
            .split('-')
            .map(part => (part ? (part[0].toUpperCase() + part.slice(1)) : part))
            .join(' ');
          return { ...t, displayName };
        });

        return NextResponse.json({
          discovery: {
            totalInSitemap: plan.totalInSitemap,
            existingInDb: plan.existingInDb,
            missingCount: plan.missingCount,
            updatedCount: plan.updatedCount,
            toScrapeCount: plan.toScrapeCount,
            templates
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

        const includeUpdates = body.includeUpdates !== false;
        let urlsToScrape: string[] = [];
        if (urls && Array.isArray(urls) && urls.length > 0) {
          urlsToScrape = urls;
        } else {
          const plan = await computeIncrementalScrapePlan({ includeUpdates });
          urlsToScrape = plan.urlsToScrape;
        }

        if (urlsToScrape.length === 0) {
          return NextResponse.json(
            { error: 'No missing/updated templates to scrape' },
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
          jobMode: 'full',
        };
        const updateConfig: FreshScrapeConfig = {
          ...baseConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        const sitemapCount = typeof body.totalSitemapCount === 'number'
          ? body.totalSitemapCount
          : (await fetchSitemapEntries()).length;

        const { data: state, error: insertError } = await supabase
          .from('fresh_scrape_state')
          .insert({
            status: 'scraping_regular',
            phase: 'regular_scrape',
            total_sitemap_count: sitemapCount,
            regular_template_urls: JSON.stringify(urlsToScrape),
            regular_total: urlsToScrape.length,
            config: JSON.stringify(updateConfig),
            started_at: new Date().toISOString()
          })
          .select()
          .single();

        if (insertError) throw insertError;

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
            jobMode: 'full',
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
            jobMode: 'full',
          };

        const newConfig: FreshScrapeConfig = {
          ...currentConfig,
          ...(config ? (clampFreshScraperConfig(config) as Partial<FreshScrapeConfig>) : {})
        };

        await supabase
          .from('fresh_scrape_state')
          .update({
            config: JSON.stringify(newConfig),
            updated_at: new Date().toISOString()
          })
          .eq('id', state.id);

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

        await supabase
          .from('fresh_scrape_state')
          .update({
            status: 'paused',
            paused_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', state.id);

        return NextResponse.json({ message: 'Scrape paused' });
      }

      case 'resume': {
        const { data: state } = await supabase
          .from('fresh_scrape_state')
          .select('*')
          .eq('status', 'paused')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

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

        const { data: updatedState } = await supabase
          .from('fresh_scrape_state')
          .update({
            status: newStatus,
            resumed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', state.id)
          .select()
          .single();

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

        await supabase
          .from('fresh_scrape_state')
          .update({
            status: 'failed',
            last_error: 'Cancelled by user',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', state.id);

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

        const { data: state } = await supabase
          .from('fresh_scrape_state')
          .select('*')
          .eq('id', stateId)
          .single();

        if (!state) {
          return NextResponse.json({ error: 'State not found' }, { status: 404 });
        }

        const updateData: Record<string, unknown> = {
          updated_at: new Date().toISOString()
        };

        if (isFeatured) {
          if (processed !== undefined) {
            updateData.featured_processed = processed;
          }
          if (successful !== undefined) {
            updateData.featured_successful = successful;
          }
          if (failed !== undefined) {
            updateData.featured_failed = failed;
          }
        } else {
          if (processed !== undefined) {
            updateData.regular_processed = processed;
          }
          if (successful !== undefined) {
            updateData.regular_successful = successful;
          }
          if (failed !== undefined) {
            updateData.regular_failed = failed;
          }
        }

        if (batchIndex !== undefined) {
          updateData.current_batch_index = batchIndex;
        }

        if (currentBatchUrls !== undefined) {
          updateData.current_batch_urls = JSON.stringify(currentBatchUrls);
        }

        await supabase
          .from('fresh_scrape_state')
          .update(updateData)
          .eq('id', stateId);

        return NextResponse.json({ message: 'Progress updated' });
      }

      case 'complete_featured': {
        // Mark featured scraping as complete, move to regular
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }

        await supabase
          .from('fresh_scrape_state')
          .update({
            phase: 'regular_scrape',
            status: 'scraping_regular',
            featured_completed_at: new Date().toISOString(),
            current_batch_index: 0,
            updated_at: new Date().toISOString()
          })
          .eq('id', stateId);

        return NextResponse.json({ message: 'Featured scraping complete' });
      }

      case 'complete': {
        // Mark entire scrape as complete
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }

        await supabase
          .from('fresh_scrape_state')
          .update({
            status: 'completed',
            phase: 'completed',
            completed_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', stateId);

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
        const screenshotPath =
          typeof body.screenshotPath === 'string'
            ? body.screenshotPath
            : (typeof body.thumbnailPath === 'string' ? body.thumbnailPath : null);
        const isFeaturedAuthor = body.isFeaturedAuthor === true;

        await supabase
          .from('fresh_scrape_screenshots')
          .insert({
            fresh_scrape_id: stateId,
            template_name: templateName,
            template_slug: templateSlug,
            screenshot_thumbnail_path: screenshotPath,
            is_featured_author: isFeaturedAuthor
          });

        return NextResponse.json({ message: 'Screenshot added' });
      }

      case 'record_error': {
        // Record an error
        const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
        if (!Number.isFinite(stateId)) {
          return NextResponse.json({ error: 'stateId required' }, { status: 400 });
        }
        const errorMsg = typeof body.error === 'string' ? body.error : 'Unknown error';

        // First get current error_count
        const { data: currentState } = await supabase
          .from('fresh_scrape_state')
          .select('error_count')
          .eq('id', stateId)
          .single();

        await supabase
          .from('fresh_scrape_state')
          .update({
            last_error: errorMsg,
            error_count: (currentState?.error_count || 0) + 1,
            updated_at: new Date().toISOString()
          })
          .eq('id', stateId);

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
      case 'preflight': {
        const result = await runScraperPreflight();
        return NextResponse.json(result);
      }

      case 'status': {
        // Get current state
        const active = await getActiveFreshScrape();
        const latest = await getLatestFreshScrape();

        // Check if there's a paused scrape that can be resumed
        const { data: paused } = await supabase
          .from('fresh_scrape_state')
          .select('*')
          .eq('status', 'paused')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

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

        const { data: state } = await supabase
          .from('fresh_scrape_state')
          .select('*')
          .eq('id', stateId)
          .single();

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

        const { data: screenshots } = await supabase
          .from('fresh_scrape_screenshots')
          .select('*')
          .eq('fresh_scrape_id', stateId)
          .order('captured_at', { ascending: false })
          .range(offset, offset + limit - 1);

        const screenshotsWithPaths = (screenshots || []).map(s => ({
          ...s,
          screenshot_path: s.template_slug ? `/screenshots/${s.template_slug}.webp` : null
        }));

        const { count: totalCount } = await supabase
          .from('fresh_scrape_screenshots')
          .select('*', { count: 'exact', head: true })
          .eq('fresh_scrape_id', stateId);

        return NextResponse.json({
          screenshots: screenshotsWithPaths,
          total: totalCount || 0,
          hasMore: (totalCount || 0) > offset + limit
        });
      }

      case 'featured_authors': {
        const { data: authors } = await supabase
          .from('featured_authors')
          .select('author_id, author_name')
          .eq('is_active', true);

        return NextResponse.json({ authors: authors || [] });
      }

      default:
        // Default: return status
        const active = await getActiveFreshScrape();
        const { data: paused } = await supabase
          .from('fresh_scrape_state')
          .select('*')
          .eq('status', 'paused')
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

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
