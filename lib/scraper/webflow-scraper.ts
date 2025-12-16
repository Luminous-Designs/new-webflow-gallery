import { chromium, Browser, Page, BrowserContext } from 'playwright';
import sharp from 'sharp';
import { preparePageForScreenshot } from '../screenshot/prepare';
import { db, getActiveScreenshotExclusions, runAlternateHomepageMigration } from '../db';
import { detectHomepage, HomepageDetectionResult } from './homepage-detector';
import path from 'path';
import { promises as fs } from 'fs';
import axios from 'axios';
import { EventEmitter } from 'events';

interface ScraperOptions {
  concurrency?: number;
  browserInstances?: number;
  pagesPerBrowser?: number;
  timeout?: number;
  screenshotQuality?: number;
  headless?: boolean;
  viewport?: { width: number; height: number };
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

export class WebflowScraper extends EventEmitter {
  private browsers: Browser[] = [];
  private options: Required<ScraperOptions>;
  private jobId: number | null = null;
  private screenshotDir = './public/screenshots';
  private thumbnailDir = './public/thumbnails';
  private browserIndex = 0;

  constructor(options: ScraperOptions = {}) {
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
      viewport: options.viewport || { width: 1600, height: 1000 }
    };

    console.log('\n=== WebflowScraper Configured ===');
    console.log(`Concurrency: ${this.options.concurrency}`);
    console.log(`Browsers: ${this.options.browserInstances}`);
    console.log(`Pages/Browser: ${this.options.pagesPerBrowser}`);
    console.log(`Timeout: ${this.options.timeout}ms`);
    console.log('==================================\n');
  }

  async init() {
    console.log('\n=== WebflowScraper Initialization Started ===');
    console.log('Configuration:', {
      totalConcurrency: this.options.concurrency,
      browserInstances: this.options.browserInstances,
      pagesPerBrowser: this.options.pagesPerBrowser,
      timeout: this.options.timeout,
      headless: this.options.headless
    });

    try {
      console.log('Creating screenshot directories...');
      await this.ensureDirectories();
      console.log('Directories created successfully');

      // Run database migration for alternate homepage columns
      console.log('Running alternate homepage migration...');
      await runAlternateHomepageMigration();
      console.log('Migration complete');

      console.log(`Launching ${this.options.browserInstances} browser instance(s) with Playwright...`);

      // Launch multiple browser instances for better parallelization
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
              '--disable-accelerated-2d-canvas',
              '--no-first-run',
              '--no-zygote',
              // Remove single-process as it limits parallelization
              '--disable-gpu',
              '--disable-web-security',
              '--disable-features=IsolateOrigins,site-per-process',
              // Add memory optimizations
              '--max_old_space_size=4096',
              '--memory-pressure-off',
              // Increase resource limits
              '--max-semi-space-size=128',
              '--disable-backgrounding-occluded-windows',
              '--disable-renderer-backgrounding'
            ]
          })
        );
      }

      this.browsers = await Promise.all(browserPromises);
      console.log(`${this.browsers.length} browser(s) launched successfully`);

      console.log('=== WebflowScraper Initialization Complete ===\n');
      this.emit('log', { message: `Scraper initialized with ${this.options.concurrency} total concurrency (${this.options.browserInstances} browsers)` });
    } catch (error) {
      console.error('ERROR during initialization:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { message: `Initialization failed: ${message}` });
      throw error;
    }
  }

  private async ensureDirectories() {
    await fs.mkdir(this.screenshotDir, { recursive: true });
    await fs.mkdir(this.thumbnailDir, { recursive: true });
  }

  async close() {
    console.log('Closing scraper...');

    // Close all browsers
    for (const browser of this.browsers) {
      try {
        await browser.close();
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
    this.browsers = [];

    console.log('Scraper closed successfully');
  }

  // Get the next browser in round-robin fashion
  private getNextBrowser(): Browser {
    const browser = this.browsers[this.browserIndex];
    this.browserIndex = (this.browserIndex + 1) % this.browsers.length;
    return browser;
  }

  async fetchSitemapUrls(): Promise<string[]> {
    console.log('\n=== Fetching Sitemap URLs ===');
    this.emit('log', { message: 'Fetching sitemap from Webflow...' });

    try {
      const sitemapUrl = 'https://templates.webflow.com/sitemap.xml';
      console.log(`Making HTTP request to: ${sitemapUrl}`);
      const response = await axios.get(sitemapUrl);
      console.log(`Sitemap fetched successfully, size: ${response.data.length} characters`);

      const xml = response.data;

      // Only match URLs in the /html/ subdirectory to avoid category pages
      const htmlTemplateRegex = /<loc>(https:\/\/templates\.webflow\.com\/html\/[^<]+)<\/loc>/g;
      const urls: string[] = [];
      let match;
      let totalUrls = 0;
      let categoryUrls = 0;
      let otherUrls = 0;

      // First, count all URLs for logging
      const allUrlsRegex = /<loc>([^<]+)<\/loc>/g;
      while ((match = allUrlsRegex.exec(xml)) !== null) {
        totalUrls++;
        if (match[1].includes('/category/')) {
          categoryUrls++;
        } else if (!match[1].includes('/html/')) {
          otherUrls++;
        }
      }

      console.log(`\nSitemap Analysis:`);
      console.log(`- Total URLs in sitemap: ${totalUrls}`);
      console.log(`- Category URLs found (will be skipped): ${categoryUrls}`);
      console.log(`- Other non-template URLs: ${otherUrls}`);

      // Now extract only /html/ template URLs
      console.log('\nExtracting template URLs (/html/ subdirectory only)...');
      while ((match = htmlTemplateRegex.exec(xml)) !== null) {
        const url = match[1];
        urls.push(url);
        if (urls.length <= 5) {
          console.log(`  Template ${urls.length}: ${url}`);
        }
      }

      console.log(`\nFiltered results:`);
      console.log(`- Template URLs to scrape: ${urls.length}`);
      if (urls.length > 5) {
        console.log(`  ... and ${urls.length - 5} more templates`);
      }
      console.log('=== Sitemap Parsing Complete ===\n');

      this.emit('log', { message: `Found ${urls.length} template URLs (excluded ${categoryUrls} category URLs)` });

      if (urls.length === 0) {
        console.log('WARNING: No template URLs found!');
        console.log('Sample of XML:', xml.substring(0, 1000));
      }

      return urls;
    } catch (error) {
      console.error('Failed to fetch sitemap:', error);
      this.emit('error', { message: 'Failed to fetch sitemap', error: String(error) });
      throw error;
    }
  }

  async scrapeFullSitemap() {
    console.log('\n=== Starting Full Sitemap Scrape ===');
    this.emit('log', { message: 'Starting full sitemap scrape...' });

    try {
      console.log('Step 1: Fetching sitemap URLs...');
      const urls = await this.fetchSitemapUrls();

      if (urls.length === 0) {
        console.error('ERROR: No URLs found in sitemap!');
        this.emit('error', { message: 'No template URLs found in sitemap' });
        throw new Error('No template URLs found in sitemap');
      }

      console.log(`Step 2: Starting to scrape ${urls.length} templates...`);
      await this.scrapeMultipleTemplates(urls, 'full');
      console.log('=== Full Sitemap Scrape Complete ===\n');
    } catch (error) {
      console.error('ERROR in scrapeFullSitemap:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { message: `Full scrape failed: ${message}` });
      throw error;
    }
  }

  async scrapeNewTemplates() {
    console.log('\n=== Starting New Templates Scrape ===');
    this.emit('log', { message: 'Checking for new templates...' });

    try {
      console.log('Step 1: Fetching sitemap URLs...');
      const urls = await this.fetchSitemapUrls();
      console.log(`Found ${urls.length} total URLs in sitemap`);

      console.log('Step 2: Checking existing templates in database...');
      const existingTemplates = await db.allAsync<{ storefront_url: string }>(
        'SELECT storefront_url FROM templates'
      );
      console.log(`Found ${existingTemplates.length} existing templates in database`);

      const existingUrls = new Set(existingTemplates.map(t => t.storefront_url));
      const newUrls = urls.filter(url => !existingUrls.has(url));
      console.log(`New templates to scrape: ${newUrls.length}`);

      if (newUrls.length === 0) {
        console.log('No new templates found - all templates are up to date');
        this.emit('log', { message: 'No new templates found' });
        return;
      }

      console.log(`Step 3: Starting to scrape ${newUrls.length} new templates...`);
      this.emit('log', { message: `Found ${newUrls.length} new templates to scrape` });
      await this.scrapeMultipleTemplates(newUrls, 'update');
      console.log('=== New Templates Scrape Complete ===\n');
    } catch (error) {
      console.error('ERROR in scrapeNewTemplates:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { message: `Update scrape failed: ${message}` });
      throw error;
    }
  }

  // Discover new templates without scraping - returns list of new template URLs
  async discoverNewTemplates(): Promise<{
    totalInSitemap: number;
    existingInDb: number;
    newTemplates: Array<{ url: string; slug: string }>;
  }> {
    console.log('\n=== Discovering New Templates ===');
    this.emit('log', { message: 'Discovering new templates...' });
    this.emit('discovery-phase', { phase: 'fetching-sitemap', message: 'Fetching Webflow sitemap...' });

    try {
      // Step 1: Fetch sitemap
      const sitemapUrl = 'https://templates.webflow.com/sitemap.xml';
      console.log(`Fetching sitemap from: ${sitemapUrl}`);
      const response = await axios.get(sitemapUrl);
      const xml = response.data;

      // Parse template URLs
      const htmlTemplateRegex = /<loc>(https:\/\/templates\.webflow\.com\/html\/[^<]+)<\/loc>/g;
      const sitemapUrls: string[] = [];
      let match;
      while ((match = htmlTemplateRegex.exec(xml)) !== null) {
        sitemapUrls.push(match[1]);
      }

      console.log(`Found ${sitemapUrls.length} templates in sitemap`);
      this.emit('discovery-phase', {
        phase: 'comparing-database',
        message: `Found ${sitemapUrls.length} templates in sitemap. Comparing with database...`,
        sitemapCount: sitemapUrls.length
      });

      // Step 2: Get existing templates from database
      const existingTemplates = await db.allAsync<{ storefront_url: string }>(
        'SELECT storefront_url FROM templates'
      );
      const existingUrls = new Set(existingTemplates.map(t => t.storefront_url));

      console.log(`Found ${existingTemplates.length} existing templates in database`);

      // Step 3: Find new templates
      const newTemplates = sitemapUrls
        .filter(url => !existingUrls.has(url))
        .map(url => {
          // Extract slug from URL
          const parts = url.split('/');
          const slug = parts[parts.length - 1].replace('-website-template', '');
          return { url, slug };
        });

      console.log(`Discovered ${newTemplates.length} new templates`);
      this.emit('discovery-phase', {
        phase: 'complete',
        message: `Discovery complete! Found ${newTemplates.length} new templates.`,
        newCount: newTemplates.length,
        existingCount: existingTemplates.length,
        sitemapCount: sitemapUrls.length
      });

      this.emit('discovery-complete', {
        totalInSitemap: sitemapUrls.length,
        existingInDb: existingTemplates.length,
        newTemplates
      });

      return {
        totalInSitemap: sitemapUrls.length,
        existingInDb: existingTemplates.length,
        newTemplates
      };
    } catch (error) {
      console.error('ERROR in discoverNewTemplates:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { message: `Discovery failed: ${message}` });
      throw error;
    }
  }

  // Scrape a specific list of URLs (for scraping pre-discovered templates)
  async scrapeUrls(urls: string[]) {
    console.log(`\n=== Scraping ${urls.length} Specific URLs ===`);
    this.emit('log', { message: `Starting to scrape ${urls.length} templates...` });

    try {
      await this.scrapeMultipleTemplates(urls, 'update');
      console.log('=== URL Scrape Complete ===\n');
    } catch (error) {
      console.error('ERROR in scrapeUrls:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { message: `Scrape failed: ${message}` });
      throw error;
    }
  }

  async scrapeSingleTemplate(url: string) {
    console.log(`\n=== Starting Single Template Scrape ===`);
    console.log(`URL: ${url}`);
    this.emit('log', { message: `Scraping single template: ${url}` });

    try {
      await this.scrapeMultipleTemplates([url], 'single');
      console.log('=== Single Template Scrape Complete ===\n');
    } catch (error) {
      console.error('ERROR in scrapeSingleTemplate:', error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.emit('error', { message: `Single scrape failed: ${message}` });
      throw error;
    }
  }

  private async scrapeMultipleTemplates(urls: string[], jobType: 'full' | 'update' | 'single') {
    console.log(`\n=== scrapeMultipleTemplates Started ===`);
    console.log(`Job Type: ${jobType}`);
    console.log(`Total URLs to process: ${urls.length}`);
    console.log(`Total Concurrency: ${this.options.concurrency}`);
    console.log(`Browser Instances: ${this.options.browserInstances}`);
    console.log(`Pages per Browser: ${this.options.pagesPerBrowser}`);
    console.log(`Timeout per page: ${this.options.timeout}ms`);
    console.log(`Workers will use adaptive wait strategies: domcontentloaded -> load -> networkidle`);
    console.log(`========================================\n`);

    try {
      // Create scrape job
      console.log('Creating scrape job in database...');
      const { lastID } = await db.runAsync(
        `INSERT INTO scrape_jobs (job_type, status, total_templates, started_at)
         VALUES (?, 'running', ?, datetime('now'))`,
        [jobType, urls.length]
      );
      this.jobId = lastID;
      console.log(`Scrape job created with ID: ${this.jobId}`);

      this.emit('job-started', { jobId: this.jobId, totalTemplates: urls.length });
      console.log(`Emitted job-started event with jobId: ${this.jobId}`);

    let processed = 0;
    let successful = 0;
    let failed = 0;
    let skipped = 0;

    // Create a worker pool for processing templates
    const workerQueue = [...urls];
    const startTime = Date.now();
    const activeContexts = new Set<BrowserContext>();

    // Worker function with dynamic context creation
    const worker = async (workerId: number) => {
      const browserIndex = workerId % this.browsers.length;
      const browser = this.browsers[browserIndex];
      let context: BrowserContext | null = null;
      let contextUseCount = 0;
      const maxContextUses = 5; // Reduced from 10 - recreate more often to prevent memory issues
      let lastRequestTime = 0;
      const minRequestInterval = 100; // Minimum 100ms between requests per worker

      while (workerQueue.length > 0) {
        const url = workerQueue.shift();
        if (!url) break;

        // Rate limiting per worker
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < minRequestInterval) {
          await new Promise(resolve => setTimeout(resolve, minRequestInterval - timeSinceLastRequest));
        }
        lastRequestTime = Date.now();

        try {
          // Create or recreate context when needed
          if (!context || contextUseCount >= maxContextUses) {
            if (context) {
              try {
                await context.close();
              } catch (e) {
                console.error(`Worker ${workerId}: Error closing context:`, e);
              }
              activeContexts.delete(context);
            }

            // Create new context with retries
            let retries = 3;
            while (retries > 0) {
              try {
                context = await browser.newContext({
                  viewport: this.options.viewport,
                  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                  // Add resource limits per context
                  bypassCSP: true,
                  ignoreHTTPSErrors: true
                });
                activeContexts.add(context);
                contextUseCount = 0;
                break;
              } catch (error) {
                retries--;
                console.error(`Worker ${workerId}: Failed to create context (${retries} retries left):`, error);
                if (retries === 0) throw error;
                await new Promise(resolve => setTimeout(resolve, 1000));
              }
            }
          }

          contextUseCount++;
          console.log(`[Worker ${workerId}] Processing ${url} (context use ${contextUseCount}/${maxContextUses})`);

          const result = await this.scrapeTemplateWithContext(url, context!);
          processed++;

          if (result === 'skipped') {
            skipped++;
            successful++;
          } else if (result === 'scraped') {
            successful++;
          } else {
            failed++;
          }
        } catch (error) {
          processed++;
          failed++;
          console.error(`Worker ${workerId} failed to scrape ${url}:`, error);
          this.emit('error', { message: `Failed to scrape template: ${url}`, error: String(error) });

          // If context is broken, close it and let next iteration create a new one
          if (context && String(error).includes('has been closed')) {
            try {
              await context.close();
            } catch {
              // Ignore close errors
            }
            activeContexts.delete(context);
            context = null;
          }
        }

        // Update progress after each URL
        await db.runAsync(
          `UPDATE scrape_jobs
           SET processed_templates = ?, successful_templates = ?, failed_templates = ?
           WHERE id = ?`,
          [processed, successful, failed, this.jobId]
        );

        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        const rate = processed > 0 ? Math.round((processed / elapsed) * 60) : 0;

        this.emit('progress', {
          jobId: this.jobId,
          processed,
          successful,
          failed,
          skipped,
          total: urls.length,
          rate: `${rate} templates/min`,
          elapsed: `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
        });
      }

      // Clean up worker's context
      if (context) {
        try {
          await context.close();
        } catch (e) {
          console.error('Error closing final context:', e);
        }
        activeContexts.delete(context);
      }
    };

    try {
      // Start workers up to the concurrency limit
      const workers = [];
      for (let i = 0; i < this.options.concurrency; i++) {
        workers.push(worker(i));
      }

      // Wait for all workers to complete
      await Promise.all(workers);

      // Complete job
      await db.runAsync(
        `UPDATE scrape_jobs
         SET status = 'completed', completed_at = datetime('now')
         WHERE id = ?`,
        [this.jobId]
      );

      this.emit('job-completed', { jobId: this.jobId, successful, failed, skipped });
      console.log(`\n=== Scrape Job Complete ===`);
      console.log(`Total processed: ${processed}`);
      console.log(`Successful: ${successful - skipped}`);
      console.log(`Skipped (already exist): ${skipped}`);
      console.log(`Failed: ${failed}`);
      console.log(`===========================\n`);
    } catch (error) {
      // Mark job as failed
      await db.runAsync(
        `UPDATE scrape_jobs
         SET status = 'failed', error_message = ?, completed_at = datetime('now')
         WHERE id = ?`,
        [String(error), this.jobId]
      );

      this.emit('job-failed', { jobId: this.jobId, error });
      throw error;
    }
    } catch (error) {
      console.error('ERROR in scrapeMultipleTemplates:', error);
      throw error;
    }
  }

  // New method for scraping with a provided context (for better parallelization)
  private async scrapeTemplateWithContext(url: string, context: BrowserContext): Promise<'scraped' | 'skipped' | 'failed'> {
    // Check if template already exists in database
    const existingTemplate = await db.getAsync<{ id: number, name: string }>(
      'SELECT id, name FROM templates WHERE storefront_url = ?',
      [url]
    );

    if (existingTemplate) {
      console.log(`[SKIP] Already exists: ${existingTemplate.name} - ${url}`);
      this.emit('log', { message: `Skipped (already exists): ${existingTemplate.name}` });
      return 'skipped';
    }

    console.log(`[START] Scraping: ${url}`);
    this.emit('log', { message: `Scraping: ${url}` });

    let page: Page | null = null;
    let retries = 3;

    while (retries > 0) {
      const attemptNumber = 4 - retries;
      console.log(`[ATTEMPT ${attemptNumber}/3] ${url}`);

      try {
        // Create a new page with timeout
        console.log(`  Creating page for: ${url}`);
        page = await context.newPage();

        // Set page-level timeouts
        const pageTimeout = Math.min(this.options.timeout * 2, 60000); // Max 60s
        page.setDefaultTimeout(pageTimeout);
        page.setDefaultNavigationTimeout(pageTimeout);

        this.emit('template-start', { url });

        // Try different wait strategies based on retry attempt
        const waitStrategies: Array<'domcontentloaded' | 'load' | 'networkidle'> = ['domcontentloaded', 'load', 'networkidle'];
        const waitUntil = waitStrategies[Math.min(attemptNumber - 1, 2)];

        console.log(`  Navigating with waitUntil='${waitUntil}', timeout=${pageTimeout}ms`);

        // Navigate to storefront page with more flexible wait condition
        await page.goto(url, {
          waitUntil: waitUntil,
          timeout: pageTimeout
        });

        // Additional wait for dynamic content if using domcontentloaded
        if (waitUntil === 'domcontentloaded') {
          console.log(`  Waiting additional 2s for dynamic content...`);
          await page.waitForTimeout(2000);
        }

        console.log(`  Page loaded, extracting data...`);
        // Extract template data
        const templateData = await this.extractTemplateData(page, url);
        console.log(`  Extracted: ${templateData.name}`);

        console.log(`  Taking screenshot...`);
        // Take screenshot (includes homepage detection)
        const screenshotResult = await this.takeTemplateScreenshot(page, templateData);
        templateData.screenshot_path = screenshotResult.full;
        templateData.screenshot_thumbnail_path = screenshotResult.thumbnail;

        // Store homepage detection results
        templateData.screenshot_url = screenshotResult.homepageDetection.screenshotUrl;
        templateData.is_alternate_homepage = screenshotResult.homepageDetection.isAlternateHomepage;
        templateData.alternate_homepage_path = screenshotResult.homepageDetection.detectedPath;

        if (screenshotResult.homepageDetection.isAlternateHomepage) {
          console.log(`  Screenshot from alternate page: ${screenshotResult.homepageDetection.detectedPath}`);
        }
        console.log(`  Screenshot saved: ${screenshotResult.full}`);

        console.log(`  Saving to database...`);
        // Save to database
        await this.saveTemplateToDatabase(templateData);

        console.log(`[SUCCESS] Scraped: ${templateData.name} - ${url}`);
        this.emit('template-complete', { url, data: templateData, isAlternateHomepage: templateData.is_alternate_homepage });

        // Success - close page and return
        await page.close();
        return 'scraped';

      } catch (error) {
        retries--;
        const errorStr = String(error);
        const errorType = errorStr.includes('Timeout') ? 'TIMEOUT' :
                         errorStr.includes('closed') ? 'CLOSED' : 'ERROR';

        // Log the error with retry info
        console.error(`[${errorType}] Attempt ${attemptNumber} failed for ${url} (${retries} retries left)`);
        console.error(`  Error: ${errorStr.substring(0, 200)}`);

        // Close the page if it exists
        if (page) {
          try {
            await page.close();
          } catch {
            // Ignore close errors
          }
          page = null;
        }

        // If context is closed, throw immediately - can't retry
        if (errorStr.includes('has been closed') || errorStr.includes('Target closed')) {
          console.error(`[FATAL] Context closed for: ${url}`);
          this.emit('error', { message: `Context closed for: ${url}`, error: errorStr });
          return 'failed';
        }

        // If no retries left, fail
        if (retries === 0) {
          console.error(`[FAILED] All attempts exhausted for: ${url}`);
          this.emit('error', { message: `Failed after 3 attempts: ${url}`, error: errorStr });
          return 'failed';
        }

        // Wait before retry with shorter backoff for timeouts
        const backoffTime = errorType === 'TIMEOUT' ? 1000 : (3 - retries) * 2000;
        console.log(`  Waiting ${backoffTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, backoffTime));
      }
    }

    return 'failed';
  }

  // Keep the old scrapeTemplate method for backward compatibility
  private async scrapeTemplate(url: string): Promise<'scraped' | 'skipped' | 'failed'> {
    console.log(`\n  Checking template: ${url}`);

    // Check if template already exists in database
    const existingTemplate = await db.getAsync<{ id: number, name: string }>(
      'SELECT id, name FROM templates WHERE storefront_url = ?',
      [url]
    );

    if (existingTemplate) {
      console.log(`    ✓ Template already exists in database: ${existingTemplate.name} (ID: ${existingTemplate.id})`);
      console.log(`    Skipping scrape for this template.`);
      this.emit('log', { message: `Skipped (already exists): ${existingTemplate.name}` });

      // Log as skipped
      await db.runAsync(
        `INSERT INTO scrape_logs (job_id, template_url, status, message)
         VALUES (?, ?, 'skipped', 'Template already exists in database')`,
        [this.jobId, url]
      );

      return 'skipped'; // Skip scraping this template
    }

    console.log(`    Template not in database, proceeding with scrape...`);
    this.emit('log', { message: `Scraping: ${url}` });

    if (this.browsers.length === 0) {
      console.error('ERROR: No browsers initialized!');
      throw new Error('Browsers not initialized. Call init() first.');
    }

    // Get a random browser for backward compatibility
    const browser = this.browsers[Math.floor(Math.random() * this.browsers.length)];
    const context = await browser.newContext({
      viewport: this.options.viewport,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
    });

    const page = await context.newPage();

    try {
      this.emit('template-start', { url });

      // Log scrape attempt
      await db.runAsync(
        `INSERT INTO scrape_logs (job_id, template_url, status, message)
         VALUES (?, ?, 'processing', 'Starting template scrape')`,
        [this.jobId, url]
      );

      // Navigate to storefront page
      console.log(`    Navigating to: ${url}`);
      await page.goto(url, { waitUntil: 'networkidle', timeout: this.options.timeout });
      console.log(`    Page loaded successfully`);

      // Extract template data
      const templateData = await this.extractTemplateData(page, url);

      // Take screenshot (includes homepage detection)
      console.log(`    Taking screenshot...`);
      const screenshotResult = await this.takeTemplateScreenshot(page, templateData);
      templateData.screenshot_path = screenshotResult.full;
      templateData.screenshot_thumbnail_path = screenshotResult.thumbnail;

      // Store homepage detection results
      templateData.screenshot_url = screenshotResult.homepageDetection.screenshotUrl;
      templateData.is_alternate_homepage = screenshotResult.homepageDetection.isAlternateHomepage;
      templateData.alternate_homepage_path = screenshotResult.homepageDetection.detectedPath;

      if (screenshotResult.homepageDetection.isAlternateHomepage) {
        console.log(`    Screenshot from alternate page: ${screenshotResult.homepageDetection.detectedPath}`);
      }
      console.log(`    Screenshot saved: ${screenshotResult.full}`);

      // Save to database
      console.log(`    Saving to database...`);
      await this.saveTemplateToDatabase(templateData);
      console.log(`    Template saved successfully`);

      // Log success
      await db.runAsync(
        `INSERT INTO scrape_logs (job_id, template_url, status, message)
         VALUES (?, ?, 'success', 'Template scraped successfully')`,
        [this.jobId, url]
      );

      this.emit('template-complete', { url, data: templateData, isAlternateHomepage: templateData.is_alternate_homepage });
      console.log(`    ✓ Template scraped successfully: ${templateData.name}`);
      return 'scraped';
    } catch (error) {
      console.error(`    ✗ Failed to scrape template:`, error);
      // Log failure
      await db.runAsync(
        `INSERT INTO scrape_logs (job_id, template_url, status, message, error_details)
         VALUES (?, ?, 'failed', 'Failed to scrape template', ?)`,
        [this.jobId, url, String(error)]
      );

      throw error;
    } finally {
      await context.close();
    }
  }

  private async extractTemplateData(page: Page, url: string): Promise<TemplateData> {
    console.log(`    Extracting template data from page...`);

    try {
      const data = await page.evaluate((storefrontUrl) => {
      // Extract template name
      const nameElement = document.querySelector('.h4') || document.querySelector('h1');
      const fullName = nameElement?.textContent?.trim() || '';
      const name = fullName.replace(/ - .+ Website Template$/, '');

      // Extract slug from URL
      const urlParts = storefrontUrl.split('/');
      const slug = urlParts[urlParts.length - 1].replace('-website-template', '');

      // Extract author info
      const authorLink = document.querySelector('.template-designer-link');
      const authorName = document.querySelector('.template-designer-name')?.textContent?.trim();
      const authorAvatar = document.querySelector('.template-designer-icon')?.getAttribute('src') || undefined;
      const authorHref = authorLink?.getAttribute('href');
      const authorId = authorHref ? authorHref.split('/').pop() : undefined;

      // Extract URLs
      const livePreviewLink = Array.from(document.querySelectorAll('a')).find(
        a => a.textContent?.includes('Preview in browser')
      );
      const designerPreviewLink = Array.from(document.querySelectorAll('a')).find(
        a => a.textContent?.includes('Preview in Webflow')
      );

      const livePreviewUrl = livePreviewLink?.getAttribute('href') || '';
      const designerPreviewUrl = designerPreviewLink?.getAttribute('href') || '';

      // Extract price
      const priceElement = document.querySelector('.button_buy-price');
      const price = priceElement?.textContent?.trim();

      // Extract descriptions
      const shortDesc = document.querySelector('.branded-display-subtitle')?.textContent?.trim();
      const longDescElement = document.querySelector('#longDescription');
      const longDesc = longDescElement?.innerHTML;

      // Extract subcategories
      const subcategories: string[] = [];
      const subcategoryElements = document.querySelectorAll('#subcategory .tag-list_link');
      subcategoryElements.forEach(elem => {
        const text = elem.textContent?.trim().toLowerCase();
        if (text) subcategories.push(text);
      });

      // Extract styles - find the sidebar section with "Styles" heading
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

      // Extract features
      const features: Array<{ name: string; description?: string; icon_type?: string }> = [];
      const featureElements = document.querySelectorAll('.feature_item');
      featureElements.forEach(elem => {
        const nameElem = elem.querySelector('.feature_accordion_cms-name');
        const descElem = elem.querySelector('.accordion_p');
        const iconElem = elem.querySelector('.feature_accordion_cms-icon, .feature_accordion_tick-icon');

        if (nameElem) {
          const feature = {
            name: nameElem.textContent?.trim() || '',
            description: descElem?.textContent?.trim(),
            icon_type: iconElem?.classList.contains('feature_accordion_cms-icon') ? 'cms' : 'default'
          };
          features.push(feature);
        }
      });

      // Check for CMS/Ecommerce
      const is_cms = features.some(f => f.name.toLowerCase().includes('content management'));
      const is_ecommerce = features.some(f => f.name.toLowerCase().includes('ecommerce'));

      // Generate template ID from slug
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

      console.log(`    Successfully extracted data for: ${data.name}`);
      console.log(`      - Author: ${data.author_name}`);
      console.log(`      - Subcategories: ${data.subcategories.length}`);
      console.log(`      - Styles: ${data.styles.length}`);
      console.log(`      - Features: ${data.features.length}`);
      console.log(`      - CMS: ${data.is_cms}, E-commerce: ${data.is_ecommerce}`);

      return data;
    } catch (error) {
      console.error(`    ERROR extracting template data:`, error);
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to extract template data: ${message}`);
    }
  }

  private async takeTemplateScreenshot(
    page: Page,
    templateData: TemplateData
  ): Promise<{ full: string; thumbnail: string; homepageDetection: HomepageDetectionResult }> {
    if (!templateData.live_preview_url) {
      throw new Error('No live preview URL available');
    }

    const newPage = await page.context().newPage();

    try {
      // Set page timeouts for screenshot page
      const screenshotTimeout = 45000;
      newPage.setDefaultTimeout(screenshotTimeout);
      newPage.setDefaultNavigationTimeout(screenshotTimeout);

      console.log(`    Opening preview: ${templateData.live_preview_url}`);

      // Navigate to live preview with less strict wait
      await newPage.goto(templateData.live_preview_url, {
        waitUntil: 'domcontentloaded',
        timeout: screenshotTimeout
      });

      // Detect alternate homepage
      console.log(`    Detecting alternate homepage...`);
      const homepageDetection = await detectHomepage(newPage, templateData.live_preview_url);

      if (homepageDetection.isAlternateHomepage) {
        console.log(`    [ALTERNATE] Found alternate homepage: ${homepageDetection.detectedPath}`);
        this.emit('log', { message: `Found alternate homepage for ${templateData.name}: ${homepageDetection.detectedPath}` });

        // Navigate to the alternate homepage
        await newPage.goto(homepageDetection.screenshotUrl, {
          waitUntil: 'domcontentloaded',
          timeout: screenshotTimeout
        });
      } else {
        console.log(`    Using index page for screenshot`);
      }

      // Get active element exclusions from database
      let elementsToRemove: string[] = [];
      try {
        elementsToRemove = await getActiveScreenshotExclusions();
      } catch (err) {
        console.warn('    Warning: Could not fetch element exclusions:', err);
      }

      // Prepare page for screenshot
      try {
        await preparePageForScreenshot(newPage, {
          loadTimeoutMs: 30000,
          animationWaitMs: 3000,
          scrollDelayMs: 150,
          elementsToRemove
        });
      } catch (prepError) {
        console.warn('    Warning: Page preparation failed, continuing...', prepError);
      }

      // Take full page screenshot
      const screenshotBuffer = await newPage.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: this.options.screenshotQuality
      });

      // Save full screenshot as WebP
      const fileName = `${templateData.slug}.webp`;
      const fullPath = path.join(this.screenshotDir, fileName);

      await sharp(screenshotBuffer)
        .resize(1000, null, { withoutEnlargement: true })
        .webp({ quality: this.options.screenshotQuality })
        .toFile(fullPath);

      // Create thumbnail (square crop from top)
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


  private async saveTemplateToDatabase(data: TemplateData) {
    await db.transaction(async (tx) => {
      // Check if template exists
      const existing = await tx.getAsync<{ id: number }>(
        'SELECT id FROM templates WHERE template_id = ?',
        [data.template_id]
      );

      let templateId: number;

      if (existing) {
        // Update existing template
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

        // Clear existing relationships
        await tx.runAsync('DELETE FROM template_subcategories WHERE template_id = ?', [templateId]);
        await tx.runAsync('DELETE FROM template_styles WHERE template_id = ?', [templateId]);
        await tx.runAsync('DELETE FROM template_features WHERE template_id = ?', [templateId]);
      } else {
        // Insert new template
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

        // Ensure subcategory exists
        const subcatId = await this.ensureEntity(tx, 'subcategories', {
          name: subcategory,
          slug,
          display_name: subcategory.charAt(0).toUpperCase() + subcategory.slice(1)
        });

        // Create relationship
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
    });
  }

  private async ensureEntity(
    tx: {
      runAsync: typeof db.runAsync;
      getAsync: typeof db.getAsync;
    },
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

  // Helper to get directory sizes
  async getStorageInfo() {
    const screenshotSize = await this.getDirectorySize(this.screenshotDir);
    const thumbnailSize = await this.getDirectorySize(this.thumbnailDir);
    const dbStats = await db.getStats();

    return {
      screenshotSize,
      thumbnailSize,
      totalSize: screenshotSize + thumbnailSize + dbStats.databaseSize,
      databaseSize: dbStats.databaseSize,
      templateCount: dbStats.templates
    };
  }

  private async getDirectorySize(dir: string): Promise<number> {
    let size = 0;
    try {
      const files = await fs.readdir(dir);
      for (const file of files) {
        const stats = await fs.stat(path.join(dir, file));
        size += stats.size;
      }
    } catch {
      // Directory may not exist yet
    }
    return size;
  }
}

export default WebflowScraper;
