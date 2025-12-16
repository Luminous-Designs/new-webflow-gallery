import sqlite3 from 'sqlite3';
import { promises as fs } from 'fs';
import path from 'path';

const DATABASE_PATH = process.env.DATABASE_PATH || './data/webflow.db';

// Configuration for retry logic
const MAX_RETRIES = 10;
const BASE_RETRY_DELAY_MS = 50;
const MAX_RETRY_DELAY_MS = 2000;
const BUSY_TIMEOUT_MS = 30000; // 30 seconds

type SqlParams = ReadonlyArray<unknown>;

// Check if an error is a SQLite busy/locked error
function isBusyError(error: unknown): boolean {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return message.includes('sqlite_busy') ||
           message.includes('database is locked') ||
           message.includes('sqlite_locked');
  }
  return false;
}

// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Calculate exponential backoff with jitter
function getRetryDelay(attempt: number): number {
  const exponentialDelay = Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, attempt),
    MAX_RETRY_DELAY_MS
  );
  // Add jitter (0-50% of delay)
  const jitter = Math.random() * exponentialDelay * 0.5;
  return Math.floor(exponentialDelay + jitter);
}

class Database {
  private db: sqlite3.Database | null = null;
  private initPromise: Promise<void> | null = null;
  private transactionDepth: number = 0;

  // Write queue to serialize write operations
  private writeQueue: Promise<unknown> = Promise.resolve();
  private writeQueueLength: number = 0;

  private async ensureDirectoryExists() {
    const dbDir = path.dirname(DATABASE_PATH);
    try {
      await fs.mkdir(dbDir, { recursive: true });
    } catch (error) {
      console.error('Error creating database directory:', error);
    }
  }

  private async initialize() {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.doInitialize();
    return this.initPromise;
  }

  private async doInitialize() {
    await this.ensureDirectoryExists();

    return new Promise<void>((resolve, reject) => {
      this.db = new sqlite3.Database(DATABASE_PATH, async (err) => {
        if (err) {
          console.error('Error opening database:', err);
          reject(err);
          return;
        }

        console.log('Connected to SQLite database');

        try {
          // Configure SQLite for better concurrent access
          // WAL mode allows concurrent reads and writes
          await this.runAsyncRaw('PRAGMA journal_mode = WAL');

          // Set busy timeout - wait up to 30 seconds for locks
          await this.runAsyncRaw(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

          // Enable foreign keys
          await this.runAsyncRaw('PRAGMA foreign_keys = ON');

          // Synchronous mode - NORMAL is a good balance of safety and speed
          await this.runAsyncRaw('PRAGMA synchronous = NORMAL');

          // Cache size - increase for better performance (negative = KB)
          await this.runAsyncRaw('PRAGMA cache_size = -64000'); // 64MB

          // Temp store in memory for speed
          await this.runAsyncRaw('PRAGMA temp_store = MEMORY');

          console.log('SQLite configured with WAL mode and busy timeout');

          // Initialize schema
          const schemaPath = path.join(process.cwd(), 'lib', 'db', 'schema.sql');
          const schema = await fs.readFile(schemaPath, 'utf-8');

          // Split by semicolon and execute each statement
          const statements = schema
            .split(';')
            .filter(s => s.trim())
            .map(s => s.trim() + ';');

          for (const statement of statements) {
            await this.runAsyncRaw(statement);
          }

          console.log('Database schema initialized');
          resolve();
        } catch (error) {
          console.error('Error initializing schema:', error);
          reject(error);
        }
      });
    });
  }

  private async getDb(): Promise<sqlite3.Database> {
    if (!this.db) {
      await this.initialize();
    }
    return this.db!;
  }

  // Raw run without retry (for internal use during init)
  private async runAsyncRaw(sql: string, params: SqlParams = []): Promise<{ lastID: number; changes: number }> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      db.run(sql, params, function(this: sqlite3.RunResult, err) {
        if (err) {
          reject(err);
        } else {
          resolve({
            lastID: this.lastID ?? 0,
            changes: this.changes ?? 0
          });
        }
      });
    });
  }

  // Run with retry logic for busy errors
  async runAsync(sql: string, params: SqlParams = []): Promise<{ lastID: number; changes: number }> {
    return this.executeWithRetry(() => this.runAsyncRaw(sql, params), sql);
  }

  // Queued run - serializes write operations to prevent lock contention
  async runAsyncQueued(sql: string, params: SqlParams = []): Promise<{ lastID: number; changes: number }> {
    return this.queueWrite(() => this.runAsync(sql, params));
  }

  // Raw get without retry
  private async getAsyncRaw<T = unknown>(sql: string, params: SqlParams = []): Promise<T | undefined> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve((row as T) ?? undefined);
        }
      });
    });
  }

  // Get with retry logic
  async getAsync<T = unknown>(sql: string, params: SqlParams = []): Promise<T | undefined> {
    return this.executeWithRetry(() => this.getAsyncRaw<T>(sql, params), sql);
  }

  // Raw all without retry
  private async allAsyncRaw<T = unknown>(sql: string, params: SqlParams = []): Promise<T[]> {
    const db = await this.getDb();
    return new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });
  }

  // All with retry logic
  async allAsync<T = unknown>(sql: string, params: SqlParams = []): Promise<T[]> {
    return this.executeWithRetry(() => this.allAsyncRaw<T>(sql, params), sql);
  }

  // Execute with retry for busy errors
  private async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: string = 'unknown'
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        if (isBusyError(error) && attempt < MAX_RETRIES - 1) {
          const delay = getRetryDelay(attempt);
          if (attempt > 2) {
            // Only log after a few retries to reduce noise
            console.warn(`[DB] Retry ${attempt + 1}/${MAX_RETRIES} after ${delay}ms for: ${context.substring(0, 50)}...`);
          }
          await sleep(delay);
        } else {
          throw error;
        }
      }
    }

    throw lastError;
  }

  // Queue write operations to serialize them
  private async queueWrite<T>(operation: () => Promise<T>): Promise<T> {
    this.writeQueueLength++;

    const currentQueue = this.writeQueue;

    const result = currentQueue.then(async () => {
      try {
        return await operation();
      } finally {
        this.writeQueueLength--;
      }
    });

    // Update the queue to include this operation
    this.writeQueue = result.catch(() => {});

    return result;
  }

  // Get current write queue length (for monitoring)
  getWriteQueueLength(): number {
    return this.writeQueueLength;
  }

  async close(): Promise<void> {
    // Wait for any pending writes to complete
    await this.writeQueue;

    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            this.db = null;
            this.initPromise = null;
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }

  // Transaction helper with mutex lock to prevent nested transaction errors
  async transaction<T>(fn: (db: Database) => Promise<T>): Promise<T> {
    // Queue the entire transaction to serialize with other writes
    return this.queueWrite(async () => {
      return this.executeWithRetry(async () => {
        const depth = this.transactionDepth++;
        const savepointName = `sp_${depth}_${Date.now()}`;

        try {
          if (depth === 0) {
            // Top-level transaction - use IMMEDIATE to acquire write lock immediately
            await this.runAsyncRaw('BEGIN IMMEDIATE TRANSACTION');
          } else {
            // Nested transaction - use savepoint
            await this.runAsyncRaw(`SAVEPOINT ${savepointName}`);
          }

          const result = await fn(this);

          if (depth === 0) {
            await this.runAsyncRaw('COMMIT');
          } else {
            await this.runAsyncRaw(`RELEASE SAVEPOINT ${savepointName}`);
          }

          return result;
        } catch (error) {
          try {
            if (depth === 0) {
              await this.runAsyncRaw('ROLLBACK');
            } else {
              await this.runAsyncRaw(`ROLLBACK TO SAVEPOINT ${savepointName}`);
            }
          } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError);
          }
          throw error;
        } finally {
          this.transactionDepth--;
        }
      }, 'transaction');
    });
  }

  // Utility method to get database stats
  async getStats() {
    const [templates, subcategories, styles, features, authors, jobs, visitors, purchases] = await Promise.all([
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM templates'),
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM subcategories'),
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM styles'),
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM features'),
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM featured_authors WHERE is_active = 1'),
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM scrape_jobs'),
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM visitors WHERE datetime(last_activity) > datetime("now", "-5 minutes")'),
      this.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM purchases WHERE status = "completed"'),
    ]);

    const dbSize = await this.getDatabaseSize();

    return {
      templates: templates?.count || 0,
      subcategories: subcategories?.count || 0,
      styles: styles?.count || 0,
      features: features?.count || 0,
      featuredAuthors: authors?.count || 0,
      scrapeJobs: jobs?.count || 0,
      activeVisitors: visitors?.count || 0,
      completedPurchases: purchases?.count || 0,
      databaseSize: dbSize,
    };
  }

  private async getDatabaseSize(): Promise<number> {
    try {
      const stats = await fs.stat(DATABASE_PATH);
      return stats.size;
    } catch {
      return 0;
    }
  }

  async getUltraFeaturedTemplates() {
    const rows = await this.allAsync<(Template & { position: number; subcategories?: string; styles?: string })>(
      `SELECT
          t.id,
          t.template_id,
          t.name,
          t.slug,
          t.author_name,
          t.author_id,
          t.storefront_url,
          t.live_preview_url,
          t.designer_preview_url,
          t.price,
          t.short_description,
          t.screenshot_path,
          t.screenshot_thumbnail_path,
          t.is_featured,
          t.is_cms,
          t.is_ecommerce,
          t.created_at,
          t.updated_at,
          uft.position,
          GROUP_CONCAT(DISTINCT s.name) as subcategories,
          GROUP_CONCAT(DISTINCT st.name) as styles
       FROM ultra_featured_templates uft
       JOIN templates t ON t.id = uft.template_id
       LEFT JOIN template_subcategories ts ON t.id = ts.template_id
       LEFT JOIN subcategories s ON ts.subcategory_id = s.id
       LEFT JOIN template_styles tst ON t.id = tst.template_id
       LEFT JOIN styles st ON tst.style_id = st.id
       GROUP BY t.id
       ORDER BY uft.position ASC`
    );

    return rows.map(row => ({
      ...row,
      subcategories: row.subcategories ? row.subcategories.split(',') : [],
      styles: row.styles ? row.styles.split(',') : []
    }));
  }

  async replaceUltraFeaturedTemplates(templateIds: number[]) {
    await this.transaction(async (tx) => {
      await tx.runAsync('DELETE FROM ultra_featured_templates');

      for (let index = 0; index < templateIds.length; index++) {
        const templateId = templateIds[index];
        await tx.runAsync(
          `INSERT INTO ultra_featured_templates (template_id, position)
           VALUES (?, ?)`,
          [templateId, index + 1]
        );
      }
    });
  }

  async searchTemplates(query: string, limit = 10) {
    const likeQuery = `%${query.toLowerCase()}%`;
    const rows = await this.allAsync<(Template & { subcategories?: string; styles?: string })>(
      `SELECT DISTINCT
         t.id,
         t.template_id,
         t.name,
         t.slug,
         t.author_name,
         t.author_id,
         t.storefront_url,
         t.live_preview_url,
         t.designer_preview_url,
         t.price,
         t.short_description,
         t.screenshot_path,
         t.screenshot_thumbnail_path,
         t.is_featured,
         t.is_cms,
         t.is_ecommerce,
         t.created_at,
         t.updated_at,
         GROUP_CONCAT(DISTINCT s.name) as subcategories,
         GROUP_CONCAT(DISTINCT st.name) as styles
       FROM templates t
       LEFT JOIN template_subcategories ts ON t.id = ts.template_id
       LEFT JOIN subcategories s ON ts.subcategory_id = s.id
       LEFT JOIN template_styles tst ON t.id = tst.template_id
       LEFT JOIN styles st ON tst.style_id = st.id
       WHERE LOWER(t.name) LIKE ?
          OR LOWER(t.slug) LIKE ?
          OR LOWER(s.name) LIKE ?
          OR LOWER(st.name) LIKE ?
       GROUP BY t.id
       ORDER BY t.updated_at DESC
       LIMIT ?`,
      [likeQuery, likeQuery, likeQuery, likeQuery, limit]
    );

    return rows.map(row => ({
      ...row,
      subcategories: row.subcategories ? row.subcategories.split(',') : [],
      styles: row.styles ? row.styles.split(',') : []
    }));
  }
}

// Export singleton instance
export const db = new Database();

// Export types
export interface Template {
  id?: number;
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
  screenshot_path?: string;
  screenshot_thumbnail_path?: string;
  is_featured?: boolean;
  is_cms?: boolean;
  is_ecommerce?: boolean;
  // Alternate homepage detection fields
  screenshot_url?: string;
  is_alternate_homepage?: boolean;
  alternate_homepage_path?: string;
  subcategories?: string[];
  styles?: string[];
  scraped_at?: Date;
  updated_at?: Date;
  created_at?: Date;
}

export interface Subcategory {
  id?: number;
  name: string;
  slug: string;
  display_name: string;
}

export interface Style {
  id?: number;
  name: string;
  slug: string;
  display_name: string;
}

export interface Feature {
  id?: number;
  name: string;
  slug: string;
  display_name: string;
  description?: string;
  icon_type?: string;
}

export interface ScrapeJob {
  id?: number;
  job_type: 'full' | 'update' | 'single';
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  total_templates?: number;
  processed_templates?: number;
  successful_templates?: number;
  failed_templates?: number;
  error_message?: string;
  started_at?: Date;
  completed_at?: Date;
  created_at?: Date;
}

export interface Visitor {
  id?: number;
  session_id: string;
  ip_address?: string;
  user_agent?: string;
  current_step?: string;
  selected_template_id?: number;
  form_data?: string;
  first_visit?: Date;
  last_activity?: Date;
}

export interface Purchase {
  id?: number;
  visitor_id: number;
  template_id: number;
  customer_name: string;
  customer_email: string;
  business_details?: string;
  website_url?: string;
  page_count?: number;
  amount?: number;
  stripe_payment_id?: string;
  stripe_customer_id?: string;
  status?: 'pending' | 'completed' | 'failed';
  created_at?: Date;
}

export interface ScreenshotExclusion {
  id?: number;
  selector: string;
  selector_type: 'class' | 'id' | 'selector';
  description?: string;
  is_active: boolean;
  created_at?: Date;
  updated_at?: Date;
}

// ============================================
// BATCH SCRAPING SYSTEM TYPES
// ============================================

export type ScrapeSessionType = 'full' | 'update' | 'screenshot_update' | 'thumbnail_update';
export type ScrapeSessionStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type BatchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';
export type BatchTemplateStatus = 'pending' | 'scraping_details' | 'taking_screenshot' | 'processing_thumbnail' | 'saving' | 'completed' | 'failed' | 'skipped';
export type BlacklistReason = 'manual_skip' | 'error_threshold' | 'admin_blocked';

export interface ScrapeSessionConfig {
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
}

export interface ScrapeSession {
  id?: number;
  session_type: ScrapeSessionType;
  status: ScrapeSessionStatus;
  total_templates: number;
  processed_templates: number;
  successful_templates: number;
  failed_templates: number;
  skipped_templates: number;
  batch_size: number;
  total_batches: number;
  current_batch_number: number;
  sitemap_snapshot?: string; // JSON array
  config?: string; // JSON
  error_message?: string;
  started_at?: string;
  paused_at?: string;
  resumed_at?: string;
  completed_at?: string;
  created_at?: string;
}

export interface ScrapeBatch {
  id?: number;
  session_id: number;
  batch_number: number;
  status: BatchStatus;
  total_templates: number;
  processed_templates: number;
  successful_templates: number;
  failed_templates: number;
  skipped_templates: number;
  started_at?: string;
  completed_at?: string;
  created_at?: string;
}

export interface BatchTemplate {
  id?: number;
  batch_id: number;
  session_id: number;
  template_url: string;
  template_slug?: string;
  template_name?: string;
  live_preview_url?: string;
  status: BatchTemplateStatus;
  phase_started_at?: string;
  phase_duration_seconds: number;
  retry_count: number;
  error_message?: string;
  result_template_id?: number;
  created_at?: string;
  completed_at?: string;
}

export interface TemplateBlacklist {
  id?: number;
  domain_slug: string;
  storefront_url?: string;
  reason: BlacklistReason;
  created_at?: string;
  updated_at?: string;
}

export interface SessionResumePoint {
  id?: number;
  session_id: number;
  last_completed_batch_id?: number;
  last_completed_template_id?: number;
  remaining_urls?: string; // JSON array
  checkpoint_data?: string; // JSON
  created_at?: string;
  updated_at?: string;
}

/**
 * Get all active screenshot exclusion selectors
 */
export async function getActiveScreenshotExclusions(): Promise<string[]> {
  const exclusions = await db.allAsync<ScreenshotExclusion>(
    `SELECT selector, selector_type FROM screenshot_exclusions WHERE is_active = 1`
  );

  return exclusions.map(exc => {
    // Normalize selector based on type
    if (exc.selector_type === 'class' && !exc.selector.startsWith('.')) {
      return `.${exc.selector}`;
    }
    if (exc.selector_type === 'id' && !exc.selector.startsWith('#')) {
      return `#${exc.selector}`;
    }
    return exc.selector;
  });
}

// ============================================
// BATCH SCRAPING SYSTEM FUNCTIONS
// ============================================

/**
 * Extract domain slug from a live preview URL
 * e.g., "https://template-name.webflow.io" -> "template-name"
 */
export function extractDomainSlug(livePreviewUrl: string): string | null {
  try {
    const url = new URL(livePreviewUrl);
    const hostname = url.hostname;
    // Extract subdomain from webflow.io domain
    if (hostname.endsWith('.webflow.io')) {
      return hostname.replace('.webflow.io', '');
    }
    // For custom domains, use the full hostname
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Check if a template is blacklisted
 */
export async function isTemplateBlacklisted(livePreviewUrl: string): Promise<boolean> {
  const domainSlug = extractDomainSlug(livePreviewUrl);
  if (!domainSlug) return false;

  const result = await db.getAsync<{ id: number }>(
    'SELECT id FROM template_blacklist WHERE domain_slug = ?',
    [domainSlug]
  );
  return !!result;
}

/**
 * Add a template to the blacklist
 */
export async function blacklistTemplate(
  livePreviewUrl: string,
  storefrontUrl?: string,
  reason: BlacklistReason = 'manual_skip'
): Promise<number | null> {
  const domainSlug = extractDomainSlug(livePreviewUrl);
  if (!domainSlug) return null;

  try {
    const { lastID } = await db.runAsync(
      `INSERT OR REPLACE INTO template_blacklist (domain_slug, storefront_url, reason, updated_at)
       VALUES (?, ?, ?, datetime('now'))`,
      [domainSlug, storefrontUrl, reason]
    );
    return lastID;
  } catch (error) {
    console.error('Error blacklisting template:', error);
    return null;
  }
}

/**
 * Remove a template from the blacklist
 */
export async function unblacklistTemplate(domainSlug: string): Promise<boolean> {
  const { changes } = await db.runAsync(
    'DELETE FROM template_blacklist WHERE domain_slug = ?',
    [domainSlug]
  );
  return changes > 0;
}

/**
 * Get all blacklisted templates
 */
export async function getBlacklistedTemplates(): Promise<TemplateBlacklist[]> {
  return db.allAsync<TemplateBlacklist>(
    'SELECT * FROM template_blacklist ORDER BY created_at DESC'
  );
}

/**
 * Get all blacklisted domain slugs as a Set for efficient lookup
 */
export async function getBlacklistSet(): Promise<Set<string>> {
  const blacklist = await db.allAsync<{ domain_slug: string }>(
    'SELECT domain_slug FROM template_blacklist'
  );
  return new Set(blacklist.map(b => b.domain_slug));
}

/**
 * Create a new scrape session
 */
export async function createScrapeSession(
  sessionType: ScrapeSessionType,
  urls: string[],
  config: ScrapeSessionConfig
): Promise<ScrapeSession> {
  const batchSize = config.batchSize;
  const totalBatches = Math.ceil(urls.length / batchSize);

  const { lastID } = await db.runAsync(
    `INSERT INTO scrape_sessions (
      session_type, status, total_templates, batch_size, total_batches,
      sitemap_snapshot, config, started_at
    ) VALUES (?, 'running', ?, ?, ?, ?, ?, datetime('now'))`,
    [
      sessionType,
      urls.length,
      batchSize,
      totalBatches,
      JSON.stringify(urls),
      JSON.stringify(config)
    ]
  );

  return (await db.getAsync<ScrapeSession>(
    'SELECT * FROM scrape_sessions WHERE id = ?',
    [lastID]
  ))!;
}

/**
 * Create a batch within a session
 */
export async function createBatch(
  sessionId: number,
  batchNumber: number,
  templateUrls: string[]
): Promise<ScrapeBatch> {
  const { lastID: batchId } = await db.runAsync(
    `INSERT INTO scrape_batches (session_id, batch_number, status, total_templates)
     VALUES (?, ?, 'pending', ?)`,
    [sessionId, batchNumber, templateUrls.length]
  );

  // Create batch template entries
  for (const url of templateUrls) {
    const slug = url.split('/').pop()?.replace('-website-template', '') || '';
    await db.runAsync(
      `INSERT INTO batch_templates (batch_id, session_id, template_url, template_slug, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [batchId, sessionId, url, slug]
    );
  }

  return (await db.getAsync<ScrapeBatch>(
    'SELECT * FROM scrape_batches WHERE id = ?',
    [batchId]
  ))!;
}

/**
 * Update batch template status with phase tracking
 */
export async function updateBatchTemplateStatus(
  templateId: number,
  status: BatchTemplateStatus,
  additionalData?: {
    template_name?: string;
    live_preview_url?: string;
    error_message?: string;
    result_template_id?: number;
  }
): Promise<void> {
  const updates = ['status = ?', 'phase_started_at = datetime("now")'];
  const params: unknown[] = [status];

  if (additionalData?.template_name) {
    updates.push('template_name = ?');
    params.push(additionalData.template_name);
  }
  if (additionalData?.live_preview_url) {
    updates.push('live_preview_url = ?');
    params.push(additionalData.live_preview_url);
  }
  if (additionalData?.error_message) {
    updates.push('error_message = ?');
    params.push(additionalData.error_message);
  }
  if (additionalData?.result_template_id) {
    updates.push('result_template_id = ?');
    params.push(additionalData.result_template_id);
  }

  if (status === 'completed' || status === 'failed' || status === 'skipped') {
    updates.push('completed_at = datetime("now")');
  }

  params.push(templateId);

  await db.runAsync(
    `UPDATE batch_templates SET ${updates.join(', ')} WHERE id = ?`,
    params
  );

  // Also calculate phase duration
  await db.runAsync(
    `UPDATE batch_templates
     SET phase_duration_seconds = CAST((julianday(datetime('now')) - julianday(phase_started_at)) * 86400 AS INTEGER)
     WHERE id = ?`,
    [templateId]
  );
}

/**
 * Update batch progress counters
 */
export async function updateBatchProgress(
  batchId: number,
  increment: { processed?: number; successful?: number; failed?: number; skipped?: number }
): Promise<void> {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (increment.processed) {
    updates.push('processed_templates = processed_templates + ?');
    params.push(increment.processed);
  }
  if (increment.successful) {
    updates.push('successful_templates = successful_templates + ?');
    params.push(increment.successful);
  }
  if (increment.failed) {
    updates.push('failed_templates = failed_templates + ?');
    params.push(increment.failed);
  }
  if (increment.skipped) {
    updates.push('skipped_templates = skipped_templates + ?');
    params.push(increment.skipped);
  }

  if (updates.length > 0) {
    params.push(batchId);
    await db.runAsync(
      `UPDATE scrape_batches SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }
}

/**
 * Update session progress counters
 */
export async function updateSessionProgress(
  sessionId: number,
  increment: { processed?: number; successful?: number; failed?: number; skipped?: number }
): Promise<void> {
  const updates: string[] = [];
  const params: unknown[] = [];

  if (increment.processed) {
    updates.push('processed_templates = processed_templates + ?');
    params.push(increment.processed);
  }
  if (increment.successful) {
    updates.push('successful_templates = successful_templates + ?');
    params.push(increment.successful);
  }
  if (increment.failed) {
    updates.push('failed_templates = failed_templates + ?');
    params.push(increment.failed);
  }
  if (increment.skipped) {
    updates.push('skipped_templates = skipped_templates + ?');
    params.push(increment.skipped);
  }

  if (updates.length > 0) {
    params.push(sessionId);
    await db.runAsync(
      `UPDATE scrape_sessions SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
  }
}

/**
 * Get templates for a batch with their current status
 */
export async function getBatchTemplates(batchId: number): Promise<BatchTemplate[]> {
  return db.allAsync<BatchTemplate>(
    'SELECT * FROM batch_templates WHERE batch_id = ? ORDER BY id',
    [batchId]
  );
}

/**
 * Get current batch for a session
 */
export async function getCurrentBatch(sessionId: number): Promise<ScrapeBatch | undefined> {
  return db.getAsync<ScrapeBatch>(
    `SELECT * FROM scrape_batches
     WHERE session_id = ? AND status IN ('pending', 'running')
     ORDER BY batch_number ASC LIMIT 1`,
    [sessionId]
  );
}

/**
 * Get session by ID
 */
export async function getSession(sessionId: number): Promise<ScrapeSession | undefined> {
  return db.getAsync<ScrapeSession>(
    'SELECT * FROM scrape_sessions WHERE id = ?',
    [sessionId]
  );
}

/**
 * Get active/paused sessions that can be resumed
 */
export async function getResumableSessions(): Promise<ScrapeSession[]> {
  return db.allAsync<ScrapeSession>(
    `SELECT * FROM scrape_sessions
     WHERE status IN ('running', 'paused')
     ORDER BY created_at DESC`
  );
}

/**
 * Check for interrupted sessions on startup
 */
export async function getInterruptedSession(): Promise<ScrapeSession | undefined> {
  return db.getAsync<ScrapeSession>(
    `SELECT * FROM scrape_sessions
     WHERE status = 'running'
     ORDER BY created_at DESC LIMIT 1`
  );
}

/**
 * Pause a session
 */
export async function pauseSession(sessionId: number): Promise<void> {
  await db.runAsync(
    `UPDATE scrape_sessions SET status = 'paused', paused_at = datetime('now') WHERE id = ?`,
    [sessionId]
  );

  // Also pause any running batches
  await db.runAsync(
    `UPDATE scrape_batches SET status = 'paused' WHERE session_id = ? AND status = 'running'`,
    [sessionId]
  );
}

/**
 * Resume a paused session
 */
export async function resumeSession(sessionId: number): Promise<void> {
  await db.runAsync(
    `UPDATE scrape_sessions SET status = 'running', resumed_at = datetime('now') WHERE id = ?`,
    [sessionId]
  );
}

/**
 * Complete a batch
 */
export async function completeBatch(batchId: number): Promise<void> {
  await db.runAsync(
    `UPDATE scrape_batches SET status = 'completed', completed_at = datetime('now') WHERE id = ?`,
    [batchId]
  );
}

/**
 * Start a batch
 */
export async function startBatch(batchId: number): Promise<void> {
  await db.runAsync(
    `UPDATE scrape_batches SET status = 'running', started_at = datetime('now') WHERE id = ?`,
    [batchId]
  );
}

/**
 * Complete a session
 */
export async function completeSession(sessionId: number, status: 'completed' | 'failed' | 'cancelled' = 'completed'): Promise<void> {
  await db.runAsync(
    `UPDATE scrape_sessions SET status = ?, completed_at = datetime('now') WHERE id = ?`,
    [status, sessionId]
  );
}

/**
 * Update session's current batch number
 */
export async function updateSessionCurrentBatch(sessionId: number, batchNumber: number): Promise<void> {
  await db.runAsync(
    `UPDATE scrape_sessions SET current_batch_number = ? WHERE id = ?`,
    [batchNumber, sessionId]
  );
}

/**
 * Skip a template in a batch (marks as skipped and blacklists)
 */
export async function skipBatchTemplate(
  templateId: number,
  blacklist: boolean = true
): Promise<{ success: boolean; replacementUrl?: string }> {
  const template = await db.getAsync<BatchTemplate>(
    'SELECT * FROM batch_templates WHERE id = ?',
    [templateId]
  );

  if (!template) {
    return { success: false };
  }

  // Update template status
  await updateBatchTemplateStatus(templateId, 'skipped');

  // Update batch and session counters
  await updateBatchProgress(template.batch_id, { processed: 1, skipped: 1 });
  await updateSessionProgress(template.session_id, { processed: 1, skipped: 1 });

  // Blacklist if requested
  if (blacklist && template.live_preview_url) {
    await blacklistTemplate(template.live_preview_url, template.template_url, 'manual_skip');
  }

  // Try to find a replacement template from the session's remaining URLs
  const session = await getSession(template.session_id);
  if (session?.sitemap_snapshot) {
    const allUrls = JSON.parse(session.sitemap_snapshot) as string[];
    const processedUrls = await db.allAsync<{ template_url: string }>(
      'SELECT template_url FROM batch_templates WHERE session_id = ?',
      [template.session_id]
    );
    const processedSet = new Set(processedUrls.map(p => p.template_url));

    // Find next unprocessed URL
    const nextUrl = allUrls.find(url => !processedSet.has(url));
    if (nextUrl) {
      return { success: true, replacementUrl: nextUrl };
    }
  }

  return { success: true };
}

/**
 * Get real-time progress for a session including current batch details
 */
export async function getSessionProgress(sessionId: number): Promise<{
  session: ScrapeSession;
  currentBatch: ScrapeBatch | null;
  batchTemplates: BatchTemplate[];
  allBatches: ScrapeBatch[];
}> {
  const session = await getSession(sessionId);
  if (!session) {
    throw new Error('Session not found');
  }

  const currentBatch = await getCurrentBatch(sessionId) || null;
  const batchTemplates = currentBatch
    ? await getBatchTemplates(currentBatch.id!)
    : [];

  const allBatches = await db.allAsync<ScrapeBatch>(
    'SELECT * FROM scrape_batches WHERE session_id = ? ORDER BY batch_number',
    [sessionId]
  );

  return { session, currentBatch, batchTemplates, allBatches };
}

/**
 * Save a resume point for a session
 */
export async function saveResumePoint(
  sessionId: number,
  lastBatchId?: number,
  lastTemplateId?: number,
  remainingUrls?: string[],
  checkpointData?: Record<string, unknown>
): Promise<void> {
  await db.runAsync(
    `INSERT OR REPLACE INTO session_resume_points
     (session_id, last_completed_batch_id, last_completed_template_id, remaining_urls, checkpoint_data, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))`,
    [
      sessionId,
      lastBatchId || null,
      lastTemplateId || null,
      remainingUrls ? JSON.stringify(remainingUrls) : null,
      checkpointData ? JSON.stringify(checkpointData) : null
    ]
  );
}

/**
 * Get resume point for a session
 */
export async function getResumePoint(sessionId: number): Promise<SessionResumePoint | undefined> {
  return db.getAsync<SessionResumePoint>(
    'SELECT * FROM session_resume_points WHERE session_id = ?',
    [sessionId]
  );
}

// ============================================
// ALTERNATE HOMEPAGE DETECTION FUNCTIONS
// ============================================

export interface AlternateHomepageMetrics {
  totalTemplates: number;
  alternateHomepageCount: number;
  indexPageCount: number;
  alternatePercentage: number;
  topAlternatePaths: Array<{ path: string; count: number }>;
}

/**
 * Get metrics for alternate homepage scrapes
 */
export async function getAlternateHomepageMetrics(): Promise<AlternateHomepageMetrics> {
  const [total, alternate, pathCounts] = await Promise.all([
    db.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM templates'),
    db.getAsync<{ count: number }>('SELECT COUNT(*) as count FROM templates WHERE is_alternate_homepage = 1'),
    db.allAsync<{ path: string; count: number }>(
      `SELECT alternate_homepage_path as path, COUNT(*) as count
       FROM templates
       WHERE is_alternate_homepage = 1 AND alternate_homepage_path IS NOT NULL
       GROUP BY alternate_homepage_path
       ORDER BY count DESC
       LIMIT 10`
    )
  ]);

  const totalCount = total?.count || 0;
  const alternateCount = alternate?.count || 0;
  const indexCount = totalCount - alternateCount;
  const percentage = totalCount > 0 ? (alternateCount / totalCount) * 100 : 0;

  return {
    totalTemplates: totalCount,
    alternateHomepageCount: alternateCount,
    indexPageCount: indexCount,
    alternatePercentage: Math.round(percentage * 10) / 10,
    topAlternatePaths: pathCounts
  };
}

/**
 * Get templates with alternate homepage screenshots
 */
export async function getAlternateHomepageTemplates(limit = 50): Promise<Template[]> {
  return db.allAsync<Template>(
    `SELECT * FROM templates
     WHERE is_alternate_homepage = 1
     ORDER BY updated_at DESC
     LIMIT ?`,
    [limit]
  );
}

/**
 * Run migrations to add alternate homepage columns if they don't exist
 */
export async function runAlternateHomepageMigration(): Promise<void> {
  try {
    // Check if columns exist by querying table info
    const tableInfo = await db.allAsync<{ name: string }>(
      `PRAGMA table_info(templates)`
    );

    const columnNames = tableInfo.map(col => col.name);

    // Add missing columns
    if (!columnNames.includes('screenshot_url')) {
      await db.runAsync(`ALTER TABLE templates ADD COLUMN screenshot_url TEXT`);
      console.log('Added screenshot_url column to templates table');
    }

    if (!columnNames.includes('is_alternate_homepage')) {
      await db.runAsync(`ALTER TABLE templates ADD COLUMN is_alternate_homepage BOOLEAN DEFAULT 0`);
      console.log('Added is_alternate_homepage column to templates table');
    }

    if (!columnNames.includes('alternate_homepage_path')) {
      await db.runAsync(`ALTER TABLE templates ADD COLUMN alternate_homepage_path TEXT`);
      console.log('Added alternate_homepage_path column to templates table');
    }
  } catch (error) {
    console.error('Migration error (may be safe to ignore if columns exist):', error);
  }
}
