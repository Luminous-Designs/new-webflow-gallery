import { EventEmitter } from 'events';
import { chromium, Browser, BrowserContext, Page, Route } from 'playwright';
import sharp from 'sharp';
import os from 'os';
import { supabaseAdmin } from '@/lib/supabase';
import { preparePageForScreenshot } from '@/lib/screenshot/prepare';
import { uploadScreenshotToR2, isR2Configured } from '@/lib/r2';
import { detectHomepage } from './homepage-detector';
import { SupabaseTemplateBatchWriter, type SupabaseWriteSnapshot } from './supabase-template-writer';

// Configure Sharp globally for memory efficiency.
// Concurrency is set dynamically per scraper instance to match CPU/core capacity.
sharp.cache(false);

// Screenshot constraints to prevent processing massive images
const MAX_SCREENSHOT_HEIGHT = 5000; // Limit screenshots to 5000px tall
const MAX_SCREENSHOT_WIDTH = 1600;

const CHROMIUM_LAUNCH_ARGS = [
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
] as const;

// Types
interface ScrapedData {
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
  primaryCategory: string[];
  webflowSubcategories: string[];
  publishDate: string | null; // Template publish date (e.g., "2024-09-28")
}

export interface FreshScraperConfig {
  jobMode?: 'full' | 'screenshots_only';
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
  timeout: number;
  /** Additional selectors removed only for this run (in addition to screenshot_exclusions). */
  additionalScreenshotSelectors?: string[];
  /** If set, bypass homepage detection and screenshot this exact URL (one-off operations typically run with batchSize=1). */
  forceScreenshotUrl?: string;
  /** If true, and `requiredSelectors` are not found, skip screenshotting that template. */
  skipIfMissingRequiredSelectors?: boolean;
  /** CSS selectors / ids that must exist on the page to proceed. */
  requiredSelectors?: string[];
  /** If true, append a cache-busting query param to `screenshot_path` after upload. */
  appendCacheBusterToScreenshotPath?: boolean;
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
}

export const FRESH_SCRAPER_LIMITS = {
  concurrency: { min: 1, max: 100 },
  browserInstances: { min: 1, max: 30 },
  pagesPerBrowser: { min: 1, max: 50 },
  batchSize: { min: 1, max: 200 },
  timeout: { min: 5_000, max: 300_000 },
  screenshotNudgeScrollRatio: { min: 0, max: 0.5 },
  screenshotQuality: { min: 1, max: 100 }
} as const;

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function clampOptionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.trunc(clampNumber(parsed, min, max));
}

function clampOptionalFloat(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null) return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return clampNumber(parsed, min, max);
}

export function clampFreshScraperConfig(config: Partial<FreshScraperConfig>): Partial<FreshScraperConfig> {
  const out: Partial<FreshScraperConfig> = {};

  if (config.jobMode === 'full' || config.jobMode === 'screenshots_only') {
    out.jobMode = config.jobMode;
  }

  const clampedConcurrency = clampOptionalInt(config.concurrency, FRESH_SCRAPER_LIMITS.concurrency.min, FRESH_SCRAPER_LIMITS.concurrency.max);
  if (clampedConcurrency !== undefined) out.concurrency = clampedConcurrency;

  const clampedBrowsers = clampOptionalInt(config.browserInstances, FRESH_SCRAPER_LIMITS.browserInstances.min, FRESH_SCRAPER_LIMITS.browserInstances.max);
  if (clampedBrowsers !== undefined) out.browserInstances = clampedBrowsers;

  const clampedPages = clampOptionalInt(config.pagesPerBrowser, FRESH_SCRAPER_LIMITS.pagesPerBrowser.min, FRESH_SCRAPER_LIMITS.pagesPerBrowser.max);
  if (clampedPages !== undefined) out.pagesPerBrowser = clampedPages;

  const clampedBatchSize = clampOptionalInt(config.batchSize, FRESH_SCRAPER_LIMITS.batchSize.min, FRESH_SCRAPER_LIMITS.batchSize.max);
  if (clampedBatchSize !== undefined) out.batchSize = clampedBatchSize;

  const clampedTimeout = clampOptionalInt(config.timeout, FRESH_SCRAPER_LIMITS.timeout.min, FRESH_SCRAPER_LIMITS.timeout.max);
  if (clampedTimeout !== undefined) out.timeout = clampedTimeout;

  const clampedNudge = clampOptionalFloat(config.screenshotNudgeScrollRatio, FRESH_SCRAPER_LIMITS.screenshotNudgeScrollRatio.min, FRESH_SCRAPER_LIMITS.screenshotNudgeScrollRatio.max);
  if (clampedNudge !== undefined) out.screenshotNudgeScrollRatio = clampedNudge;

  const clampedAnim = clampOptionalInt(config.screenshotAnimationWaitMs, 0, 30_000);
  if (clampedAnim !== undefined) out.screenshotAnimationWaitMs = clampedAnim;

  const clampedNudgeWait = clampOptionalInt(config.screenshotNudgeWaitMs, 0, 30_000);
  if (clampedNudgeWait !== undefined) out.screenshotNudgeWaitMs = clampedNudgeWait;

  const clampedNudgeAfter = clampOptionalInt(config.screenshotNudgeAfterMs, 0, 30_000);
  if (clampedNudgeAfter !== undefined) out.screenshotNudgeAfterMs = clampedNudgeAfter;

  const clampedStable = clampOptionalInt(config.screenshotStabilityStableMs, 0, 30_000);
  if (clampedStable !== undefined) out.screenshotStabilityStableMs = clampedStable;

  const clampedStableMax = clampOptionalInt(config.screenshotStabilityMaxWaitMs, 0, 60_000);
  if (clampedStableMax !== undefined) out.screenshotStabilityMaxWaitMs = clampedStableMax;

  const clampedStableInterval = clampOptionalInt(config.screenshotStabilityCheckIntervalMs, 50, 10_000);
  if (clampedStableInterval !== undefined) out.screenshotStabilityCheckIntervalMs = clampedStableInterval;

  const clampedJpeg = clampOptionalInt(config.screenshotJpegQuality, FRESH_SCRAPER_LIMITS.screenshotQuality.min, FRESH_SCRAPER_LIMITS.screenshotQuality.max);
  if (clampedJpeg !== undefined) out.screenshotJpegQuality = clampedJpeg;

  const clampedWebp = clampOptionalInt(config.screenshotWebpQuality, FRESH_SCRAPER_LIMITS.screenshotQuality.min, FRESH_SCRAPER_LIMITS.screenshotQuality.max);
  if (clampedWebp !== undefined) out.screenshotWebpQuality = clampedWebp;

  if (typeof config.forceScreenshotUrl === 'string' && config.forceScreenshotUrl.trim()) {
    out.forceScreenshotUrl = config.forceScreenshotUrl.trim();
  }

  if (typeof config.skipIfMissingRequiredSelectors === 'boolean') {
    out.skipIfMissingRequiredSelectors = config.skipIfMissingRequiredSelectors;
  }

  if (Array.isArray(config.requiredSelectors)) {
    const selectors = config.requiredSelectors
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 5);
    if (selectors.length) out.requiredSelectors = selectors;
  }

  if (Array.isArray(config.additionalScreenshotSelectors)) {
    const selectors = config.additionalScreenshotSelectors
      .filter((s): s is string => typeof s === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (selectors.length) out.additionalScreenshotSelectors = selectors;
  }

  if (typeof config.appendCacheBusterToScreenshotPath === 'boolean') {
    out.appendCacheBusterToScreenshotPath = config.appendCacheBusterToScreenshotPath;
  }

  return out;
}

export interface TemplatePhase {
  url: string;
  slug: string;
  name: string | null;
  phase: 'pending' | 'loading' | 'scraping_details' | 'taking_screenshot' | 'processing_screenshot' | 'saving' | 'completed' | 'failed' | 'skipped' | 'timeout_paused';
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
  'template-complete': (data: { url: string; name: string; slug: string; success: boolean; screenshotPath?: string; error?: string }) => void;
  'batch-start': (data: { batchIndex: number; batchSize: number; urls: string[] }) => void;
  'batch-complete': (data: { batchIndex: number; processed: number; successful: number; failed: number }) => void;
  'phase-change': (data: { phase: string; message: string }) => void;
  'progress': (data: { processed: number; successful: number; failed: number; total: number }) => void;
  'screenshot-captured': (data: { name: string; slug: string; screenshotPath: string; isFeaturedAuthor: boolean }) => void;
  'supabase-state': (data: SupabaseWriteSnapshot) => void;
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
  templateRowId?: number;
  skipped?: boolean;
  skipReason?: string;
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
  private maxPermits: number;
  private availablePermits: number;
  private waiting: (() => void)[] = [];

  constructor(permits: number) {
    const initial = Math.max(1, Math.trunc(permits));
    this.maxPermits = initial;
    this.availablePermits = initial;
  }

  async acquire(): Promise<void> {
    if (this.availablePermits > 0) {
      this.availablePermits--;
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
      this.availablePermits = Math.min(this.maxPermits, this.availablePermits + 1);
    }
  }

  setPermits(newPermits: number): void {
    const nextMax = Math.max(1, Math.trunc(newPermits));
    const delta = nextMax - this.maxPermits;
    this.maxPermits = nextMax;
    this.availablePermits = clampNumber(this.availablePermits + delta, 0, this.maxPermits);

    while (this.availablePermits > 0 && this.waiting.length > 0) {
      this.availablePermits--;
      const next = this.waiting.shift();
      next?.();
    }
  }

  getAvailable(): number {
    return this.availablePermits;
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
  private jobMode: 'full' | 'screenshots_only';
  private browserPool: BrowserPoolItem[] = [];
  private isPaused: boolean = false;
  private isStopped: boolean = false;
  private isTimeoutPaused: boolean = false;
  private featuredAuthorIds: Set<string> = new Set();
  private currentBatch: TemplatePhase[] = [];
  private pendingBrowserRecreation: boolean = false;
  private semaphore: Semaphore;
  private imageSemaphore: Semaphore;
  private uploadSemaphore: Semaphore;
  private supabaseWriter: SupabaseTemplateBatchWriter;

  // Cached screenshot exclusions to avoid per-template DB queries
  private screenshotExclusionSelectors: string[] = [];
  private screenshotExclusionsFetchedAt: number = 0;
  private screenshotExclusionsTtlMs: number = 60_000;

  // Cached author-specific screenshot exclusions (applied only when author_id matches)
  private authorScreenshotExclusionsByAuthorId: Map<string, string[]> = new Map();
  private authorScreenshotExclusionsFetchedAt: number = 0;
  private authorScreenshotExclusionsTtlMs: number = 60_000;

  private templateIndex: Map<string, {
    id: number;
    name: string | null;
    live_preview_url: string | null;
    author_id: string | null;
    author_name: string | null;
    author_avatar: string | null;
  }> = new Map();

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

  // Event-based page availability (replaces polling for pages)
  private pageWaiters: (() => void)[] = [];

  constructor(config: Partial<FreshScraperConfig> = {}) {
    super();
    const sanitized = clampFreshScraperConfig(config);
    this.config = {
      jobMode: sanitized.jobMode ?? 'full',
      concurrency: sanitized.concurrency ?? 5,
      browserInstances: sanitized.browserInstances ?? 2,
      pagesPerBrowser: sanitized.pagesPerBrowser ?? 5,
      batchSize: sanitized.batchSize ?? 50,
      timeout: sanitized.timeout ?? 60000,
      additionalScreenshotSelectors: sanitized.additionalScreenshotSelectors ?? [],
      forceScreenshotUrl: sanitized.forceScreenshotUrl,
      skipIfMissingRequiredSelectors: sanitized.skipIfMissingRequiredSelectors ?? false,
      requiredSelectors: sanitized.requiredSelectors ?? [],
      appendCacheBusterToScreenshotPath: sanitized.appendCacheBusterToScreenshotPath ?? false,

      // Screenshot defaults tuned for reliable animation settling
      screenshotAnimationWaitMs: sanitized.screenshotAnimationWaitMs ?? 3000,
      screenshotNudgeScrollRatio: sanitized.screenshotNudgeScrollRatio ?? 0.2,
      screenshotNudgeWaitMs: sanitized.screenshotNudgeWaitMs ?? 500,
      screenshotNudgeAfterMs: sanitized.screenshotNudgeAfterMs ?? 500,
      screenshotStabilityStableMs: sanitized.screenshotStabilityStableMs ?? 1000,
      screenshotStabilityMaxWaitMs: sanitized.screenshotStabilityMaxWaitMs ?? 7000,
      screenshotStabilityCheckIntervalMs: sanitized.screenshotStabilityCheckIntervalMs ?? 250,

      // Screenshot quality defaults
      screenshotJpegQuality: sanitized.screenshotJpegQuality ?? 80,
      screenshotWebpQuality: sanitized.screenshotWebpQuality ?? 75
    };
    this.jobMode = this.config.jobMode ?? 'full';
    this.semaphore = new Semaphore(this.config.concurrency);
    this.imageSemaphore = new Semaphore(this.getDesiredImageConcurrency());
    this.uploadSemaphore = new Semaphore(this.getDesiredUploadConcurrency());
    this.supabaseWriter = new SupabaseTemplateBatchWriter({
      batchSize: Math.max(5, Math.min(50, this.config.batchSize || 25)),
      flushIntervalMs: 750,
      maxRecent: 250,
    });
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
    // Check R2 configuration
    if (!isR2Configured()) {
      throw new Error('R2 is not configured. Cannot initialize scraper without R2 storage.');
    }

    if (restoreState) {
      this.log('warn', 'restoreState requested, but FreshScraper no longer persists local state.');
    }

    const { data: authors, error } = await supabaseAdmin
      .from('featured_authors')
      .select('author_id')
      .eq('is_active', true);
    if (error) {
      this.log('warn', `Failed to load featured authors from Supabase: ${error.message}`);
      this.featuredAuthorIds = new Set();
    } else {
      this.featuredAuthorIds = new Set((authors || []).map(a => a.author_id));
    }

    // Start fresh
    this.pausedUrls = new Set();
    this.remainingUrls = new Set();
    this.timeoutCount = 0;
    this.consecutiveTimeouts = 0;

    if (this.jobMode === 'screenshots_only') {
      this.templateIndex = await this.loadTemplateIndex();
      this.log('info', `Loaded ${this.templateIndex.size} templates from Supabase for screenshots-only mode`);
    } else {
      this.templateIndex = new Map();
    }

    await this.getAuthorScreenshotExclusionSelectors(true);

    this.log('info', `Initialized with ${this.featuredAuthorIds.size} featured authors`);
  }

  private async loadTemplateIndex(): Promise<Map<string, {
    id: number;
    name: string | null;
    live_preview_url: string | null;
    author_id: string | null;
    author_name: string | null;
    author_avatar: string | null;
  }>> {
    const index = new Map<string, {
      id: number;
      name: string | null;
      live_preview_url: string | null;
      author_id: string | null;
      author_name: string | null;
      author_avatar: string | null;
    }>();

    const pageSize = 1000;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from('templates')
        .select('id, slug, name, live_preview_url, author_id, author_name, author_avatar')
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;

      for (const row of data) {
        const slug = (row.slug as string | null) || null;
        if (!slug) continue;
        index.set(slug, {
          id: row.id as number,
          name: (row.name as string | null) || null,
          live_preview_url: (row.live_preview_url as string | null) || null,
          author_id: (row.author_id as string | null) || null,
          author_name: (row.author_name as string | null) || null,
          author_avatar: (row.author_avatar as string | null) || null,
        });
      }

      if (data.length < pageSize) break;
    }

    return index;
  }

  private updateState(updates: Partial<ScrapeState>): void {
    this.scrapeState = { ...this.scrapeState, ...updates };
    this.emit('state-change', this.scrapeState);
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

  private getDesiredUploadConcurrency(): number {
    // Keep upload concurrency conservative to avoid saturating the VPS or local network.
    return Math.max(1, Math.min(4, Math.trunc(this.config.concurrency)));
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

  private async uploadScreenshotToR2Storage(slug: string, buffer: Buffer): Promise<string | null> {
    if (!isR2Configured()) {
      this.log('error', `[R2] R2 is not configured. Cannot upload screenshot for ${slug}`);
      return null;
    }

    await this.uploadSemaphore.acquire();
    try {
      const publicUrl = await uploadScreenshotToR2(slug, buffer);
      this.log('info', `[R2] Uploaded screenshot for ${slug} → ${publicUrl}`);
      return publicUrl;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      this.log('error', `[R2] Screenshot upload failed for ${slug}: ${errorMsg}`);
      return null;
    } finally {
      this.uploadSemaphore.release();
    }
  }

  private async getScreenshotExclusionSelectors(forceRefresh: boolean = false): Promise<string[]> {
    const now = Date.now();
    if (!forceRefresh &&
        this.screenshotExclusionSelectors.length > 0 &&
        now - this.screenshotExclusionsFetchedAt < this.screenshotExclusionsTtlMs) {
      return this.screenshotExclusionSelectors;
    }
    try {
      const { data, error } = await supabaseAdmin
        .from('screenshot_exclusions')
        .select('selector, selector_type')
        .eq('is_active', true);
      if (error) {
        throw error;
      }
      this.screenshotExclusionSelectors = (data || [])
        .map((row) => {
          const selector = (row.selector as string | null) || '';
          const type = (row.selector_type as string | null) || 'selector';
          if (!selector) return null;
          if (type === 'class' && !selector.startsWith('.')) return `.${selector}`;
          if (type === 'id' && !selector.startsWith('#')) return `#${selector}`;
          return selector;
        })
        .filter((s): s is string => !!s);
      this.screenshotExclusionsFetchedAt = now;
    } catch (error) {
      this.log('warn', `Failed to fetch screenshot exclusions: ${error}`);
    }
    return this.screenshotExclusionSelectors;
  }

  private normalizeSelector(selector: string, selectorType: string): string | null {
    const sel = String(selector || '').trim();
    if (!sel) return null;
    const type = String(selectorType || 'selector');
    if (type === 'class' && !sel.startsWith('.')) return `.${sel}`;
    if (type === 'id' && !sel.startsWith('#')) return `#${sel}`;
    return sel;
  }

  private async getAuthorScreenshotExclusionSelectors(forceRefresh: boolean = false): Promise<Map<string, string[]>> {
    const now = Date.now();
    if (!forceRefresh &&
        this.authorScreenshotExclusionsByAuthorId.size > 0 &&
        now - this.authorScreenshotExclusionsFetchedAt < this.authorScreenshotExclusionsTtlMs) {
      return this.authorScreenshotExclusionsByAuthorId;
    }

    const map = new Map<string, string[]>();
    try {
      const { data, error } = await supabaseAdmin
        .from('author_screenshot_exclusions')
        .select('author_id, selector, selector_type')
        .eq('is_active', true);
      if (error) throw error;

      for (const row of data || []) {
        const authorId = (row.author_id as string | null) || '';
        if (!authorId) continue;
        const normalized = this.normalizeSelector(
          (row.selector as string | null) || '',
          (row.selector_type as string | null) || 'selector'
        );
        if (!normalized) continue;
        const existing = map.get(authorId) || [];
        existing.push(normalized);
        map.set(authorId, existing);
      }
    } catch (error) {
      this.log('warn', `Failed to fetch author screenshot exclusions: ${error}`);
    }

    // Dedupe per author
    for (const [authorId, sels] of map.entries()) {
      map.set(authorId, Array.from(new Set(sels)));
    }

    this.authorScreenshotExclusionsByAuthorId = map;
    this.authorScreenshotExclusionsFetchedAt = now;
    return this.authorScreenshotExclusionsByAuthorId;
  }

  private async getEffectiveScreenshotSelectors(baseSelectors: string[], authorId: string | null | undefined): Promise<string[]> {
    if (!authorId) return baseSelectors;
    const map = await this.getAuthorScreenshotExclusionSelectors(false);
    const authorSelectors = map.get(authorId) || [];
    if (!authorSelectors.length) return baseSelectors;
    return Array.from(new Set([...baseSelectors, ...authorSelectors]));
  }

  private withCacheBuster(url: string): string {
    if (!this.config.appendCacheBusterToScreenshotPath) return url;
    try {
      const u = new URL(url);
      u.searchParams.set('v', String(Date.now()));
      return u.toString();
    } catch {
      return url;
    }
  }

  private async pageHasAnySelector(page: Page, selectors: string[]): Promise<boolean> {
    if (!selectors.length) return true;
	    return page.evaluate((sels) => {
	      const normalize = (sel: string) => {
	        const s = sel.trim();
	        if (!s) return null;
	        if (s.startsWith('.') || s.startsWith('#') || s.startsWith('[')) return s;
	        return `.${s}, #${s}`;
	      };
      for (const raw of sels) {
        const s = typeof raw === 'string' ? normalize(raw) : null;
        if (!s) continue;
        try {
          if (document.querySelector(s)) return true;
        } catch {
          // ignore invalid selectors
        }
      }
      return false;
    }, selectors);
  }

  private async newContext(browser: Browser): Promise<BrowserContext> {
    return browser.newContext({
      viewport: { width: 1600, height: 1000 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
  }

  private async launchBrowser(): Promise<Browser> {
    return chromium.launch({
      headless: true,
      args: [...CHROMIUM_LAUNCH_ARGS]
    });
  }

  private wakeOnePageWaiter(): void {
    if (this.pageWaiters.length > 0) {
      const waiter = this.pageWaiters.shift();
      waiter?.();
    }
  }

  private async replaceBrowserItem(item: BrowserPoolItem, reason: string): Promise<boolean> {
    this.log('warn', `Replacing browser instance (${reason})`);
    try { await item.context.close(); } catch {}
    try { await item.browser.close(); } catch {}

    try {
      const browser = await this.launchBrowser();
      const context = await this.newContext(browser);
      item.browser = browser;
      item.context = context;
      item.pagesInUse = 0;
      item.maxPages = this.config.pagesPerBrowser;
      item.usageCount = 0;
      this.wakeOnePageWaiter();
      return true;
    } catch (error) {
      this.log('error', `Failed to replace browser: ${error}`);
      return false;
    }
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

    const browsers: Browser[] = [];
    const contexts: BrowserContext[] = [];

    for (let i = 0; i < actualBrowserInstances; i++) {
      const browser = await this.launchBrowser();
      const context = await this.newContext(browser);
      browsers.push(browser);
      contexts.push(context);
    }

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
        if (!item.browser.isConnected()) {
          await this.replaceBrowserItem(item, 'browser disconnected');
        }

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
            const replaced = await this.replaceBrowserItem(item, 'context recreation failed');
            if (!replaced) continue;
            try {
              const page = await item.context.newPage();
              item.pagesInUse++;
              item.usageCount++;
              return { page, browserItem: item };
            } catch (finalError) {
              this.log('error', `Failed to create page after browser replacement: ${finalError}`);
            }
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
        const waiter = () => {
          clearTimeout(timeoutId);
          resolve();
        };
        const timeoutId = setTimeout(() => {
          const idx = this.pageWaiters.indexOf(waiter);
          if (idx >= 0) this.pageWaiters.splice(idx, 1);
          resolve();
        }, 1000);
        this.pageWaiters.push(waiter);
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
    this.wakeOnePageWaiter();
  }

  updateConfig(newConfig: Partial<FreshScraperConfig>): void {
    const sanitized = clampFreshScraperConfig(newConfig);
    const oldBrowserInstances = this.config.browserInstances;
    const oldConcurrency = this.config.concurrency;
    const oldPagesPerBrowser = this.config.pagesPerBrowser;
    const oldJobMode = this.jobMode;

    this.config = { ...this.config, ...sanitized };
    this.jobMode = this.config.jobMode ?? this.jobMode;

    if (this.jobMode !== oldJobMode) {
      this.log('warn', `jobMode changed (${oldJobMode} → ${this.jobMode}). Restart the scrape for this to take full effect.`);
    }

    // Update semaphore if concurrency changed
    if (sanitized.concurrency !== undefined && sanitized.concurrency !== oldConcurrency) {
      this.semaphore.setPermits(sanitized.concurrency);
      this.imageSemaphore.setPermits(this.getDesiredImageConcurrency());
      this.uploadSemaphore.setPermits(this.getDesiredUploadConcurrency());
      this.updateSharpConcurrency();
    }

    // Apply pagesPerBrowser immediately to existing pool capacity if possible
    if (sanitized.pagesPerBrowser !== undefined && sanitized.pagesPerBrowser !== oldPagesPerBrowser) {
      for (const item of this.browserPool) {
        item.maxPages = this.config.pagesPerBrowser;
      }
    }

    // Check if we need more browsers to support the new concurrency
    const minBrowsersNeeded = Math.ceil(this.config.concurrency / this.config.pagesPerBrowser);
    const currentMaxPages = this.browserPool.length * this.config.pagesPerBrowser;

    // If browser instances changed OR we need more browsers for concurrency
    if ((sanitized.browserInstances !== undefined && sanitized.browserInstances !== oldBrowserInstances) ||
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

  getSupabaseWriteState(): SupabaseWriteSnapshot {
    return this.supabaseWriter.getSnapshot();
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
      const mergedSelectors = Array.from(new Set([
        ...selectors,
        ...(this.config.additionalScreenshotSelectors || [])
      ]));
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

        browserResult = await this.scrapeTemplateInBrowser(pageInfo.page, url, index, mergedSelectors);
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
              index
            );

            successful++;
            this.recordOperation(true);

            this.emit('template-complete', {
              url,
              name: browserResult.data.name || browserResult.slug,
              slug: browserResult.slug,
              success: true,
              screenshotPath: saveResult.screenshotPath
            });

            if (saveResult.screenshotPath) {
              this.emit('screenshot-captured', {
                name: browserResult.data.name || browserResult.slug,
                slug: browserResult.slug,
                screenshotPath: saveResult.screenshotPath,
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
              success: false,
              error: errorMsg
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
            success: false,
            error: browserResult.error
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

  private async isLikelyBlankScreenshot(buffer: Buffer): Promise<boolean> {
    try {
      const stats = await sharp(buffer).stats();
      const channels = stats.channels.slice(0, 3);
      if (channels.length === 0) return false;
      const avgMean = channels.reduce((sum, c) => sum + c.mean, 0) / channels.length;
      const avgStdev = channels.reduce((sum, c) => sum + c.stdev, 0) / channels.length;
      return avgStdev < 1.5 && (avgMean > 250 || avgMean < 5);
    } catch {
      return false;
    }
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
      if (this.jobMode === 'screenshots_only') {
        const entry = this.templateIndex.get(slug);
        if (!entry || !entry.live_preview_url) {
          throw new Error(`Template ${slug} not found in Supabase index (or missing live_preview_url)`);
        }

        if (this.currentBatch[batchIndex]) {
          this.currentBatch[batchIndex].name = entry.name || slug;
        }

        this.updatePhase(batchIndex, 'taking_screenshot');
        this.log('info', `[screenshots-only] Capturing: ${slug}`);

        const isFeaturedAuthor = entry.author_id ? this.featuredAuthorIds.has(entry.author_id) : false;

        const previewNavResult = await this.navigateWithRetry(page, entry.live_preview_url, 2);
        if (!previewNavResult.success) {
          throw new Error(previewNavResult.error || 'Preview navigation failed');
        }

        let screenshotUrl = entry.live_preview_url;
        let isAlternateHomepage = false;
        let alternateHomepagePath: string | null = null;

        if (this.config.forceScreenshotUrl) {
          const base = new URL(entry.live_preview_url);
          const forced = new URL(this.config.forceScreenshotUrl, base.origin);
          if (forced.origin !== base.origin) {
            throw new Error(`forceScreenshotUrl must be on the same origin as live_preview_url (${base.origin})`);
          }
          screenshotUrl = forced.toString();
          const pathA = base.pathname.replace(/\/+$/, '') || '/';
          const pathB = forced.pathname.replace(/\/+$/, '') || '/';
          isAlternateHomepage = pathA !== pathB;
          alternateHomepagePath = isAlternateHomepage ? forced.pathname : null;

          const forcedNavResult = await this.navigateWithRetry(page, screenshotUrl, 2);
          if (!forcedNavResult.success) {
            throw new Error(forcedNavResult.error || 'Forced screenshot navigation failed');
          }
        } else {
          const homepageDetection = await detectHomepage(page, entry.live_preview_url);
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
        }

        if (this.config.skipIfMissingRequiredSelectors && (this.config.requiredSelectors || []).length > 0) {
          const hasSelector = await this.pageHasAnySelector(page, this.config.requiredSelectors || []);
          if (!hasSelector) {
            const reason = 'Required selector not found; skipping screenshot';
            this.log('info', `[screenshots-only] ${slug}: ${reason}`);
            this.updatePhase(batchIndex, 'skipped');
            return {
              success: true,
              slug,
              templateRowId: entry.id,
              skipped: true,
              skipReason: reason,
              data: {
                name: entry.name || slug,
                authorId: entry.author_id,
                authorName: entry.author_name,
                authorAvatar: entry.author_avatar,
                livePreviewUrl: entry.live_preview_url,
                designerPreviewUrl: '',
                price: '',
                shortDescription: '',
                longDescription: '',
                subcategories: [],
                styles: [],
                features: [],
                isCms: false,
                isEcommerce: false,
              },
              isFeaturedAuthor,
              screenshotBuffer: null,
              screenshotUrl,
              isAlternateHomepage,
              alternateHomepagePath
            };
          }
        }

        const effectiveSelectors = await this.getEffectiveScreenshotSelectors(screenshotSelectors, entry.author_id);

        await preparePageForScreenshot(page, {
          loadTimeoutMs: this.config.timeout,
          animationWaitMs: this.config.screenshotAnimationWaitMs,
          scrollDelayMs: 150,
          elementsToRemove: effectiveSelectors,
          enableScroll: false,
          nudgeScrollRatio: this.config.screenshotNudgeScrollRatio,
          nudgeWaitMs: this.config.screenshotNudgeWaitMs,
          nudgeAfterMs: this.config.screenshotNudgeAfterMs,
          ensureAnimationsSettled: true,
          stabilityStableMs: this.config.screenshotStabilityStableMs,
          stabilityMaxWaitMs: this.config.screenshotStabilityMaxWaitMs,
          stabilityCheckIntervalMs: this.config.screenshotStabilityCheckIntervalMs
        });

        const screenshotBuffer = await page.screenshot({
          type: 'jpeg',
          quality: Math.min(100, Math.max(1, this.config.screenshotJpegQuality)),
          fullPage: false
        });

        if (!screenshotBuffer || screenshotBuffer.length === 0) {
          throw new Error('Screenshot capture returned empty buffer');
        }

        if (await this.isLikelyBlankScreenshot(screenshotBuffer)) {
          throw new Error('Screenshot looked blank');
        }

        return {
          success: true,
          slug,
          templateRowId: entry.id,
          data: {
            name: entry.name || slug,
            authorId: entry.author_id,
            authorName: entry.author_name,
            authorAvatar: entry.author_avatar,
            livePreviewUrl: entry.live_preview_url,
            designerPreviewUrl: '',
            price: '',
            shortDescription: '',
            longDescription: '',
            subcategories: [],
            styles: [],
            features: [],
            isCms: false,
            isEcommerce: false,
          },
          isFeaturedAuthor,
          screenshotBuffer,
          screenshotUrl,
          isAlternateHomepage,
          alternateHomepagePath
        };
      }

      this.log('info', `Scraping: ${slug}`);

      const disableLightweight = await this.enableLightweightMode(page);
      const navResult = await this.navigateWithRetry(page, url, 2);
      if (!navResult.success) {
        throw new Error(navResult.error || 'Navigation failed');
      }

      this.updatePhase(batchIndex, 'scraping_details');

      const data = await page.evaluate(() => {
        const normalizeWhitespace = (value: string | null | undefined) =>
          (value || '').replace(/\s+/g, ' ').trim();
        const stripWebflowSuffix = (value: string) =>
          value
            .replace(/\s+[-–—]\s*Webflow.*$/i, '')
            .replace(/\s+\|\s*Webflow.*$/i, '')
            .trim();
        const isPlaceholderName = (value: string) => {
          const lower = value.toLowerCase();
          return (
            !value ||
            lower === 'customize this template' ||
            lower === 'preview in webflow' ||
            lower === 'get this template'
          );
        };
        const pickName = () => {
          const candidates = [
            document.querySelector('meta[property="og:title"]')?.getAttribute('content'),
            document.querySelector('meta[name="twitter:title"]')?.getAttribute('content'),
            document.querySelector('.product-hero_heading')?.textContent,
            document.querySelector('.product-hero_title')?.textContent,
            document.querySelector('.product-hero__title')?.textContent,
            document.querySelector('.product-hero h1')?.textContent,
            document.querySelector('h1')?.textContent,
            document.title,
          ];

          for (const candidate of candidates) {
            const cleaned = stripWebflowSuffix(normalizeWhitespace(candidate));
            if (cleaned && !isPlaceholderName(cleaned)) return cleaned;
          }
          return '';
        };

        const name = pickName();

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

        // Extract PRIMARY CATEGORIES from /templates/category/ links
        // These are the main categories like "Travel", "Architecture & Design"
        const primaryCategory: string[] = [];
        document.querySelectorAll('a[href*="/templates/category/"]').forEach(el => {
          // Filter out "Browse all" buttons by checking classes
          const classes = el.className || '';
          if (classes.includes('button')) return;
          const text = el.textContent?.trim();
          // Filter out "Browse all" navigation links
          if (text && !primaryCategory.includes(text) && text.toLowerCase() !== 'browse all') {
            primaryCategory.push(text);
          }
        });

        // Extract WEBFLOW SUBCATEGORIES from /templates/subcategory/ links
        // These are more specific like "Hotels & Lodging", "Interior Design"
        const webflowSubcategories: string[] = [];
        document.querySelectorAll('a[href*="/templates/subcategory/"]').forEach(el => {
          const text = el.textContent?.trim();
          // Filter out "Browse all" navigation links
          if (text && !webflowSubcategories.includes(text) && text.toLowerCase() !== 'browse all') {
            webflowSubcategories.push(text);
          }
        });

        // Legacy subcategories extraction (kept for backward compatibility with junction tables)
        const subcategoryEls = document.querySelectorAll('#subcategory .tag-list_link, .tag-list_link');
        const subcategories: string[] = [];
        subcategoryEls.forEach(el => {
          const text = el.textContent?.trim();
          if (text) subcategories.push(text);
        });

        // Extract STYLES from /templates/style/ links
        const styles: string[] = [];
        document.querySelectorAll('a[href*="/templates/style/"]').forEach(el => {
          const text = el.textContent?.trim();
          if (text && !styles.includes(text)) styles.push(text);
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

        // Extract PUBLISH DATE from the storefront page
        // The date is typically displayed in format "Dec 24, 2025"
        let publishDateRaw: string | null = null;

        // Strategy 1: Look for elements with "publish" in class name
        const publishElements = document.querySelectorAll('[class*="publish"]');
        for (const el of publishElements) {
          const text = el.textContent?.trim();
          if (text && /\w{3}\s+\d{1,2},?\s+\d{4}/.test(text)) {
            publishDateRaw = text;
            break;
          }
        }

        // Strategy 2: Search all text nodes for standalone date pattern
        if (!publishDateRaw) {
          const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_TEXT,
            null
          );
          let node;
          while ((node = walker.nextNode())) {
            const text = node.textContent?.trim();
            if (text) {
              const dateMatch = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i);
              if (dateMatch) {
                publishDateRaw = dateMatch[0];
                break;
              }
            }
          }
        }

        // Strategy 3: Look for any element containing just a date
        if (!publishDateRaw) {
          const allElements = document.querySelectorAll('div, span, p, time');
          for (const el of allElements) {
            const directText = Array.from(el.childNodes)
              .filter(n => n.nodeType === Node.TEXT_NODE)
              .map(n => n.textContent?.trim())
              .join(' ')
              .trim();

            const dateMatch = directText.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i);
            if (dateMatch) {
              publishDateRaw = dateMatch[0];
              break;
            }
          }
        }

        // Parse the date string to ISO format (YYYY-MM-DD)
        let publishDate: string | null = null;
        if (publishDateRaw) {
          const months: { [key: string]: number } = {
            'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
            'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
          };
          const match = publishDateRaw.match(/(\w{3})\s+(\d{1,2}),?\s+(\d{4})/i);
          if (match) {
            const [, monthStr, day, year] = match;
            const monthNum = months[monthStr.toLowerCase()];
            if (monthNum !== undefined) {
              const d = new Date(parseInt(year), monthNum, parseInt(day));
              publishDate = d.toISOString().split('T')[0];
            }
          }
        }

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
          isEcommerce,
          primaryCategory,
          webflowSubcategories,
          publishDate
        };
      }) as ScrapedData;

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

        const effectiveSelectors = await this.getEffectiveScreenshotSelectors(screenshotSelectors, data.authorId);

        await preparePageForScreenshot(page, {
          loadTimeoutMs: this.config.timeout,
          animationWaitMs: this.config.screenshotAnimationWaitMs,
          scrollDelayMs: 150,
          elementsToRemove: effectiveSelectors,
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

	        if (screenshotBuffer && screenshotBuffer.length < 25_000 && await this.isLikelyBlankScreenshot(screenshotBuffer)) {
	          this.log('warn', `Screenshot looked blank for ${slug}, retrying once...`);
	          try {
	            await page.waitForTimeout(1500);
	            const retry = await page.screenshot({
	              type: 'jpeg',
	              quality: Math.min(100, Math.max(1, this.config.screenshotJpegQuality)),
	              fullPage: false
	            });
	            if (!await this.isLikelyBlankScreenshot(retry)) {
	              screenshotBuffer = retry;
	            } else {
	              screenshotBuffer = null;
	              this.log('warn', `Screenshot still blank for ${slug}, skipping screenshot for this template`);
	            }
	          } catch (retryError) {
	            const retryMsg = retryError instanceof Error ? retryError.message : 'Unknown error';
	            this.log('warn', `Screenshot retry failed for ${slug}: ${retryMsg}`);
	            screenshotBuffer = null;
	          }
	        }
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
    batchIndex: number
  ): Promise<{ screenshotPath?: string }> {
    const { slug, data } = result;

    let screenshotPath: string | null = null;

    if (result.screenshotBuffer) {
      this.updatePhase(batchIndex, 'processing_screenshot');
      await this.imageSemaphore.acquire();
      try {
        const screenshotWebpQuality = Math.min(100, Math.max(1, this.config.screenshotWebpQuality));

        // Process image in memory (no local filesystem)
        const processedBuffer = await sharp(result.screenshotBuffer)
          .resize(MAX_SCREENSHOT_WIDTH, MAX_SCREENSHOT_HEIGHT, {
            withoutEnlargement: true,
            fit: 'inside'
          })
          .webp({ quality: screenshotWebpQuality })
          .toBuffer();

        if (!processedBuffer.length || processedBuffer.length < 10_000) {
          this.log('warn', `Screenshot buffer too small for ${slug} (${processedBuffer.length} bytes)`);
        } else {
          // Upload directly to R2
          const r2Url = await this.uploadScreenshotToR2Storage(slug, processedBuffer);
          if (r2Url) {
            // Store the R2 public URL as the screenshot path
            screenshotPath = this.withCacheBuster(r2Url);
            this.log('info', `Screenshot uploaded for ${slug} → ${screenshotPath} (${processedBuffer.length} bytes)`);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        this.log('warn', `Image processing failed for ${slug}: ${errorMsg}`);
        screenshotPath = null;
      } finally {
        this.imageSemaphore.release();
      }
    } else {
      this.log('warn', `No screenshot captured for ${slug}`);
    }

    this.updatePhase(batchIndex, 'saving');

    if (this.jobMode === 'screenshots_only') {
      if (!result.templateRowId) {
        throw new Error('screenshots_only mode requires templateRowId');
      }
      if (result.skipped) {
        this.updatePhase(batchIndex, 'skipped');
        this.log('info', `Skipped (screenshots-only): ${slug}${result.skipReason ? ` (${result.skipReason})` : ''}`);
        return {};
      }
      if (!screenshotPath) {
        throw new Error('Screenshot processing failed (no screenshotPath)');
      }

      await supabaseAdmin
        .from('templates')
        .update({
          screenshot_path: screenshotPath,
          screenshot_thumbnail_path: null,
          screenshot_url: result.screenshotUrl,
          is_alternate_homepage: result.isAlternateHomepage,
          alternate_homepage_path: result.alternateHomepagePath,
          updated_at: new Date().toISOString(),
        })
        .eq('id', result.templateRowId);

      this.updatePhase(batchIndex, 'completed');
      this.log('info', `Completed (screenshots-only): ${slug}`);

      return { screenshotPath };
    }

    const templateId = `wf_${slug}`;
    const now = new Date().toISOString();
    this.emit('supabase-state', this.supabaseWriter.getSnapshot());

    await this.supabaseWriter.enqueue({
      template: {
        template_id: templateId,
        name: data.name || slug,
        slug,
        author_name: data.authorName,
        author_id: data.authorId,
        author_avatar: data.authorAvatar,
        storefront_url: storefrontUrl,
        live_preview_url: data.livePreviewUrl,
        designer_preview_url: data.designerPreviewUrl || null,
        price: data.price || null,
        short_description: data.shortDescription || null,
        long_description: data.longDescription || null,
        ...(screenshotPath ? { screenshot_path: screenshotPath } : {}),
        screenshot_thumbnail_path: null,
        is_featured: result.isFeaturedAuthor,
        is_cms: data.isCms,
        is_ecommerce: data.isEcommerce,
        screenshot_url: result.screenshotUrl,
        is_alternate_homepage: result.isAlternateHomepage,
        alternate_homepage_path: result.alternateHomepagePath,
        scraped_at: now,
        updated_at: now,
        // New Webflow category fields
        primary_category: Array.isArray((data as ScrapedData).primaryCategory) && (data as ScrapedData).primaryCategory.length > 0
          ? (data as ScrapedData).primaryCategory
          : null,
        webflow_subcategories: Array.isArray((data as ScrapedData).webflowSubcategories) && (data as ScrapedData).webflowSubcategories.length > 0
          ? (data as ScrapedData).webflowSubcategories
          : null,
        // Template publish date
        publish_date: (data as ScrapedData).publishDate || null,
      },
      subcategories: Array.isArray(data.subcategories) ? data.subcategories : [],
      styles: Array.isArray(data.styles) ? data.styles : [],
      features: Array.isArray(data.features) ? data.features : [],
    });

    this.emit('supabase-state', this.supabaseWriter.getSnapshot());

    this.updatePhase(batchIndex, 'completed');
    this.log('info', `Completed: ${slug}`);

    return screenshotPath ? { screenshotPath } : {};
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
    this.emit('state-change', this.scrapeState);
    this.log('info', 'Scrape state cleared');
  }
}
