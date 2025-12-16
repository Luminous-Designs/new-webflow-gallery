import { chromium, Browser, Page, BrowserContext } from 'playwright';
import sharp from 'sharp';
import { preparePageForScreenshot } from '../screenshot/prepare';
import {
  db,
  getActiveScreenshotExclusions,
  createScrapeSession,
  createBatch,
  updateBatchTemplateStatus,
  updateBatchProgress,
  updateSessionProgress,
  getBatchTemplates,
  getCurrentBatch,
  getSession,
  startBatch,
  completeBatch,
  completeSession,
  updateSessionCurrentBatch,
  getBlacklistSet,
  blacklistTemplate,
  saveResumePoint,
  pauseSession,
  resumeSession,
  getInterruptedSession,
  runAlternateHomepageMigration,
  ScrapeSession,
  ScrapeBatch,
  BatchTemplate,
  ScrapeSessionType,
  BatchTemplateStatus,
  ScrapeSessionConfig,
  extractDomainSlug
} from '../db';
import { detectHomepage, HomepageDetectionResult } from './homepage-detector';
import path from 'path';
import { promises as fs } from 'fs';
import axios from 'axios';
import { EventEmitter } from 'events';

interface BatchScraperOptions {
  concurrency?: number;
  browserInstances?: number;
  pagesPerBrowser?: number;
  timeout?: number;
  screenshotQuality?: number;
  headless?: boolean;
  viewport?: { width: number; height: number };
  batchSize?: number;
}

interface TemplateData {
  template_id: string;
  name: string;
  slug: string;
  author_name?: string;
  author_id?: string;
  author_avatar?: string;
  storefront_url: string;
  live_preview_url: string;
  designer_preview_url?: string;
  price?: string;
  short_description?: string;
  long_description?: string;
  subcategories: string[];
  styles: string[];
  features: Array<{ name: string; description?: string; icon_type?: string }>;
  is_cms: boolean;
  is_ecommerce: boolean;
  screenshot_path?: string;
  screenshot_thumbnail_path?: string;
  // Alternate homepage detection fields
  screenshot_url?: string;
  is_alternate_homepage?: boolean;
  alternate_homepage_path?: string;
}

export interface BatchProgressEvent {
  sessionId: number;
  batchNumber: number;
  totalBatches: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  total: number;
}

export interface TemplatePhaseEvent {
  sessionId: number;
  batchId: number;
  templateId: number;
  templateUrl: string;
  templateSlug?: string;
  templateName?: string;
  livePreviewUrl?: string;
  phase: BatchTemplateStatus;
  phaseStartedAt: string;
}

export interface PerformanceConfig {
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
  timeout: number;
}

export interface ConfigChangeEvent {
  current: PerformanceConfig;
  pending: PerformanceConfig | null;
  appliedAt?: string;
}

export class BatchScraper extends EventEmitter {
  private browsers: Browser[] = [];
  private options: Required<BatchScraperOptions>;
  private pendingOptions: Partial<BatchScraperOptions> | null = null;
  private screenshotDir = './public/screenshots';
  private thumbnailDir = './public/thumbnails';
  private browserIndex = 0;
  private isPaused = false;
  private shouldStop = false;
  private currentSessionId: number | null = null;
  private currentBatchNumber: number = 0;
  private blacklistSet: Set<string> = new Set();
  private skipRequests: Set<number> = new Set(); // Template IDs to skip

  constructor(options: BatchScraperOptions = {}) {
    super();
    const concurrency = options.concurrency || parseInt(process.env.SCRAPER_CONCURRENCY || '5');
    const browserInstances = options.browserInstances || 1;
    const pagesPerBrowser = options.pagesPerBrowser || Math.ceil(concurrency / browserInstances);

    this.options = {
      concurrency,
      browserInstances,
      pagesPerBrowser,
      timeout: options.timeout || parseInt(process.env.SCRAPER_TIMEOUT || '30000'),
      screenshotQuality: options.screenshotQuality || parseInt(process.env.SCREENSHOT_QUALITY || '85'),
      headless: options.headless !== false,
      viewport: options.viewport || { width: 1600, height: 1000 },
      batchSize: options.batchSize || 10
    };

    console.log('\n=== BatchScraper Configured ===');
    console.log(`Concurrency: ${this.options.concurrency}`);
    console.log(`Browsers: ${this.options.browserInstances}`);
    console.log(`Pages/Browser: ${this.options.pagesPerBrowser}`);
    console.log(`Batch Size: ${this.options.batchSize}`);
    console.log('================================\n');
  }

  /**
   * Get current performance configuration
   */
  getCurrentConfig(): PerformanceConfig {
    return {
      concurrency: this.options.concurrency,
      browserInstances: this.options.browserInstances,
      pagesPerBrowser: this.options.pagesPerBrowser,
      batchSize: this.options.batchSize,
      timeout: this.options.timeout
    };
  }

  /**
   * Get pending configuration that will apply on the next batch
   */
  getPendingConfig(): PerformanceConfig | null {
    if (!this.pendingOptions) return null;
    return {
      concurrency: this.pendingOptions.concurrency ?? this.options.concurrency,
      browserInstances: this.pendingOptions.browserInstances ?? this.options.browserInstances,
      pagesPerBrowser: this.pendingOptions.pagesPerBrowser ?? this.options.pagesPerBrowser,
      batchSize: this.pendingOptions.batchSize ?? this.options.batchSize,
      timeout: this.pendingOptions.timeout ?? this.options.timeout
    };
  }

  /**
   * Get current batch number
   */
  getCurrentBatchNumber(): number {
    return this.currentBatchNumber;
  }

  /**
   * Schedule performance config changes for the next batch
   */
  updatePendingConfig(newConfig: Partial<PerformanceConfig>): ConfigChangeEvent {
    this.pendingOptions = {
      ...this.pendingOptions,
      ...newConfig
    };

    const event: ConfigChangeEvent = {
      current: this.getCurrentConfig(),
      pending: this.getPendingConfig()
    };

    this.emit('config-pending', event);
    this.emit('log', {
      message: `Performance config scheduled for next batch: ${JSON.stringify(newConfig)}`
    });

    return event;
  }

  /**
   * Cancel pending config changes
   */
  cancelPendingConfig(): void {
    this.pendingOptions = null;
    this.emit('config-cancelled', {
      current: this.getCurrentConfig(),
      pending: null
    });
  }

  /**
   * Apply pending config (called between batches)
   */
  private async applyPendingConfig(): Promise<boolean> {
    if (!this.pendingOptions) return false;

    const needsBrowserRestart =
      this.pendingOptions.browserInstances !== undefined &&
      this.pendingOptions.browserInstances !== this.options.browserInstances;

    // Apply config changes
    if (this.pendingOptions.concurrency !== undefined) {
      this.options.concurrency = this.pendingOptions.concurrency;
    }
    if (this.pendingOptions.batchSize !== undefined) {
      this.options.batchSize = this.pendingOptions.batchSize;
    }
    if (this.pendingOptions.pagesPerBrowser !== undefined) {
      this.options.pagesPerBrowser = this.pendingOptions.pagesPerBrowser;
    }
    if (this.pendingOptions.timeout !== undefined) {
      this.options.timeout = this.pendingOptions.timeout;
    }

    // Handle browser instance changes
    if (needsBrowserRestart) {
      this.emit('log', { message: 'Restarting browsers for new instance count...' });
      await this.close();
      this.options.browserInstances = this.pendingOptions.browserInstances!;

      const browserPromises = [];
      for (let i = 0; i < this.options.browserInstances; i++) {
        browserPromises.push(
          chromium.launch({
            headless: this.options.headless,
            args: [
              '--disable-blink-features=AutomationControlled',
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
              '--max_old_space_size=4096'
            ]
          })
        );
      }
      this.browsers = await Promise.all(browserPromises);
      this.browserIndex = 0;
    }

    const event: ConfigChangeEvent = {
      current: this.getCurrentConfig(),
      pending: null,
      appliedAt: new Date().toISOString()
    };

    this.pendingOptions = null;
    this.emit('config-applied', event);
    this.emit('log', { message: `Applied new performance config: ${JSON.stringify(this.getCurrentConfig())}` });

    return true;
  }

  async init() {
    console.log('Initializing BatchScraper...');
    await this.ensureDirectories();

    // Run database migration for alternate homepage columns
    console.log('Running alternate homepage migration...');
    await runAlternateHomepageMigration();

    // Load blacklist
    this.blacklistSet = await getBlacklistSet();
    console.log(`Loaded ${this.blacklistSet.size} blacklisted templates`);

    // Launch browsers
    const browserPromises = [];
    for (let i = 0; i < this.options.browserInstances; i++) {
      browserPromises.push(
        chromium.launch({
          headless: this.options.headless,
          args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--max_old_space_size=4096'
          ]
        })
      );
    }

    this.browsers = await Promise.all(browserPromises);
    console.log(`${this.browsers.length} browser(s) launched`);
    this.emit('log', { message: `BatchScraper initialized with batch size ${this.options.batchSize}` });
  }

  private async ensureDirectories() {
    await fs.mkdir(this.screenshotDir, { recursive: true });
    await fs.mkdir(this.thumbnailDir, { recursive: true });
  }

  async close() {
    console.log('Closing BatchScraper...');
    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
    this.browsers = [];
  }

  private getNextBrowser(): Browser {
    const browser = this.browsers[this.browserIndex];
    this.browserIndex = (this.browserIndex + 1) % this.browsers.length;
    return browser;
  }

  /**
   * Request to skip a template during scraping
   */
  requestSkip(templateId: number) {
    this.skipRequests.add(templateId);
    this.emit('log', { message: `Skip requested for template ${templateId}` });
  }

  /**
   * Pause the current session
   */
  async pause() {
    if (this.currentSessionId) {
      this.isPaused = true;
      await pauseSession(this.currentSessionId);
      this.emit('session-paused', { sessionId: this.currentSessionId });
    }
  }

  /**
   * Resume a paused session
   */
  async resume() {
    if (this.currentSessionId) {
      this.isPaused = false;
      await resumeSession(this.currentSessionId);
      this.emit('session-resumed', { sessionId: this.currentSessionId });
    }
  }

  /**
   * Stop the current session
   */
  async stop() {
    this.shouldStop = true;
    if (this.currentSessionId) {
      await completeSession(this.currentSessionId, 'cancelled');
      this.emit('session-cancelled', { sessionId: this.currentSessionId });
    }
  }

  /**
   * Fetch sitemap URLs
   */
  async fetchSitemapUrls(): Promise<string[]> {
    this.emit('log', { message: 'Fetching sitemap...' });
    const sitemapUrl = 'https://templates.webflow.com/sitemap.xml';
    const response = await axios.get(sitemapUrl);
    const xml = response.data;

    const htmlTemplateRegex = /<loc>(https:\/\/templates\.webflow\.com\/html\/[^<]+)<\/loc>/g;
    const urls: string[] = [];
    let match;
    while ((match = htmlTemplateRegex.exec(xml)) !== null) {
      urls.push(match[1]);
    }

    this.emit('log', { message: `Found ${urls.length} templates in sitemap` });
    return urls;
  }

  /**
   * Start a new batched scrape session
   */
  async startBatchedScrape(
    sessionType: ScrapeSessionType,
    urls: string[]
  ): Promise<ScrapeSession> {
    // Filter out blacklisted URLs
    const filteredUrls = urls.filter(url => {
      const slug = url.split('/').pop()?.replace('-website-template', '') || '';
      return !this.blacklistSet.has(slug);
    });

    const config: ScrapeSessionConfig = {
      concurrency: this.options.concurrency,
      browserInstances: this.options.browserInstances,
      pagesPerBrowser: this.options.pagesPerBrowser,
      batchSize: this.options.batchSize
    };

    // Create session
    const session = await createScrapeSession(sessionType, filteredUrls, config);
    this.currentSessionId = session.id!;

    this.emit('session-started', {
      sessionId: session.id,
      totalTemplates: filteredUrls.length,
      totalBatches: session.total_batches,
      batchSize: this.options.batchSize
    });

    // Create batches
    const batches: ScrapeBatch[] = [];
    for (let i = 0; i < session.total_batches; i++) {
      const start = i * this.options.batchSize;
      const end = Math.min(start + this.options.batchSize, filteredUrls.length);
      const batchUrls = filteredUrls.slice(start, end);

      const batch = await createBatch(session.id!, i + 1, batchUrls);
      batches.push(batch);
    }

    // Start processing batches
    await this.processBatches(session.id!, batches);

    return session;
  }

  /**
   * Resume an interrupted session
   */
  async resumeInterruptedSession(): Promise<ScrapeSession | null> {
    const session = await getInterruptedSession();
    if (!session) {
      this.emit('log', { message: 'No interrupted session found' });
      return null;
    }

    this.currentSessionId = session.id!;
    this.emit('session-resumed', { sessionId: session.id });

    // Get remaining batches
    const allBatches = await db.allAsync<ScrapeBatch>(
      'SELECT * FROM scrape_batches WHERE session_id = ? ORDER BY batch_number',
      [session.id]
    );

    // Find batches that need processing (pending or running)
    const remainingBatches = allBatches.filter(
      b => b.status === 'pending' || b.status === 'running' || b.status === 'paused'
    );

    if (remainingBatches.length === 0) {
      await completeSession(session.id!);
      return session;
    }

    await resumeSession(session.id!);
    await this.processBatches(session.id!, remainingBatches);

    return session;
  }

  /**
   * Process multiple batches sequentially
   */
  private async processBatches(sessionId: number, batches: ScrapeBatch[]) {
    for (const batch of batches) {
      if (this.shouldStop) break;

      // Wait while paused
      while (this.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.shouldStop) break;
      }

      // Apply any pending config changes before starting the batch
      if (this.pendingOptions) {
        await this.applyPendingConfig();
      }

      // Track current batch number
      this.currentBatchNumber = batch.batch_number;

      await this.processSingleBatch(sessionId, batch);

      // Save resume point after each batch
      await saveResumePoint(sessionId, batch.id);
    }

    if (!this.shouldStop) {
      await completeSession(sessionId);
      this.emit('session-completed', { sessionId });
    }
  }

  /**
   * Process a single batch
   */
  private async processSingleBatch(sessionId: number, batch: ScrapeBatch) {
    console.log(`\n=== Processing Batch ${batch.batch_number} ===`);

    await startBatch(batch.id!);
    await updateSessionCurrentBatch(sessionId, batch.batch_number);

    this.emit('batch-started', {
      sessionId,
      batchId: batch.id,
      batchNumber: batch.batch_number,
      totalTemplates: batch.total_templates
    });

    const templates = await getBatchTemplates(batch.id!);
    const pendingTemplates = templates.filter(t => t.status === 'pending');

    // Process templates with concurrency
    const workerQueue = [...pendingTemplates];
    const workers: Promise<void>[] = [];

    for (let i = 0; i < Math.min(this.options.concurrency, pendingTemplates.length); i++) {
      workers.push(this.batchWorker(i, sessionId, batch.id!, workerQueue));
    }

    await Promise.all(workers);

    await completeBatch(batch.id!);

    this.emit('batch-completed', {
      sessionId,
      batchId: batch.id,
      batchNumber: batch.batch_number
    });
  }

  /**
   * Worker that processes templates from the queue
   */
  private async batchWorker(
    workerId: number,
    sessionId: number,
    batchId: number,
    queue: BatchTemplate[]
  ) {
    const browser = this.getNextBrowser();
    let context: BrowserContext | null = null;
    let contextUseCount = 0;
    const maxContextUses = 5;

    while (queue.length > 0 && !this.shouldStop) {
      // Wait while paused
      while (this.isPaused) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        if (this.shouldStop) break;
      }

      const template = queue.shift();
      if (!template) break;

      // Check if skip was requested
      if (this.skipRequests.has(template.id!)) {
        this.skipRequests.delete(template.id!);
        await this.skipTemplate(template, sessionId, batchId);
        continue;
      }

      try {
        // Create/recreate context
        if (!context || contextUseCount >= maxContextUses) {
          if (context) {
            await context.close().catch(() => {});
          }
          context = await browser.newContext({
            viewport: this.options.viewport,
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          });
          contextUseCount = 0;
        }
        contextUseCount++;

        await this.processTemplate(template, context, sessionId, batchId);

      } catch (error) {
        console.error(`Worker ${workerId} error:`, error);
        await this.handleTemplateError(template, sessionId, batchId, error);

        if (context) {
          await context.close().catch(() => {});
          context = null;
        }
      }
    }

    if (context) {
      await context.close().catch(() => {});
    }
  }

  /**
   * Process a single template with phase tracking
   */
  private async processTemplate(
    template: BatchTemplate,
    context: BrowserContext,
    sessionId: number,
    batchId: number
  ) {
    const templateId = template.id!;

    // Phase 1: Scraping Details
    await this.emitPhaseChange(template, 'scraping_details', sessionId, batchId);

    let page: Page | null = null;
    try {
      page = await context.newPage();
      page.setDefaultTimeout(this.options.timeout);

      await page.goto(template.template_url, {
        waitUntil: 'domcontentloaded',
        timeout: this.options.timeout
      });

      const templateData = await this.extractTemplateData(page, template.template_url);

      await updateBatchTemplateStatus(templateId, 'scraping_details', {
        template_name: templateData.name,
        live_preview_url: templateData.live_preview_url
      });

      // Check if blacklisted by live preview URL
      const domainSlug = extractDomainSlug(templateData.live_preview_url);
      if (domainSlug && this.blacklistSet.has(domainSlug)) {
        await this.skipTemplate(template, sessionId, batchId, false);
        await page.close();
        return;
      }

      // Phase 2: Taking Screenshot (includes homepage detection)
      await this.emitPhaseChange(template, 'taking_screenshot', sessionId, batchId, {
        template_name: templateData.name,
        live_preview_url: templateData.live_preview_url
      });

      const screenshotResult = await this.takeTemplateScreenshot(page, templateData);
      templateData.screenshot_path = screenshotResult.full;
      templateData.screenshot_thumbnail_path = screenshotResult.thumbnail;

      // Store homepage detection results
      templateData.screenshot_url = screenshotResult.homepageDetection.screenshotUrl;
      templateData.is_alternate_homepage = screenshotResult.homepageDetection.isAlternateHomepage;
      templateData.alternate_homepage_path = screenshotResult.homepageDetection.detectedPath;

      // Phase 3: Saving
      await this.emitPhaseChange(template, 'saving', sessionId, batchId);

      const savedTemplateId = await this.saveTemplateToDatabase(templateData);

      // Phase 4: Completed
      await updateBatchTemplateStatus(templateId, 'completed', {
        result_template_id: savedTemplateId
      });

      await updateBatchProgress(batchId, { processed: 1, successful: 1 });
      await updateSessionProgress(sessionId, { processed: 1, successful: 1 });

      this.emit('template-completed', {
        sessionId,
        batchId,
        templateId,
        templateUrl: template.template_url,
        templateName: templateData.name,
        livePreviewUrl: templateData.live_preview_url,
        isAlternateHomepage: templateData.is_alternate_homepage
      });

    } finally {
      if (page) {
        await page.close().catch(() => {});
      }
    }
  }

  /**
   * Skip a template and optionally blacklist it
   */
  private async skipTemplate(
    template: BatchTemplate,
    sessionId: number,
    batchId: number,
    shouldBlacklist: boolean = true
  ) {
    await updateBatchTemplateStatus(template.id!, 'skipped');
    await updateBatchProgress(batchId, { processed: 1, skipped: 1 });
    await updateSessionProgress(sessionId, { processed: 1, skipped: 1 });

    if (shouldBlacklist && template.live_preview_url) {
      await blacklistTemplate(template.live_preview_url, template.template_url, 'manual_skip');
      const domainSlug = extractDomainSlug(template.live_preview_url);
      if (domainSlug) {
        this.blacklistSet.add(domainSlug);
      }
    }

    this.emit('template-skipped', {
      sessionId,
      batchId,
      templateId: template.id,
      templateUrl: template.template_url
    });
  }

  /**
   * Handle template processing error
   */
  private async handleTemplateError(
    template: BatchTemplate,
    sessionId: number,
    batchId: number,
    error: unknown
  ) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    await updateBatchTemplateStatus(template.id!, 'failed', {
      error_message: errorMessage
    });

    await updateBatchProgress(batchId, { processed: 1, failed: 1 });
    await updateSessionProgress(sessionId, { processed: 1, failed: 1 });

    this.emit('template-failed', {
      sessionId,
      batchId,
      templateId: template.id,
      templateUrl: template.template_url,
      error: errorMessage
    });
  }

  /**
   * Emit a phase change event
   */
  private async emitPhaseChange(
    template: BatchTemplate,
    phase: BatchTemplateStatus,
    sessionId: number,
    batchId: number,
    additionalData?: { template_name?: string; live_preview_url?: string }
  ) {
    await updateBatchTemplateStatus(template.id!, phase, additionalData);

    this.emit('template-phase-change', {
      sessionId,
      batchId,
      templateId: template.id,
      templateUrl: template.template_url,
      templateSlug: template.template_slug,
      templateName: additionalData?.template_name || template.template_name,
      livePreviewUrl: additionalData?.live_preview_url || template.live_preview_url,
      phase,
      phaseStartedAt: new Date().toISOString()
    } as TemplatePhaseEvent);
  }

  /**
   * Extract template data from page
   */
  private async extractTemplateData(page: Page, url: string): Promise<TemplateData> {
    const data = await page.evaluate((storefrontUrl) => {
      const nameElement = document.querySelector('.h4') || document.querySelector('h1');
      const fullName = nameElement?.textContent?.trim() || '';
      const name = fullName.replace(/ - .+ Website Template$/, '');

      const urlParts = storefrontUrl.split('/');
      const slug = urlParts[urlParts.length - 1].replace('-website-template', '');

      const authorLink = document.querySelector('.template-designer-link');
      const authorName = document.querySelector('.template-designer-name')?.textContent?.trim();
      const authorAvatar = document.querySelector('.template-designer-icon')?.getAttribute('src') || undefined;
      const authorHref = authorLink?.getAttribute('href');
      const authorId = authorHref ? authorHref.split('/').pop() : undefined;

      const livePreviewLink = Array.from(document.querySelectorAll('a')).find(
        a => a.textContent?.includes('Preview in browser')
      );
      const designerPreviewLink = Array.from(document.querySelectorAll('a')).find(
        a => a.textContent?.includes('Preview in Webflow')
      );

      const livePreviewUrl = livePreviewLink?.getAttribute('href') || '';
      const designerPreviewUrl = designerPreviewLink?.getAttribute('href') || '';

      const priceElement = document.querySelector('.button_buy-price');
      const price = priceElement?.textContent?.trim();

      const shortDesc = document.querySelector('.branded-display-subtitle')?.textContent?.trim();
      const longDescElement = document.querySelector('#longDescription');
      const longDesc = longDescElement?.innerHTML;

      const subcategories: string[] = [];
      const subcategoryElements = document.querySelectorAll('#subcategory .tag-list_link');
      subcategoryElements.forEach(elem => {
        const text = elem.textContent?.trim().toLowerCase();
        if (text) subcategories.push(text);
      });

      const styles: string[] = [];
      const allSidebarWraps = document.querySelectorAll('.mp-sidebar-wrap');
      allSidebarWraps.forEach(wrap => {
        const heading = wrap.querySelector('.h6');
        if (heading && heading.textContent?.includes('Styles')) {
          const styleLinks = wrap.querySelectorAll('.tag-list_link');
          styleLinks.forEach(elem => {
            const text = elem.textContent?.trim().toLowerCase();
            if (text) styles.push(text);
          });
        }
      });

      const features: Array<{ name: string; description?: string; icon_type?: string }> = [];
      const featureElements = document.querySelectorAll('.feature_item');
      featureElements.forEach(elem => {
        const nameElem = elem.querySelector('.feature_accordion_cms-name');
        const descElem = elem.querySelector('.accordion_p');
        const iconElem = elem.querySelector('.feature_accordion_cms-icon, .feature_accordion_tick-icon');

        if (nameElem) {
          features.push({
            name: nameElem.textContent?.trim() || '',
            description: descElem?.textContent?.trim(),
            icon_type: iconElem?.classList.contains('feature_accordion_cms-icon') ? 'cms' : 'default'
          });
        }
      });

      const is_cms = features.some(f => f.name.toLowerCase().includes('content management'));
      const is_ecommerce = features.some(f => f.name.toLowerCase().includes('ecommerce'));

      const template_id = `wf_${slug.replace(/-/g, '_')}`;

      return {
        template_id,
        name,
        slug,
        author_name: authorName,
        author_id: authorId,
        author_avatar: authorAvatar,
        storefront_url: storefrontUrl,
        live_preview_url: livePreviewUrl,
        designer_preview_url: designerPreviewUrl,
        price,
        short_description: shortDesc,
        long_description: longDesc,
        subcategories,
        styles,
        features,
        is_cms,
        is_ecommerce
      };
    }, url);

    return data;
  }

  /**
   * Take screenshot and generate thumbnail
   */
  private async takeTemplateScreenshot(
    page: Page,
    templateData: TemplateData
  ): Promise<{ full: string; thumbnail: string; homepageDetection: HomepageDetectionResult }> {
    if (!templateData.live_preview_url) {
      throw new Error('No live preview URL available');
    }

    const newPage = await page.context().newPage();

    try {
      newPage.setDefaultTimeout(45000);

      await newPage.goto(templateData.live_preview_url, {
        waitUntil: 'domcontentloaded',
        timeout: 45000
      });

      // Detect alternate homepage
      const homepageDetection = await detectHomepage(newPage, templateData.live_preview_url);

      if (homepageDetection.isAlternateHomepage) {
        console.log(`  [ALTERNATE] Found alternate homepage: ${homepageDetection.detectedPath}`);
        this.emit('log', { message: `Found alternate homepage for ${templateData.name}: ${homepageDetection.detectedPath}` });

        // Navigate to the alternate homepage
        await newPage.goto(homepageDetection.screenshotUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 45000
        });
      }

      let elementsToRemove: string[] = [];
      try {
        elementsToRemove = await getActiveScreenshotExclusions();
      } catch (err) {
        console.warn('Warning: Could not fetch element exclusions:', err);
      }

      try {
        await preparePageForScreenshot(newPage, {
          loadTimeoutMs: 30000,
          animationWaitMs: 3000,
          scrollDelayMs: 150,
          elementsToRemove
        });
      } catch (prepError) {
        console.warn('Warning: Page preparation failed, continuing...', prepError);
      }

      const screenshotBuffer = await newPage.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: this.options.screenshotQuality
      });

      const fileName = `${templateData.slug}.webp`;
      const fullPath = path.join(this.screenshotDir, fileName);

      await sharp(screenshotBuffer)
        .resize(1000, null, { withoutEnlargement: true })
        .webp({ quality: this.options.screenshotQuality })
        .toFile(fullPath);

      const thumbnailName = `${templateData.slug}_thumb.webp`;
      const thumbnailPath = path.join(this.thumbnailDir, thumbnailName);

      await sharp(screenshotBuffer)
        .resize(500, 500, {
          fit: 'cover',
          position: 'top'
        })
        .webp({ quality: this.options.screenshotQuality - 10 })
        .toFile(thumbnailPath);

      return {
        full: `/screenshots/${fileName}`,
        thumbnail: `/thumbnails/${thumbnailName}`,
        homepageDetection
      };
    } finally {
      await newPage.close();
    }
  }

  /**
   * Save template to database
   */
  private async saveTemplateToDatabase(data: TemplateData): Promise<number> {
    return await db.transaction(async (tx) => {
      const existing = await tx.getAsync<{ id: number }>(
        'SELECT id FROM templates WHERE template_id = ?',
        [data.template_id]
      );

      let templateId: number;

      if (existing) {
        await tx.runAsync(
          `UPDATE templates SET
            name = ?, slug = ?, author_name = ?, author_id = ?, author_avatar = ?,
            storefront_url = ?, live_preview_url = ?, designer_preview_url = ?,
            price = ?, short_description = ?, long_description = ?,
            screenshot_path = ?, screenshot_thumbnail_path = ?,
            is_cms = ?, is_ecommerce = ?,
            screenshot_url = ?, is_alternate_homepage = ?, alternate_homepage_path = ?,
            updated_at = datetime('now')
          WHERE id = ?`,
          [
            data.name, data.slug, data.author_name, data.author_id, data.author_avatar,
            data.storefront_url, data.live_preview_url, data.designer_preview_url,
            data.price, data.short_description, data.long_description,
            data.screenshot_path, data.screenshot_thumbnail_path,
            data.is_cms ? 1 : 0, data.is_ecommerce ? 1 : 0,
            data.screenshot_url || null, data.is_alternate_homepage ? 1 : 0, data.alternate_homepage_path || null,
            existing.id
          ]
        );
        templateId = existing.id;

        await tx.runAsync('DELETE FROM template_subcategories WHERE template_id = ?', [templateId]);
        await tx.runAsync('DELETE FROM template_styles WHERE template_id = ?', [templateId]);
        await tx.runAsync('DELETE FROM template_features WHERE template_id = ?', [templateId]);
      } else {
        const { lastID } = await tx.runAsync(
          `INSERT INTO templates (
            template_id, name, slug, author_name, author_id, author_avatar,
            storefront_url, live_preview_url, designer_preview_url,
            price, short_description, long_description,
            screenshot_path, screenshot_thumbnail_path,
            is_cms, is_ecommerce,
            screenshot_url, is_alternate_homepage, alternate_homepage_path
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            data.template_id, data.name, data.slug, data.author_name, data.author_id, data.author_avatar,
            data.storefront_url, data.live_preview_url, data.designer_preview_url,
            data.price, data.short_description, data.long_description,
            data.screenshot_path, data.screenshot_thumbnail_path,
            data.is_cms ? 1 : 0, data.is_ecommerce ? 1 : 0,
            data.screenshot_url || null, data.is_alternate_homepage ? 1 : 0, data.alternate_homepage_path || null
          ]
        );
        templateId = lastID;
      }

      // Save subcategories
      for (const subcategory of data.subcategories) {
        const slug = subcategory.toLowerCase().replace(/\s+/g, '-');
        const subcatId = await this.ensureEntity(tx, 'subcategories', {
          name: subcategory,
          slug,
          display_name: subcategory.charAt(0).toUpperCase() + subcategory.slice(1)
        });
        await tx.runAsync(
          'INSERT OR IGNORE INTO template_subcategories (template_id, subcategory_id) VALUES (?, ?)',
          [templateId, subcatId]
        );
      }

      // Save styles
      for (const style of data.styles) {
        const slug = style.toLowerCase().replace(/\s+/g, '-');
        const styleId = await this.ensureEntity(tx, 'styles', {
          name: style,
          slug,
          display_name: style.charAt(0).toUpperCase() + style.slice(1)
        });
        await tx.runAsync(
          'INSERT OR IGNORE INTO template_styles (template_id, style_id) VALUES (?, ?)',
          [templateId, styleId]
        );
      }

      // Save features
      for (const feature of data.features) {
        const slug = feature.name.toLowerCase().replace(/\s+/g, '-');
        const featureId = await this.ensureEntity(tx, 'features', {
          name: feature.name,
          slug,
          display_name: feature.name,
          description: feature.description,
          icon_type: feature.icon_type
        });
        await tx.runAsync(
          'INSERT OR IGNORE INTO template_features (template_id, feature_id) VALUES (?, ?)',
          [templateId, featureId]
        );
      }

      return templateId;
    });
  }

  private async ensureEntity(
    tx: { runAsync: typeof db.runAsync; getAsync: typeof db.getAsync },
    table: string,
    data: Record<string, unknown>
  ): Promise<number> {
    const existing = await tx.getAsync<{ id: number }>(
      `SELECT id FROM ${table} WHERE name = ?`,
      [data.name]
    );

    if (existing) {
      return existing.id;
    }

    const columns = Object.keys(data);
    const values = Object.values(data);
    const placeholders = columns.map(() => '?').join(', ');

    const { lastID } = await tx.runAsync(
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
      values
    );

    return lastID;
  }

  /**
   * Discover new templates without scraping
   */
  async discoverNewTemplates(): Promise<{
    totalInSitemap: number;
    existingInDb: number;
    blacklisted: number;
    newTemplates: Array<{ url: string; slug: string; displayName: string }>;
  }> {
    const sitemapUrls = await this.fetchSitemapUrls();

    const existingTemplates = await db.allAsync<{ storefront_url: string }>(
      'SELECT storefront_url FROM templates'
    );
    const existingUrls = new Set(existingTemplates.map(t => t.storefront_url));

    // Refresh blacklist
    this.blacklistSet = await getBlacklistSet();

    const newTemplates: Array<{ url: string; slug: string; displayName: string }> = [];
    let blacklistedCount = 0;

    for (const url of sitemapUrls) {
      if (existingUrls.has(url)) continue;

      const slug = url.split('/').pop()?.replace('-website-template', '') || '';

      // Check blacklist
      if (this.blacklistSet.has(slug)) {
        blacklistedCount++;
        continue;
      }

      const displayName = slug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');

      newTemplates.push({ url, slug, displayName });
    }

    return {
      totalInSitemap: sitemapUrls.length,
      existingInDb: existingTemplates.length,
      blacklisted: blacklistedCount,
      newTemplates
    };
  }
}

export default BatchScraper;
