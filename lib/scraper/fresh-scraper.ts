import { EventEmitter } from 'events';
import { chromium, Browser, BrowserContext, Page, Route } from 'playwright';
import sharp from 'sharp';
import os from 'os';
import path from 'path';
import { promises as fs } from 'fs';
import { db, runAlternateHomepageMigration } from '@/lib/db';
import { preparePageForScreenshot } from '@/lib/screenshot/prepare';
import { detectHomepage } from './homepage-detector';

// Configure Sharp globally for memory efficiency.
// Concurrency is set dynamically per scraper instance to match CPU/core capacity.
sharp.cache(false);

// Screenshot constraints to prevent processing massive images
const MAX_SCREENSHOT_HEIGHT = 5000; // Limit screenshots to 5000px tall
const MAX_SCREENSHOT_WIDTH = 1600;

// Types
export interface FreshScraperConfig {
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
  timeout: number;
  // Screenshot timing / stability controls
  screenshotAnimationWaitMs: number;
  screenshotNudgeScrollRatio: number;
  screenshotNudgeWaitMs: number;
  screenshotNudgeAfterMs: number;
  screenshotStabilityStableMs: number;
  screenshotStabilityMaxWaitMs: number;
  screenshotStabilityCheckIntervalMs: number;
  // Screenshot quality controls
  screenshotJpegQuality: number;
  screenshotWebpQuality: number;
  thumbnailWebpQuality: number;
}

export interface TemplatePhase {
  url: string;
  slug: string;
  name: string | null;
  phase: 'pending' | 'loading' | 'scraping_details' | 'taking_screenshot' | 'processing_thumbnail' | 'saving' | 'completed' | 'failed' | 'timeout_paused';
  startTime: number;
  error?: string;
}

export interface BatchProgress {
  batchIndex: number;
  batchSize: number;
  processed: number;
  successful: number;
  failed: number;
  templates: TemplatePhase[];
}

export interface ScrapeState {
  status: 'idle' | 'running' | 'paused' | 'timeout_paused' | 'stopped' | 'completed';
  totalUrls: number;
  processedUrls: number;
  successfulUrls: number;
  failedUrls: number;
  timeoutCount: number;
  consecutiveTimeouts: number;
  pausedUrls: string[]; // URLs that timed out and are paused
  remainingUrls: string[]; // URLs not yet processed
  startedAt: string | null;
  pausedAt: string | null;
}

// Events
export interface FreshScraperEvents {
  'log': (data: { level: string; message: string }) => void;
  'template-phase': (data: { url: string; phase: string; elapsed: number }) => void;
  'template-complete': (data: { url: string; name: string; slug: string; success: boolean; thumbnailPath?: string }) => void;
  'batch-start': (data: { batchIndex: number; batchSize: number; urls: string[] }) => void;
  'batch-complete': (data: { batchIndex: number; processed: number; successful: number; failed: number }) => void;
  'phase-change': (data: { phase: string; message: string }) => void;
  'progress': (data: { processed: number; successful: number; failed: number; total: number }) => void;
  'screenshot-captured': (data: { name: string; slug: string; thumbnailPath: string; isFeaturedAuthor: boolean }) => void;
  'error': (data: { message: string; url?: string }) => void;
  'complete': () => void;
  'paused': () => void;
  'timeout-paused': (data: { timeoutCount: number; consecutiveTimeouts: number }) => void;
  'state-change': (data: ScrapeState) => void;
}

// Browser pool item
interface BrowserPoolItem {
  browser: Browser;
  context: BrowserContext;
  pagesInUse: number;
  maxPages: number;
  usageCount: number;
}

interface BrowserScrapeSuccess {
  success: true;
  slug: string;
  data: {
    name: string;
    authorId: string | null;
    authorName: string | null;
    authorAvatar: string | null;
    livePreviewUrl: string;
    designerPreviewUrl: string;
    price: string;
    shortDescription: string;
    longDescription: string;
    subcategories: string[];
    styles: string[];
    features: string[];
    isCms: boolean;
    isEcommerce: boolean;
  };
  isFeaturedAuthor: boolean;
  screenshotBuffer: Buffer | null;
  screenshotUrl: string | null;
  isAlternateHomepage: boolean;
  alternateHomepagePath: string | null;
}

interface BrowserScrapeFailure {
  success: false;
  slug: string;
  error: string;
  isTimeout: boolean;
}

type BrowserScrapeResult = BrowserScrapeSuccess | BrowserScrapeFailure;

// Simple semaphore for concurrency control
class Semaphore {
  private permits: number;
  private waiting: (() => void)[] = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next?.();
    } else {
      this.permits++;
    }
  }

  setPermits(newPermits: number): void {
    const diff = newPermits - this.permits - this.waiting.length;
    if (diff > 0) {
      this.permits += diff;
      // Wake up waiting tasks
      while (this.permits > 0 && this.waiting.length > 0) {
        this.permits--;
        const next = this.waiting.shift();
        next?.();
      }
    }
    // If diff < 0, we just let permits naturally decrease as tasks complete
  }

  getAvailable(): number {
    return this.permits;
  }

  getWaiting(): number {
    return this.waiting.length;
  }
}

// Auto-pause settings
const CONSECUTIVE_TIMEOUT_THRESHOLD = 5; // Pause if 5 consecutive timeouts
const TIMEOUT_RATIO_THRESHOLD = 0.8; // Pause if 80% of recent operations are timeouts
const RECENT_OPERATIONS_WINDOW = 10; // Look at last 10 operations for ratio

export class FreshScraper extends EventEmitter {
  private config: FreshScraperConfig;
  private browserPool: BrowserPoolItem[] = [];
  private isPaused: boolean = false;
  private isStopped: boolean = false;
  private isTimeoutPaused: boolean = false;
  private featuredAuthorIds: Set<string> = new Set();
  private currentBatch: TemplatePhase[] = [];
  private pendingBrowserRecreation: boolean = false;
  private semaphore: Semaphore;
  private imageSemaphore: Semaphore;

  // Cached screenshot exclusions to avoid per-template DB queries
  private screenshotExclusionSelectors: string[] = [];
  private screenshotExclusionsFetchedAt: number = 0;
  private screenshotExclusionsTtlMs: number = 60_000;

  // Timeout tracking
  private timeoutCount: number = 0;
  private consecutiveTimeouts: number = 0;
  private recentOperations: boolean[] = []; // true = success, false = timeout (circular buffer)
  private recentOperationsIndex: number = 0; // Circular buffer index
  private pausedUrls: Set<string> = new Set(); // Use Set for O(1) operations
  private remainingUrls: Set<string> = new Set(); // Use Set for O(1) operations
  private scrapeState: ScrapeState;

  // Event-based pause/resume (replaces polling loops)
  private resumePromise: Promise<void> | null = null;
  private resumeResolve: (() => void) | null = null;

  // State persistence debouncing
  private stateSaveTimeout: NodeJS.Timeout | null = null;
  private stateSaveDebounceMs: number = 5000; // Only save every 5 seconds max

  // Event-based page availability (replaces polling for pages)
  private pageWaiters: (() => void)[] = [];

  constructor(config: Partial<FreshScraperConfig> = {}) {
    super();
    this.config = {
      concurrency: config.concurrency || 5,
      browserInstances: config.browserInstances || 2,
      pagesPerBrowser: config.pagesPerBrowser || 5,
      batchSize: config.batchSize || 50,
      timeout: config.timeout || 60000,

      // Screenshot defaults tuned for reliable animation settling
      screenshotAnimationWaitMs: config.screenshotAnimationWaitMs ?? 3000,
      screenshotNudgeScrollRatio: config.screenshotNudgeScrollRatio ?? 0.2,
      screenshotNudgeWaitMs: config.screenshotNudgeWaitMs ?? 500,
      screenshotNudgeAfterMs: config.screenshotNudgeAfterMs ?? 500,
      screenshotStabilityStableMs: config.screenshotStabilityStableMs ?? 1000,
      screenshotStabilityMaxWaitMs: config.screenshotStabilityMaxWaitMs ?? 7000,
      screenshotStabilityCheckIntervalMs: config.screenshotStabilityCheckIntervalMs ?? 250,

      // Screenshot quality defaults
      screenshotJpegQuality: config.screenshotJpegQuality ?? 80,
      screenshotWebpQuality: config.screenshotWebpQuality ?? 75,
      thumbnailWebpQuality: config.thumbnailWebpQuality ?? 60
    };
    this.semaphore = new Semaphore(this.config.concurrency);
    this.imageSemaphore = new Semaphore(this.getDesiredImageConcurrency());
    this.updateSharpConcurrency();
    this.scrapeState = this.getDefaultState();
  }

  private getDefaultState(): ScrapeState {
    return {
      status: 'idle',
      totalUrls: 0,
      processedUrls: 0,
      successfulUrls: 0,
      failedUrls: 0,
      timeoutCount: 0,
      consecutiveTimeouts: 0,
      pausedUrls: [],
      remainingUrls: [],
      startedAt: null,
      pausedAt: null,
    };
  }

  async init(restoreState: boolean = false): Promise<void> {
    // Ensure directories exist
    const screenshotDir = path.join(process.cwd(), 'public', 'screenshots');
    const thumbnailDir = path.join(process.cwd(), 'public', 'thumbnails');

    await fs.mkdir(screenshotDir, { recursive: true });
    await fs.mkdir(thumbnailDir, { recursive: true });

    // Run database migration for alternate homepage columns
    await runAlternateHomepageMigration();

    // Run migration for scrape state table
    await this.runScrapeStateMigration();

    // Load featured author IDs
    const authors = await db.allAsync<{ author_id: string }>(
      'SELECT author_id FROM featured_authors WHERE is_active = 1'
    );
    this.featuredAuthorIds = new Set(authors.map(a => a.author_id));

    // Only restore state if explicitly requested (e.g., for resuming after app restart)
    if (restoreState) {
      await this.loadStateFromDb();
    } else {
      // Start fresh - clear any old state
      this.pausedUrls = new Set();
      this.remainingUrls = new Set();
      this.timeoutCount = 0;
      this.consecutiveTimeouts = 0;
    }

    this.log('info', `Initialized with ${this.featuredAuthorIds.size} featured authors`);
  }

  private async runScrapeStateMigration(): Promise<void> {
    try {
      await db.runAsync(`
        CREATE TABLE IF NOT EXISTS scrape_state (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          status TEXT NOT NULL DEFAULT 'idle',
          total_urls INTEGER NOT NULL DEFAULT 0,
          processed_urls INTEGER NOT NULL DEFAULT 0,
          successful_urls INTEGER NOT NULL DEFAULT 0,
          failed_urls INTEGER NOT NULL DEFAULT 0,
          timeout_count INTEGER NOT NULL DEFAULT 0,
          consecutive_timeouts INTEGER NOT NULL DEFAULT 0,
          paused_urls TEXT NOT NULL DEFAULT '[]',
          remaining_urls TEXT NOT NULL DEFAULT '[]',
          started_at TEXT,
          paused_at TEXT,
          updated_at TEXT DEFAULT (datetime('now'))
        )
      `);

      // Ensure a row exists
      await db.runAsync(`
        INSERT OR IGNORE INTO scrape_state (id) VALUES (1)
      `);
    } catch (error) {
      this.log('warn', `Failed to create scrape_state table: ${error}`);
    }
  }

  private async loadStateFromDb(): Promise<void> {
    try {
      const state = await db.getAsync<{
        status: string;
        total_urls: number;
        processed_urls: number;
        successful_urls: number;
        failed_urls: number;
        timeout_count: number;
        consecutive_timeouts: number;
        paused_urls: string;
        remaining_urls: string;
        started_at: string | null;
        paused_at: string | null;
      }>('SELECT * FROM scrape_state WHERE id = 1');

      if (state && state.status !== 'idle' && state.status !== 'completed') {
        this.scrapeState = {
          status: state.status as ScrapeState['status'],
          totalUrls: state.total_urls,
          processedUrls: state.processed_urls,
          successfulUrls: state.successful_urls,
          failedUrls: state.failed_urls,
          timeoutCount: state.timeout_count,
          consecutiveTimeouts: state.consecutive_timeouts,
          pausedUrls: JSON.parse(state.paused_urls || '[]'),
          remainingUrls: JSON.parse(state.remaining_urls || '[]'),
          startedAt: state.started_at,
          pausedAt: state.paused_at,
        };

        this.pausedUrls = new Set(this.scrapeState.pausedUrls);
        this.remainingUrls = new Set(this.scrapeState.remainingUrls);
        this.timeoutCount = this.scrapeState.timeoutCount;
        this.consecutiveTimeouts = this.scrapeState.consecutiveTimeouts;

        if (state.status === 'paused' || state.status === 'timeout_paused') {
          this.isPaused = state.status === 'paused';
          this.isTimeoutPaused = state.status === 'timeout_paused';
        }

        this.log('info', `Restored scrape state: ${state.status}, ${this.remainingUrls.size} URLs remaining, ${this.pausedUrls.size} paused`);
      }
    } catch (error) {
      this.log('warn', `Failed to load scrape state: ${error}`);
    }
  }

  private async saveStateToDb(): Promise<void> {
    try {
      await db.runAsync(`
        UPDATE scrape_state SET
          status = ?,
          total_urls = ?,
          processed_urls = ?,
          successful_urls = ?,
          failed_urls = ?,
          timeout_count = ?,
          consecutive_timeouts = ?,
          paused_urls = ?,
          remaining_urls = ?,
          started_at = ?,
          paused_at = ?,
          updated_at = datetime('now')
        WHERE id = 1
      `, [
        this.scrapeState.status,
        this.scrapeState.totalUrls,
        this.scrapeState.processedUrls,
        this.scrapeState.successfulUrls,
        this.scrapeState.failedUrls,
        this.scrapeState.timeoutCount,
        this.scrapeState.consecutiveTimeouts,
        JSON.stringify(this.scrapeState.pausedUrls),
        JSON.stringify(this.scrapeState.remainingUrls),
        this.scrapeState.startedAt,
        this.scrapeState.pausedAt,
      ]);
    } catch (error) {
      this.log('warn', `Failed to save scrape state: ${error}`);
    }
  }

  private updateState(updates: Partial<ScrapeState>): void {
    this.scrapeState = { ...this.scrapeState, ...updates };
    this.emit('state-change', this.scrapeState);

    // Debounced save to DB - only save every 5 seconds max to reduce CPU/IO
    if (this.stateSaveTimeout) {
      clearTimeout(this.stateSaveTimeout);
    }
    this.stateSaveTimeout = setTimeout(() => {
      this.saveStateToDb().catch(() => {});
      this.stateSaveTimeout = null;
    }, this.stateSaveDebounceMs);
  }

  // Force immediate save (for critical state changes)
  private async forceStateSave(): Promise<void> {
    if (this.stateSaveTimeout) {
      clearTimeout(this.stateSaveTimeout);
      this.stateSaveTimeout = null;
    }
    await this.saveStateToDb();
  }

  // Event-based pause waiting (replaces polling loop)
  private async waitForResume(): Promise<void> {
    if (!this.isPaused && !this.isTimeoutPaused) return;

    if (!this.resumePromise) {
      this.resumePromise = new Promise(resolve => {
        this.resumeResolve = resolve;
      });
    }

    await this.resumePromise;
  }

  // Signal resume to all waiting workers
  private signalResume(): void {
    if (this.resumeResolve) {
      this.resumeResolve();
      this.resumePromise = null;
      this.resumeResolve = null;
    }
  }

  private getDesiredImageConcurrency(): number {
    const cpuCount = Math.max(1, os.cpus().length);
    // Allow image pipelines up to core count but not more than configured concurrency.
    return Math.min(cpuCount, Math.max(1, this.config.concurrency));
  }

  private updateSharpConcurrency(): void {
    const cpuCount = Math.max(1, os.cpus().length);
    const envCap = parseInt(
      process.env.SCRAPER_SHARP_CONCURRENCY ||
      process.env.SHARP_CONCURRENCY ||
      '',
      10
    );
    const desired = Number.isFinite(envCap) && envCap > 0
      ? Math.min(envCap, cpuCount)
      : Math.min(cpuCount, Math.max(1, this.config.concurrency));
    sharp.concurrency(desired);
  }

  private async getScreenshotExclusionSelectors(forceRefresh: boolean = false): Promise<string[]> {
    const now = Date.now();
    if (!forceRefresh &&
        this.screenshotExclusionSelectors.length > 0 &&
        now - this.screenshotExclusionsFetchedAt < this.screenshotExclusionsTtlMs) {
      return this.screenshotExclusionSelectors;
    }
    try {
      const exclusions = await db.allAsync<{ selector: string }>(
        'SELECT selector FROM screenshot_exclusions WHERE is_active = 1'
      );
      this.screenshotExclusionSelectors = exclusions.map(e => e.selector);
      this.screenshotExclusionsFetchedAt = now;
    } catch (error) {
      this.log('warn', `Failed to fetch screenshot exclusions: ${error}`);
    }
    return this.screenshotExclusionSelectors;
  }

  private async newContext(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({
      viewport: { width: 1600, height: 1000 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
  }

  async initBrowserPool(): Promise<void> {
    // Calculate how many browsers we need based on concurrency
    // Each browser can have pagesPerBrowser pages, so we need enough browsers
    // to satisfy the concurrency requirement
    const minBrowsersNeeded = Math.ceil(this.config.concurrency / this.config.pagesPerBrowser);
    const actualBrowserInstances = Math.max(this.config.browserInstances, minBrowsersNeeded);

    if (actualBrowserInstances > this.config.browserInstances) {
      this.log('info', `Increasing browser instances from ${this.config.browserInstances} to ${actualBrowserInstances} to support concurrency of ${this.config.concurrency}`);
      this.config.browserInstances = actualBrowserInstances;
    }

    this.log('info', `Creating ${actualBrowserInstances} browser instances (concurrency=${this.config.concurrency}, pagesPerBrowser=${this.config.pagesPerBrowser})...`);

    const launchArgs = [
      // Essential security/sandboxing
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',

      // Disable unnecessary features that don't help with screenshots
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process,TranslateUI',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-breakpad',
      '--disable-component-extensions-with-background-pages',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-hang-monitor',
      '--disable-ipc-flooding-protection',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-renderer-backgrounding',
      '--disable-sync',
      '--disable-translate',
      '--disable-speech-api',
      '--disable-voice-input',

      // Resource limits
      '--metrics-recording-only',
      '--no-first-run',
      '--safebrowsing-disable-auto-update',
      '--js-flags=--max-old-space-size=512',
      '--memory-pressure-off',
    ];

    const browserPromises = Array.from({ length: actualBrowserInstances }, () =>
      chromium.launch({
        headless: true,
        args: launchArgs
      })
    );

    const browsers = await Promise.all(browserPromises);
    const contexts = await Promise.all(browsers.map(b => this.newContext(b)));

    this.browserPool = browsers.map((browser, i) => ({
      browser,
      context: contexts[i],
      pagesInUse: 0,
      maxPages: this.config.pagesPerBrowser,
      usageCount: 0
    }));

    this.log('info', `Browser pool initialized with ${this.browserPool.length} browsers`);
  }

  async closeBrowserPool(): Promise<void> {
    for (const item of this.browserPool) {
      try {
        await item.context.close();
        await item.browser.close();
      } catch {
        // Ignore close errors
      }
    }
    this.browserPool = [];
    this.log('info', 'Browser pool closed');
  }

  private async getAvailablePage(): Promise<{ page: Page; browserItem: BrowserPoolItem } | null> {
    for (const item of this.browserPool) {
      if (item.pagesInUse < item.maxPages) {
        try {
          const page = await item.context.newPage();
          item.pagesInUse++;
          item.usageCount++;
          return { page, browserItem: item };
        } catch (error) {
          this.log('warn', `Failed to create page, recreating context: ${error}`);
          try {
            item.context = await this.newContext(item.browser);
            item.usageCount = 0;
            item.pagesInUse = 0;
            const page = await item.context.newPage();
            item.pagesInUse++;
            item.usageCount++;
            return { page, browserItem: item };
          } catch (recreateError) {
            this.log('error', `Failed to recreate context: ${recreateError}`);
            continue;
          }
        }
      }
    }
    return null;
  }

  // Wait for a page to become available (event-based, no polling)
  private async waitForAvailablePage(): Promise<{ page: Page; browserItem: BrowserPoolItem }> {
    // First try to get a page immediately
    let pageInfo = await this.getAvailablePage();
    if (pageInfo) return pageInfo;

    // Wait for a page to be released
    while (!pageInfo && !this.isStopped) {
      await new Promise<void>(resolve => {
        this.pageWaiters.push(resolve);
      });
      pageInfo = await this.getAvailablePage();
    }

    if (!pageInfo) {
      throw new Error('Scraper stopped while waiting for page');
    }
    return pageInfo;
  }

  private releasePage(browserItem: BrowserPoolItem): void {
    browserItem.pagesInUse = Math.max(0, browserItem.pagesInUse - 1);
    // Notify one waiter that a page is available
    if (this.pageWaiters.length > 0) {
      const waiter = this.pageWaiters.shift();
      waiter?.();
    }
  }

  updateConfig(newConfig: Partial<FreshScraperConfig>): void {
    const oldBrowserInstances = this.config.browserInstances;
    const oldConcurrency = this.config.concurrency;
    const oldPagesPerBrowser = this.config.pagesPerBrowser;

    this.config = { ...this.config, ...newConfig };

    // Update semaphore if concurrency changed
    if (newConfig.concurrency !== undefined && newConfig.concurrency !== oldConcurrency) {
      this.semaphore.setPermits(newConfig.concurrency);
      this.imageSemaphore.setPermits(this.getDesiredImageConcurrency());
      this.updateSharpConcurrency();
    }

    // Apply pagesPerBrowser immediately to existing pool capacity if possible
    if (newConfig.pagesPerBrowser !== undefined && newConfig.pagesPerBrowser !== oldPagesPerBrowser) {
      for (const item of this.browserPool) {
        item.maxPages = this.config.pagesPerBrowser;
      }
    }

    // Check if we need more browsers to support the new concurrency
    const minBrowsersNeeded = Math.ceil(this.config.concurrency / this.config.pagesPerBrowser);
    const currentMaxPages = this.browserPool.length * this.config.pagesPerBrowser;

    // If browser instances changed OR we need more browsers for concurrency
    if ((newConfig.browserInstances !== undefined && newConfig.browserInstances !== oldBrowserInstances) ||
        (minBrowsersNeeded > this.browserPool.length)) {
      if (minBrowsersNeeded > this.config.browserInstances) {
        this.config.browserInstances = minBrowsersNeeded;
        this.log('info', `Auto-increasing browser instances to ${minBrowsersNeeded} to support concurrency of ${this.config.concurrency}`);
      }
      this.pendingBrowserRecreation = true;
    }

    this.log('info', `Config updated: concurrency=${this.config.concurrency}, browsers=${this.config.browserInstances}, pagesPerBrowser=${this.config.pagesPerBrowser}, maxPages=${currentMaxPages}, batchSize=${this.config.batchSize}`);
  }

  async applyPendingBrowserChanges(): Promise<boolean> {
    if (!this.pendingBrowserRecreation) {
      return false;
    }

    this.log('info', `Recreating browser pool with ${this.config.browserInstances} instances...`);
    await this.closeBrowserPool();
    await this.initBrowserPool();
    this.pendingBrowserRecreation = false;
    this.log('info', `Browser pool recreated: ${this.browserPool.length} instances ready`);
    return true;
  }

  hasPendingBrowserChanges(): boolean {
    return this.pendingBrowserRecreation;
  }

  pause(): void {
    this.isPaused = true;
    this.updateState({
      status: 'paused',
      pausedAt: new Date().toISOString()
    });
    this.emit('paused');
    this.log('info', 'Scraper paused');
  }

  resume(): void {
    this.isPaused = false;
    this.isTimeoutPaused = false;
    this.consecutiveTimeouts = 0;
    this.updateState({
      status: 'running',
      pausedAt: null,
      consecutiveTimeouts: 0
    });
    this.signalResume(); // Wake up all waiting workers
    this.log('info', 'Scraper resumed');
  }

  resumeTimeoutPaused(): void {
    if (this.isTimeoutPaused) {
      this.isTimeoutPaused = false;
      this.consecutiveTimeouts = 0;
      // Move paused URLs back to remaining
      for (const url of this.pausedUrls) {
        this.remainingUrls.add(url);
      }
      this.pausedUrls.clear();
      this.updateState({
        status: 'running',
        pausedAt: null,
        consecutiveTimeouts: 0,
        pausedUrls: [],
        remainingUrls: Array.from(this.remainingUrls)
      });
      this.signalResume(); // Wake up all waiting workers
      this.log('info', `Resumed from timeout pause, ${this.remainingUrls.size} URLs to process`);
    }
  }

  stop(): void {
    this.isStopped = true;
    this.isPaused = false;
    this.isTimeoutPaused = false;
    this.updateState({ status: 'stopped' });
    this.signalResume(); // Wake up workers so they can exit
    // Wake up all page waiters so they can exit
    while (this.pageWaiters.length > 0) {
      const waiter = this.pageWaiters.shift();
      waiter?.();
    }
    this.log('info', 'Scraper stopped');
  }

  getCurrentBatch(): TemplatePhase[] {
    return this.currentBatch;
  }

  getScrapeState(): ScrapeState {
    return this.scrapeState;
  }

  getRealTimeState(): {
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
  } {
    let totalPagesInUse = 0;
    let maxPagesCapacity = 0;
    for (const item of this.browserPool) {
      totalPagesInUse += item.pagesInUse;
      maxPagesCapacity += item.maxPages;
    }

    return {
      activeBrowsers: this.browserPool.length,
      totalPagesInUse,
      maxPagesCapacity,
      configuredConcurrency: this.config.concurrency,
      configuredBrowserInstances: this.config.browserInstances,
      configuredPagesPerBrowser: this.config.pagesPerBrowser,
      configuredBatchSize: this.config.batchSize,
      configuredTimeout: this.config.timeout,
      pendingBrowserRestart: this.pendingBrowserRecreation,
      isPaused: this.isPaused,
      isStopped: this.isStopped,
      isTimeoutPaused: this.isTimeoutPaused,
      currentBatchSize: this.currentBatch.length,
      timeoutCount: this.timeoutCount,
      consecutiveTimeouts: this.consecutiveTimeouts,
      pausedUrlCount: this.pausedUrls.size,
      semaphoreAvailable: this.semaphore.getAvailable(),
      semaphoreWaiting: this.semaphore.getWaiting(),
    };
  }

  private recordOperation(success: boolean, isTimeout: boolean = false): void {
    this.recentOperations.push(success);
    if (this.recentOperations.length > RECENT_OPERATIONS_WINDOW) {
      this.recentOperations.shift();
    }

    if (isTimeout) {
      this.timeoutCount++;
      this.consecutiveTimeouts++;
      this.updateState({
        timeoutCount: this.timeoutCount,
        consecutiveTimeouts: this.consecutiveTimeouts
      });
    } else {
      this.consecutiveTimeouts = 0;
      this.updateState({ consecutiveTimeouts: 0 });
    }
  }

  private shouldAutoPause(): boolean {
    // Check consecutive timeouts
    if (this.consecutiveTimeouts >= CONSECUTIVE_TIMEOUT_THRESHOLD) {
      this.log('warn', `Auto-pausing: ${this.consecutiveTimeouts} consecutive timeouts`);
      return true;
    }

    // Check timeout ratio in recent operations
    if (this.recentOperations.length >= RECENT_OPERATIONS_WINDOW) {
      const timeoutRatio = this.recentOperations.filter(op => !op).length / this.recentOperations.length;
      if (timeoutRatio >= TIMEOUT_RATIO_THRESHOLD) {
        this.log('warn', `Auto-pausing: ${Math.round(timeoutRatio * 100)}% timeout rate`);
        return true;
      }
    }

    return false;
  }

  private triggerTimeoutPause(): void {
    this.isTimeoutPaused = true;
    this.updateState({
      status: 'timeout_paused',
      pausedAt: new Date().toISOString(),
      pausedUrls: Array.from(this.pausedUrls) // Convert Set to array for serialization
    });
    this.emit('timeout-paused', {
      timeoutCount: this.timeoutCount,
      consecutiveTimeouts: this.consecutiveTimeouts
    });
    this.log('warn', `Scraper auto-paused due to timeouts. ${this.pausedUrls.size} URLs paused.`);
  }

  async scrapeBatch(urls: string[]): Promise<{ processed: number; successful: number; failed: number }> {
    let processed = 0;
    let successful = 0;
    let failed = 0;

    const urlsToProcess = urls;
    this.remainingUrls = new Set(urlsToProcess);

    this.updateState({
      status: 'running',
      totalUrls: urlsToProcess.length,
      processedUrls: 0,
      successfulUrls: 0,
      failedUrls: 0,
      remainingUrls: urlsToProcess,
      pausedUrls: [],
      startedAt: new Date().toISOString(),
      pausedAt: null
    });

    this.emit('realtime-state', this.getRealTimeState());
    this.log('info', `Starting scrape of ${urlsToProcess.length} URLs (concurrency=${this.config.concurrency}, batchSize=${this.config.batchSize})`);

    // Preload relation caches to minimize DB reads during scrape
    const [existingSubcats, existingStyles, existingFeatures] = await Promise.all([
      db.allAsync<{ id: number; name: string }>('SELECT id, name FROM subcategories'),
      db.allAsync<{ id: number; name: string }>('SELECT id, name FROM styles'),
      db.allAsync<{ id: number; name: string }>('SELECT id, name FROM features')
    ]);
    const subcategoryCache = new Map(existingSubcats.map(r => [r.name.toLowerCase(), r.id]));
    const styleCache = new Map(existingStyles.map(r => [r.name.toLowerCase(), r.id]));
    const featureCache = new Map(existingFeatures.map(r => [r.name.toLowerCase(), r.id]));

    let lastProgressEmit = 0;
    const progressEmitInterval = 5;
    let internalBatchIndex = 0;

    for (let offset = 0; offset < urlsToProcess.length && !this.isStopped; ) {
      if (this.isPaused || this.isTimeoutPaused) {
        await this.waitForResume();
        if (this.isStopped || this.isTimeoutPaused) break;
      }

      if (this.hasPendingBrowserChanges()) {
        await this.applyPendingBrowserChanges();
      }

      const selectors = await this.getScreenshotExclusionSelectors(internalBatchIndex === 0);
      const chunkSize = Math.max(1, this.config.batchSize || urlsToProcess.length);
      const batchUrls = urlsToProcess.slice(offset, offset + chunkSize);
      offset += batchUrls.length;

      // Track only the current internal batch for UI/polling efficiency
      this.currentBatch = batchUrls.map(url => ({
        url,
        slug: this.extractSlug(url),
        name: null,
        phase: 'pending' as const,
        startTime: Date.now()
      }));

      this.emit('batch-start', {
        batchIndex: internalBatchIndex,
        batchSize: batchUrls.length,
        urls: batchUrls
      });
      this.emit('realtime-state', this.getRealTimeState());

      const processUrl = async (url: string, index: number): Promise<void> => {
        await this.semaphore.acquire();

        let pageInfo: { page: Page; browserItem: BrowserPoolItem } | null = null;
        let browserResult: BrowserScrapeResult | null = null;

        try {
          if (this.isPaused || this.isTimeoutPaused) {
            await this.waitForResume();
          }

          if (this.isStopped) return;

          if (this.isTimeoutPaused) {
            this.pausedUrls.add(url);
            return;
          }

          try {
            pageInfo = await this.waitForAvailablePage();
          } catch {
            return;
          }

          browserResult = await this.scrapeTemplateInBrowser(pageInfo.page, url, index, selectors);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          const isTimeout = errorMsg.includes('Timeout') || errorMsg.includes('timeout');
          browserResult = { success: false, slug: this.extractSlug(url), error: errorMsg, isTimeout };
        } finally {
          if (pageInfo) {
            try { await pageInfo.page.close(); } catch {}
            this.releasePage(pageInfo.browserItem);
          }
          this.semaphore.release();
        }

        if (this.isStopped || !browserResult) return;

        processed++;
        this.remainingUrls.delete(url);

        if (browserResult.success) {
          try {
            const saveResult = await this.processImagesAndSaveTemplate(
              browserResult,
              url,
              index,
              subcategoryCache,
              styleCache,
              featureCache
            );

            successful++;
            this.recordOperation(true);

            this.emit('template-complete', {
              url,
              name: browserResult.data.name || browserResult.slug,
              slug: browserResult.slug,
              success: true,
              thumbnailPath: saveResult.thumbnailPath
            });

            if (saveResult.thumbnailPath) {
              this.emit('screenshot-captured', {
                name: browserResult.data.name || browserResult.slug,
                slug: browserResult.slug,
                thumbnailPath: saveResult.thumbnailPath,
                isFeaturedAuthor: browserResult.isFeaturedAuthor
              });
            }
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            failed++;
            this.recordOperation(false, false);
            this.updatePhase(index, 'failed', errorMsg);
            this.log('error', `Failed to save ${browserResult.slug}: ${errorMsg}`);
            this.emit('template-complete', {
              url,
              name: browserResult.slug,
              slug: browserResult.slug,
              success: false
            });
          }
        } else {
          failed++;
          this.recordOperation(false, browserResult.isTimeout);

          if (browserResult.isTimeout) {
            this.pausedUrls.add(url);
          }

          this.emit('template-complete', {
            url,
            name: browserResult.slug,
            slug: browserResult.slug,
            success: false
          });

          if (this.shouldAutoPause()) {
            this.triggerTimeoutPause();
          }
        }

        if (processed - lastProgressEmit >= progressEmitInterval || processed === urlsToProcess.length) {
          lastProgressEmit = processed;
          this.updateState({
            processedUrls: processed,
            successfulUrls: successful,
            failedUrls: failed
          });

          this.emit('progress', {
            processed,
            successful,
            failed,
            total: urlsToProcess.length
          });

          this.emit('realtime-state', this.getRealTimeState());
        }
      };

      const tasks = batchUrls.map((url, index) => processUrl(url, index));
      await Promise.all(tasks);

      // Update persisted URL lists at batch boundaries only (avoid O(N) conversions per template)
      this.updateState({
        remainingUrls: Array.from(this.remainingUrls),
        pausedUrls: Array.from(this.pausedUrls)
      });

      this.emit('batch-complete', {
        batchIndex: internalBatchIndex,
        processed,
        successful,
        failed
      });

      internalBatchIndex++;

      if (this.isTimeoutPaused || this.isStopped) break;
    }

    this.emit('realtime-state', this.getRealTimeState());

    const finalStatus = this.isStopped ? 'stopped' :
      this.isTimeoutPaused ? 'timeout_paused' :
        'completed';

    this.updateState({
      status: finalStatus,
      processedUrls: processed,
      successfulUrls: successful,
      failedUrls: failed,
      remainingUrls: Array.from(this.remainingUrls),
      pausedUrls: Array.from(this.pausedUrls)
    });

    return { processed, successful, failed };
  }

  private async navigateWithRetry(
    page: Page,
    url: string,
    maxRetries: number = 2
  ): Promise<{ success: boolean; error?: string }> {
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: this.config.timeout
        });
        return { success: true };
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown error';
        const isTimeout = lastError.includes('Timeout') || lastError.includes('timeout');

        if (isTimeout && attempt < maxRetries) {
          this.log('warn', `Timeout on attempt ${attempt}/${maxRetries} for ${url}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
        } else if (!isTimeout) {
          break;
        }
      }
    }

    return { success: false, error: lastError || 'Unknown error' };
  }

  private async enableLightweightMode(page: Page): Promise<() => Promise<void>> {
    const handler = (route: Route) => {
      const type = route.request().resourceType();
      if (type === 'image' || type === 'media') {
        route.abort().catch(() => {});
      } else {
        route.continue().catch(() => {});
      }
    };
    try {
      await page.route('**/*', handler);
    } catch {
      // Ignore routing errors
    }
    return async () => {
      try {
        await page.unroute('**/*', handler);
      } catch {
        // Ignore
      }
    };
  }

  private async scrapeTemplateInBrowser(
    page: Page,
    url: string,
    batchIndex: number,
    screenshotSelectors: string[]
  ): Promise<BrowserScrapeResult> {
    const slug = this.extractSlug(url);
    this.updatePhase(batchIndex, 'loading');

    try {
      this.log('info', `Scraping: ${slug}`);

      const disableLightweight = await this.enableLightweightMode(page);
      const navResult = await this.navigateWithRetry(page, url, 2);
      if (!navResult.success) {
        throw new Error(navResult.error || 'Navigation failed');
      }

      this.updatePhase(batchIndex, 'scraping_details');

      const data = await page.evaluate(() => {
        const nameEl = document.querySelector('h4') || document.querySelector('h1');
        const name = nameEl?.textContent?.trim()
          .replace(' - Webflow Ecommerce Website Template', '')
          .replace(' - Webflow HTML Website Template', '') || '';

        const authorLinkEl = document.querySelector('a[href*="/designers/"]');
        let authorId: string | null = null;
        let authorName: string | null = null;
        let authorAvatar: string | null = null;

        if (authorLinkEl) {
          const href = authorLinkEl.getAttribute('href') || '';
          authorId = href.split('/designers/')[1]?.split('/')[0] || null;
          authorName = authorLinkEl.querySelector('.designer-preview_name-wrapper')?.textContent?.trim() ||
            authorLinkEl.querySelector('div')?.textContent?.trim() || null;
          const avatarImg = authorLinkEl.querySelector('img');
          authorAvatar = avatarImg?.getAttribute('src') || null;
        }

        const previewLink = document.querySelector('a[href*=\".webflow.io\"]') as HTMLAnchorElement;
        const livePreviewUrl = previewLink?.href || '';

        const designerLink = document.querySelector('a[href*=\"preview.webflow.com\"]') as HTMLAnchorElement;
        const designerPreviewUrl = designerLink?.href || '';

        const priceEl = document.querySelector('.product-hero_price') || document.querySelector('[class*=\"price\"]');
        const price = priceEl?.textContent?.trim() || 'Free';

        const shortDescEl = document.querySelector('.product-hero_description') || document.querySelector('[class*=\"description\"]');
        const shortDescription = shortDescEl?.textContent?.trim() || '';

        const longDescEl = document.querySelector('.product-details_content') || document.querySelector('[class*=\"details\"]');
        const longDescription = longDescEl?.innerHTML || '';

        const subcategoryEls = document.querySelectorAll('#subcategory .tag-list_link, .tag-list_link');
        const subcategories: string[] = [];
        subcategoryEls.forEach(el => {
          const text = el.textContent?.trim();
          if (text) subcategories.push(text);
        });

        const styleEls = document.querySelectorAll('.sidebar-layout_section');
        const styles: string[] = [];
        styleEls.forEach(section => {
          const heading = section.querySelector('h4, h5');
          if (heading?.textContent?.toLowerCase().includes('style')) {
            section.querySelectorAll('.tag-list_link').forEach(el => {
              const text = el.textContent?.trim();
              if (text) styles.push(text);
            });
          }
        });

        const features: string[] = [];
        let isCms = false;
        let isEcommerce = false;

        document.querySelectorAll('.product-feature-text, .feature-item').forEach(el => {
          const text = el.textContent?.trim();
          if (text) {
            features.push(text);
            if (text.toLowerCase().includes('cms')) isCms = true;
            if (text.toLowerCase().includes('ecommerce') || text.toLowerCase().includes('e-commerce')) isEcommerce = true;
          }
        });

        return {
          name,
          authorId,
          authorName,
          authorAvatar,
          livePreviewUrl,
          designerPreviewUrl,
          price,
          shortDescription,
          longDescription,
          subcategories,
          styles,
          features,
          isCms,
          isEcommerce
        };
      });

      if (!data.livePreviewUrl) {
        throw new Error('No live preview URL found');
      }

      const isFeaturedAuthor = data.authorId ? this.featuredAuthorIds.has(data.authorId) : false;
      if (this.currentBatch[batchIndex]) {
        this.currentBatch[batchIndex].name = data.name;
      }

      this.updatePhase(batchIndex, 'taking_screenshot');

      let screenshotBuffer: Buffer | null = null;
      let screenshotUrl: string | null = null;
      let isAlternateHomepage = false;
      let alternateHomepagePath: string | null = null;

      try {
        await disableLightweight();

        const previewNavResult = await this.navigateWithRetry(page, data.livePreviewUrl, 2);
        if (!previewNavResult.success) {
          throw new Error(previewNavResult.error || 'Preview navigation failed');
        }

        const homepageDetection = await detectHomepage(page, data.livePreviewUrl);
        screenshotUrl = homepageDetection.screenshotUrl;
        isAlternateHomepage = homepageDetection.isAlternateHomepage;
        alternateHomepagePath = homepageDetection.detectedPath || null;

        if (homepageDetection.isAlternateHomepage) {
          this.log('info', `[ALTERNATE] Found alternate homepage for ${slug}: ${homepageDetection.detectedPath}`);
          const altNavResult = await this.navigateWithRetry(page, homepageDetection.screenshotUrl, 2);
          if (!altNavResult.success) {
            this.log('warn', `Failed to navigate to alternate homepage: ${altNavResult.error}`);
          }
        }

        await preparePageForScreenshot(page, {
          loadTimeoutMs: this.config.timeout,
          animationWaitMs: this.config.screenshotAnimationWaitMs,
          scrollDelayMs: 150,
          elementsToRemove: screenshotSelectors,
          enableScroll: false,
          nudgeScrollRatio: this.config.screenshotNudgeScrollRatio,
          nudgeWaitMs: this.config.screenshotNudgeWaitMs,
          nudgeAfterMs: this.config.screenshotNudgeAfterMs,
          ensureAnimationsSettled: true,
          stabilityStableMs: this.config.screenshotStabilityStableMs,
          stabilityMaxWaitMs: this.config.screenshotStabilityMaxWaitMs,
          stabilityCheckIntervalMs: this.config.screenshotStabilityCheckIntervalMs
        });

        screenshotBuffer = await page.screenshot({
          type: 'jpeg',
          quality: Math.min(100, Math.max(1, this.config.screenshotJpegQuality)),
          fullPage: false
        });
      } catch (screenshotError) {
        const errorMsg = screenshotError instanceof Error ? screenshotError.message : 'Unknown error';
        this.log('warn', `Screenshot failed for ${slug}: ${errorMsg}`);
        if (errorMsg.includes('Timeout') || errorMsg.includes('timeout')) {
          throw screenshotError;
        }
      }

      return {
        success: true,
        slug,
        data,
        isFeaturedAuthor,
        screenshotBuffer,
        screenshotUrl,
        isAlternateHomepage,
        alternateHomepagePath
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.updatePhase(batchIndex, 'failed', errorMsg);
      this.log('error', `Failed: ${slug} - ${errorMsg}`);
      const isTimeout = errorMsg.includes('Timeout') || errorMsg.includes('timeout');
      return { success: false, slug, error: errorMsg, isTimeout };
    }
  }

  private async processImagesAndSaveTemplate(
    result: BrowserScrapeSuccess,
    storefrontUrl: string,
    batchIndex: number,
    subcategoryCache: Map<string, number>,
    styleCache: Map<string, number>,
    featureCache: Map<string, number>
  ): Promise<{ thumbnailPath?: string }> {
    const { slug, data } = result;

    let screenshotPath: string | null = null;
    let thumbnailPath: string | null = null;

    if (result.screenshotBuffer) {
      this.updatePhase(batchIndex, 'processing_thumbnail');
      await this.imageSemaphore.acquire();
      try {
        const screenshotFilename = `${slug}.webp`;
        screenshotPath = `/screenshots/${screenshotFilename}`;
        const screenshotFullPath = path.join(process.cwd(), 'public', 'screenshots', screenshotFilename);

	        const thumbnailFilename = `${slug}_thumb.webp`;
	        thumbnailPath = `/thumbnails/${thumbnailFilename}`;
	        const thumbnailFullPath = path.join(process.cwd(), 'public', 'thumbnails', thumbnailFilename);

	        const screenshotWebpQuality = Math.min(100, Math.max(1, this.config.screenshotWebpQuality));
	        const thumbnailWebpQuality = Math.min(100, Math.max(1, this.config.thumbnailWebpQuality));

	        await Promise.all([
	          sharp(result.screenshotBuffer)
	            .resize(MAX_SCREENSHOT_WIDTH, MAX_SCREENSHOT_HEIGHT, {
	              withoutEnlargement: true,
	              fit: 'inside'
	            })
	            .webp({ quality: screenshotWebpQuality })
	            .toFile(screenshotFullPath),
	          sharp(result.screenshotBuffer)
	            .resize(500, 500, {
	              fit: 'cover',
	              position: 'top'
	            })
	            .webp({ quality: thumbnailWebpQuality })
	            .toFile(thumbnailFullPath)
	        ]);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.log('warn', `Image processing failed for ${slug}: ${errorMsg}`);
        screenshotPath = null;
        thumbnailPath = null;
      } finally {
        this.imageSemaphore.release();
      }
    }

    this.updatePhase(batchIndex, 'saving');

    const templateId = `wf_${slug}`;

    await db.transaction(async (tx) => {
      await tx.runAsync(
        `INSERT OR REPLACE INTO templates (
          template_id, name, slug, author_name, author_id, author_avatar,
          storefront_url, live_preview_url, designer_preview_url,
          price, short_description, long_description,
          screenshot_path, screenshot_thumbnail_path,
          is_featured, is_cms, is_ecommerce,
          screenshot_url, is_alternate_homepage, alternate_homepage_path,
          scraped_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          templateId,
          data.name,
          slug,
          data.authorName,
          data.authorId,
          data.authorAvatar,
          storefrontUrl,
          data.livePreviewUrl,
          data.designerPreviewUrl,
          data.price,
          data.shortDescription,
          data.longDescription,
          screenshotPath,
          thumbnailPath,
          result.isFeaturedAuthor ? 1 : 0,
          data.isCms ? 1 : 0,
          data.isEcommerce ? 1 : 0,
          result.screenshotUrl,
          result.isAlternateHomepage ? 1 : 0,
          result.alternateHomepagePath
        ]
      );

      const insertedTemplate = await tx.getAsync<{ id: number }>(
        'SELECT id FROM templates WHERE template_id = ?',
        [templateId]
      );

      if (!insertedTemplate) return;

      const getOrCreateId = async (
        table: 'subcategories' | 'styles' | 'features',
        rawName: string
      ): Promise<number | null> => {
        const name = rawName.toLowerCase();
        const slugVal = name.replace(/[^a-z0-9]+/g, '-');
        let cache: Map<string, number>;
        let insertSql: string;
        let insertParams: string[];

        if (table === 'subcategories') {
          cache = subcategoryCache;
          insertSql = `INSERT OR IGNORE INTO subcategories (name, slug, display_name) VALUES (?, ?, ?)`;
          insertParams = [name, slugVal, rawName];
        } else if (table === 'styles') {
          cache = styleCache;
          insertSql = `INSERT OR IGNORE INTO styles (name, slug, display_name) VALUES (?, ?, ?)`;
          insertParams = [name, slugVal, rawName];
        } else {
          cache = featureCache;
          let iconType = 'default';
          if (name.includes('cms')) iconType = 'cms';
          if (name.includes('ecommerce')) iconType = 'ecommerce';
          insertSql = `INSERT OR IGNORE INTO features (name, slug, display_name, icon_type) VALUES (?, ?, ?, ?)`;
          insertParams = [name, slugVal, rawName, iconType];
        }

        const cached = cache.get(name);
        if (cached) return cached;

        await tx.runAsync(insertSql, insertParams);
        const row = await tx.getAsync<{ id: number }>(
          `SELECT id FROM ${table} WHERE name = ?`,
          [name]
        );
        if (row?.id) {
          cache.set(name, row.id);
          return row.id;
        }
        return null;
      };

      for (const sub of data.subcategories) {
        const id = await getOrCreateId('subcategories', sub);
        if (id) {
          await tx.runAsync(
            'INSERT OR IGNORE INTO template_subcategories (template_id, subcategory_id) VALUES (?, ?)',
            [insertedTemplate.id, id]
          );
        }
      }

      for (const style of data.styles) {
        const id = await getOrCreateId('styles', style);
        if (id) {
          await tx.runAsync(
            'INSERT OR IGNORE INTO template_styles (template_id, style_id) VALUES (?, ?)',
            [insertedTemplate.id, id]
          );
        }
      }

      for (const feature of data.features) {
        const id = await getOrCreateId('features', feature);
        if (id) {
          await tx.runAsync(
            'INSERT OR IGNORE INTO template_features (template_id, feature_id) VALUES (?, ?)',
            [insertedTemplate.id, id]
          );
        }
      }
    });

    this.updatePhase(batchIndex, 'completed');
    this.log('info', `Completed: ${slug}`);

    return thumbnailPath ? { thumbnailPath } : {};
  }

  private updatePhase(
    batchIndex: number,
    phase: TemplatePhase['phase'],
    error?: string
  ): void {
    if (this.currentBatch[batchIndex]) {
      this.currentBatch[batchIndex].phase = phase;
      if (error) {
        this.currentBatch[batchIndex].error = error;
      }

      const elapsed = Math.round((Date.now() - this.currentBatch[batchIndex].startTime) / 1000);

      this.emit('template-phase', {
        url: this.currentBatch[batchIndex].url,
        phase,
        elapsed
      });
    }
  }

  private extractSlug(url: string): string {
    const parts = url.split('/');
    return parts[parts.length - 1] || parts[parts.length - 2] || 'unknown';
  }

  private log(level: string, message: string): void {
    this.emit('log', { level, message });
    console.log(`[FreshScraper] [${level.toUpperCase()}] ${message}`);
  }

  async close(): Promise<void> {
    this.isStopped = true;
    await this.closeBrowserPool();
  }

  // Method to clear all state and start fresh
  async clearState(): Promise<void> {
    this.scrapeState = this.getDefaultState();
    this.pausedUrls = new Set();
    this.remainingUrls = new Set();
    this.timeoutCount = 0;
    this.consecutiveTimeouts = 0;
    this.recentOperations = [];
    this.isPaused = false;
    this.isTimeoutPaused = false;
    this.isStopped = false;
    await this.saveStateToDb();
    this.log('info', 'Scrape state cleared');
  }
}
