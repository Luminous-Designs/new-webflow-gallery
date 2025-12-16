import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { FreshScraper, FreshScraperConfig, ScrapeState, clampFreshScraperConfig } from '@/lib/scraper/fresh-scraper';

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

// Store the active scraper instance
let activeScraper: FreshScraper | null = null;
let currentStateId: number | null = null;

// Real-time state for UI feedback
interface ScraperRealTimeState {
  activeBrowsers: number;
  totalPagesInUse: number;
  maxPagesCapacity: number;
  configuredConcurrency: number;
  configuredBrowserInstances: number;
  configuredPagesPerBrowser: number;
  configuredBatchSize: number;
  configuredTimeout: number;
  pendingBrowserRestart: boolean;
  isPaused: boolean;
  isStopped: boolean;
  isTimeoutPaused: boolean;
  currentBatchSize: number;
  timeoutCount: number;
  consecutiveTimeouts: number;
  pausedUrlCount: number;
  semaphoreAvailable: number;
  semaphoreWaiting: number;
}

// Real-time events storage for polling
interface ScraperEvents {
  logs: Array<{ timestamp: string; level: string; message: string }>;
  currentBatch: Array<{
    url: string;
    slug: string;
    name: string | null;
    phase: string;
    elapsed: number;
  }>;
  recentScreenshots: Array<{
    name: string;
    slug: string;
    thumbnailPath: string;
    isFeaturedAuthor: boolean;
    timestamp: string;
  }>;
  progress: {
    processed: number;
    successful: number;
    failed: number;
    total: number;
  };
  realTimeState: ScraperRealTimeState | null;
  scrapeState: ScrapeState | null;
}

const scraperEvents: ScraperEvents = {
  logs: [],
  currentBatch: [],
  recentScreenshots: [],
  progress: { processed: 0, successful: 0, failed: 0, total: 0 },
  realTimeState: null,
  scrapeState: null
};

function addLog(level: string, message: string) {
  scraperEvents.logs.unshift({
    timestamp: new Date().toISOString(),
    level,
    message
  });
  // Keep only last 200 logs
  if (scraperEvents.logs.length > 200) {
    scraperEvents.logs = scraperEvents.logs.slice(0, 200);
  }
}

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
    const stateId = typeof body.stateId === 'number' ? body.stateId : Number(body.stateId);
    const batchUrls = Array.isArray(body.batchUrls) ? (body.batchUrls as unknown[]).filter((u): u is string => typeof u === 'string') : undefined;
    const isFeatured = typeof body.isFeatured === 'boolean' ? body.isFeatured : false;
    const config = body.config as Partial<FreshScraperConfig> | undefined;

    switch (action) {
      case 'start_batch': {
        if (!Number.isFinite(stateId) || !batchUrls) {
          return NextResponse.json({ error: 'stateId and batchUrls required' }, { status: 400 });
        }

        // Check if already running
        if (activeScraper) {
          return NextResponse.json({ error: 'Scraper already running' }, { status: 400 });
        }

        // Get state config
        const state = await db.getAsync<{ config: string }>(
          'SELECT config FROM fresh_scrape_state WHERE id = ?',
          [stateId]
        );

	        const baseDefaults: FreshScraperConfig = {
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

	        const persistedConfig = safeJsonParse(state?.config, {});
	        const rawConfig = {
	          ...persistedConfig,
	          ...(config || {})
	        };
	        const scraperConfig: FreshScraperConfig = {
	          ...baseDefaults,
	          ...(clampFreshScraperConfig(rawConfig) as Partial<FreshScraperConfig>)
	        };

        // Reset events
        scraperEvents.logs = [];
        scraperEvents.currentBatch = [];
        scraperEvents.recentScreenshots = [];
        scraperEvents.progress = { processed: 0, successful: 0, failed: 0, total: batchUrls.length };
        scraperEvents.realTimeState = null;

        // Create scraper
        activeScraper = new FreshScraper(scraperConfig);
        currentStateId = stateId;

        // Setup event handlers
        activeScraper.on('log', (data) => {
          addLog(data.level, data.message);
        });

        activeScraper.on('template-phase', (data) => {
          const idx = scraperEvents.currentBatch.findIndex(t => t.url === data.url);
          if (idx >= 0) {
            scraperEvents.currentBatch[idx].phase = data.phase;
            scraperEvents.currentBatch[idx].elapsed = data.elapsed;
          }
        });

	        activeScraper.on('template-complete', (data) => {
	          const idx = scraperEvents.currentBatch.findIndex(t => t.url === data.url);
	          if (idx >= 0) {
	            scraperEvents.currentBatch[idx].phase = data.success ? 'completed' : 'failed';
	            scraperEvents.currentBatch[idx].name = data.name;
	          }
	          const prev = scraperEvents.progress || { processed: 0, successful: 0, failed: 0, total: batchUrls.length };
	          const processed = Math.min(prev.total, (prev.processed || 0) + 1);
	          const successful = (prev.successful || 0) + (data.success ? 1 : 0);
	          const failed = (prev.failed || 0) + (data.success ? 0 : 1);
	          scraperEvents.progress = { ...prev, processed, successful, failed };
	        });

        activeScraper.on('screenshot-captured', async (data) => {
          scraperEvents.recentScreenshots.unshift({
            ...data,
            timestamp: new Date().toISOString()
          });
          // Keep only last 100 screenshots
          if (scraperEvents.recentScreenshots.length > 100) {
            scraperEvents.recentScreenshots = scraperEvents.recentScreenshots.slice(0, 100);
          }

          // Store in database
          try {
            await db.runAsync(
              `INSERT INTO fresh_scrape_screenshots
                (fresh_scrape_id, template_name, template_slug, screenshot_thumbnail_path, is_featured_author)
              VALUES (?, ?, ?, ?, ?)`,
              [stateId, data.name, data.slug, data.thumbnailPath, data.isFeaturedAuthor ? 1 : 0]
            );
          } catch {
            // Ignore
          }
        });

        activeScraper.on('progress', (data) => {
          scraperEvents.progress = data;
        });

        activeScraper.on('realtime-state', (data) => {
          scraperEvents.realTimeState = data;
        });

        activeScraper.on('batch-start', (data) => {
          scraperEvents.currentBatch = data.urls.map((url: string) => ({
            url,
            slug: url.split('/').pop() || '',
            name: null,
            phase: 'pending',
            elapsed: 0
          }));
          addLog('info', `Batch started with ${data.urls.length} templates`);
        });

        activeScraper.on('error', (data) => {
          addLog('error', `${data.message}${data.url ? ` - ${data.url}` : ''}`);
        });

        activeScraper.on('state-change', (data) => {
          scraperEvents.scrapeState = data;
        });

        activeScraper.on('timeout-paused', (data) => {
          addLog('warn', `Auto-paused due to timeouts: ${data.consecutiveTimeouts} consecutive, ${data.timeoutCount} total`);
        });

        // Initialize and run
        await activeScraper.init();
        await activeScraper.initBrowserPool();

        addLog('info', `Starting batch scrape of ${batchUrls.length} templates`);

        // Run scrape (async)
        (async () => {
          try {
            const result = await activeScraper!.scrapeBatch(batchUrls);

            // Update state progress
            await db.runAsync(
              `UPDATE fresh_scrape_state SET
                ${isFeatured ? 'featured_processed = featured_processed + ?' : 'regular_processed = regular_processed + ?'},
                ${isFeatured ? 'featured_successful = featured_successful + ?' : 'regular_successful = regular_successful + ?'},
                ${isFeatured ? 'featured_failed = featured_failed + ?' : 'regular_failed = regular_failed + ?'},
                updated_at = datetime('now')
              WHERE id = ?`,
              [result.processed, result.successful, result.failed, stateId]
            );

            addLog('info', `Batch complete: ${result.successful} successful, ${result.failed} failed`);
          } catch (error) {
            addLog('error', `Batch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
          } finally {
            if (activeScraper) {
              await activeScraper.close();
              activeScraper = null;
            }
          }
        })();

        return NextResponse.json({
          message: 'Batch started',
          batchSize: batchUrls.length,
          config: scraperConfig
        });
      }

      case 'update_config': {
        if (activeScraper && config) {
          activeScraper.updateConfig(config);
          addLog('info', `Config updated: ${JSON.stringify(config)}`);
          return NextResponse.json({ message: 'Config updated' });
        }
        return NextResponse.json({ error: 'No active scraper or config missing' }, { status: 400 });
      }

      case 'pause': {
        if (activeScraper) {
          activeScraper.pause();
          addLog('info', 'Scraper paused');
          return NextResponse.json({ message: 'Paused' });
        }
        return NextResponse.json({ error: 'No active scraper' }, { status: 400 });
      }

      case 'resume': {
        if (activeScraper) {
          activeScraper.resume();
          addLog('info', 'Scraper resumed');
          return NextResponse.json({ message: 'Resumed' });
        }
        return NextResponse.json({ error: 'No active scraper' }, { status: 400 });
      }

      case 'resume_timeout': {
        if (activeScraper) {
          activeScraper.resumeTimeoutPaused();
          addLog('info', 'Scraper resumed from timeout pause');
          return NextResponse.json({ message: 'Resumed from timeout pause' });
        }
        return NextResponse.json({ error: 'No active scraper' }, { status: 400 });
      }

      case 'clear_state': {
        if (activeScraper) {
          await activeScraper.clearState();
          addLog('info', 'Scrape state cleared');
          return NextResponse.json({ message: 'State cleared' });
        }
        return NextResponse.json({ error: 'No active scraper' }, { status: 400 });
      }

      case 'stop': {
        if (activeScraper) {
          activeScraper.stop();
          await activeScraper.close();
          activeScraper = null;
          addLog('info', 'Scraper stopped');
          return NextResponse.json({ message: 'Stopped' });
        }
        return NextResponse.json({ error: 'No active scraper' }, { status: 400 });
      }

      default:
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Fresh scrape execute error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}

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
        return NextResponse.json({
          isRunning: !!activeScraper,
          stateId: currentStateId,
          isPaused: activeScraper ? false : undefined // Could add isPaused property to scraper
        });
      }

      case 'events': {
        // Return real-time events including actual scraper state
        const realState = activeScraper?.getRealTimeState() || scraperEvents.realTimeState;
        const scrapeState = activeScraper?.getScrapeState() || scraperEvents.scrapeState;
        return NextResponse.json({
          isRunning: !!activeScraper,
          logs: scraperEvents.logs.slice(0, 50),
          currentBatch: activeScraper?.getCurrentBatch() || scraperEvents.currentBatch,
          recentScreenshots: scraperEvents.recentScreenshots.slice(0, 30),
          progress: scraperEvents.progress,
          realTimeState: realState,
          scrapeState: scrapeState
        });
      }

      default:
        return NextResponse.json({
          isRunning: !!activeScraper,
          stateId: currentStateId
        });
    }
  } catch (error) {
    console.error('Fresh scrape execute GET error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Internal server error' },
      { status: 500 }
    );
  }
}
