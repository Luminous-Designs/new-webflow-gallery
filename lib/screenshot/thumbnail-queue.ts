import path from 'path';
import { promises as fs } from 'fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { db, getActiveScreenshotExclusions } from '@/lib/db';
import { preparePageForScreenshot } from './prepare';

const SCREENSHOT_DIR = path.join(process.cwd(), 'public', 'screenshots');
const THUMBNAIL_DIR = path.join(process.cwd(), 'public', 'thumbnails');
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 3000;

type ThumbnailJobStatus = 'pending' | 'running' | 'completed' | 'failed';

interface ThumbnailJobRecord {
  id: number;
  template_id: number;
  target_url: string;
  status: ThumbnailJobStatus;
  attempts: number;
  error_message?: string | null;
  screenshot_path?: string | null;
  screenshot_thumbnail_path?: string | null;
  created_at: string;
  started_at?: string | null;
  completed_at?: string | null;
  requested_by?: string | null;
}

export interface ThumbnailJobSummary extends ThumbnailJobRecord {
  template_name: string;
  template_slug: string;
}

interface EnqueueOptions {
  templateId: number;
  targetUrl: string;
  requestedBy?: string;
}

async function ensureDirectories() {
  await Promise.all([
    fs.mkdir(SCREENSHOT_DIR, { recursive: true }),
    fs.mkdir(THUMBNAIL_DIR, { recursive: true })
  ]);
}

class ThumbnailQueue {
  private static instance: ThumbnailQueue;
  private processing = false;
  private recovered = false;

  private constructor() {}

  static getInstance() {
    if (!ThumbnailQueue.instance) {
      ThumbnailQueue.instance = new ThumbnailQueue();
    }
    return ThumbnailQueue.instance;
  }

  async enqueue(options: EnqueueOptions): Promise<ThumbnailJobSummary> {
    await this.recoverRunningJobs();

    const { lastID } = await db.runAsync(
      `INSERT INTO thumbnail_jobs (template_id, target_url, requested_by)
       VALUES (?, ?, ?)`,
      [options.templateId, options.targetUrl, options.requestedBy || 'admin']
    );

    const job = await this.getJobWithTemplate(lastID);
    this.ensureProcessing();
    return job;
  }

  async getSummary(limit = 20): Promise<{ jobs: ThumbnailJobSummary[]; counts: Record<ThumbnailJobStatus, number> }> {
    await this.recoverRunningJobs();

    const jobs = await db.allAsync<ThumbnailJobSummary>(
      `SELECT j.*, t.name as template_name, t.slug as template_slug
       FROM thumbnail_jobs j
       JOIN templates t ON t.id = j.template_id
       ORDER BY j.created_at DESC, j.id DESC
       LIMIT ?`,
      [Math.max(1, Math.min(limit, 100))]
    );

    const countRows = await db.allAsync<{ status: ThumbnailJobStatus; count: number }>(
      `SELECT status, COUNT(*) as count FROM thumbnail_jobs GROUP BY status`
    );

    const counts: Record<ThumbnailJobStatus, number> = {
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0
    };

    for (const row of countRows) {
      if (row.status in counts) {
        counts[row.status] = row.count;
      }
    }

    return { jobs, counts };
  }

  private ensureProcessing() {
    if (this.processing) return;
    this.processing = true;
    void this.processLoop().catch((error) => {
      console.error('[thumbnailQueue] processing loop error:', error);
      this.processing = false;
      setTimeout(() => this.ensureProcessing(), RETRY_DELAY_MS);
    });
  }

  private async processLoop() {
    await this.recoverRunningJobs();

    try {
      while (true) {
        const job = await db.getAsync<ThumbnailJobRecord>(
          `SELECT * FROM thumbnail_jobs
           WHERE status = 'pending'
           ORDER BY created_at ASC, id ASC
           LIMIT 1`
        );

        if (!job) {
          break;
        }

        await this.processJob(job);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(job: ThumbnailJobRecord) {
    await db.runAsync(
      `UPDATE thumbnail_jobs
       SET status = 'running', started_at = datetime('now'), attempts = attempts + 1, error_message = NULL
       WHERE id = ?`,
      [job.id]
    );

    const refreshedJob = await db.getAsync<ThumbnailJobRecord>('SELECT * FROM thumbnail_jobs WHERE id = ?', [job.id]);
    const attempts = refreshedJob?.attempts ?? job.attempts + 1;

    try {
      const result = await this.captureThumbnail(refreshedJob ?? job);
      await db.runAsync(
        `UPDATE thumbnail_jobs
         SET status = 'completed', screenshot_path = ?, screenshot_thumbnail_path = ?, completed_at = datetime('now')
         WHERE id = ?`,
        [result.full, result.thumbnail, job.id]
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const shouldRetry = attempts < MAX_ATTEMPTS;

      await db.runAsync(
        `UPDATE thumbnail_jobs
         SET status = ?, error_message = ?, started_at = NULL,
             completed_at = CASE WHEN ? = 'failed' THEN datetime('now') ELSE NULL END
         WHERE id = ?`,
        [shouldRetry ? 'pending' : 'failed', message, shouldRetry ? 'pending' : 'failed', job.id]
      );

      if (shouldRetry) {
        await this.delay(RETRY_DELAY_MS);
      } else {
        console.error(`[thumbnailQueue] job ${job.id} failed: ${message}`);
      }
    }
  }

  private async captureThumbnail(job: ThumbnailJobRecord): Promise<{ full: string; thumbnail: string }> {
    const template = await db.getAsync<{
      id: number;
      slug: string;
      live_preview_url: string;
      name: string;
    }>('SELECT id, slug, live_preview_url, name FROM templates WHERE id = ?', [job.template_id]);

    if (!template || !template.live_preview_url) {
      throw new Error('Template not found or missing preview URL');
    }

    await ensureDirectories();

    const screenshotQuality = parseInt(process.env.SCREENSHOT_QUALITY || '85', 10);
    const timeout = 45000;

    // Get active element exclusions from database
    let elementsToRemove: string[] = [];
    try {
      elementsToRemove = await getActiveScreenshotExclusions();
    } catch (err) {
      console.warn('[thumbnailQueue] Could not fetch element exclusions:', err);
    }

    const browser = await chromium.launch({ headless: true });
    let context: BrowserContext | null = null;
    let page: Page | null = null;

    try {
      context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      page = await context.newPage();
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);

      await page.goto(job.target_url, { waitUntil: 'domcontentloaded', timeout });

      // Prepare page for screenshot
      try {
        await preparePageForScreenshot(page, {
          loadTimeoutMs: 30000,
          animationWaitMs: 3000,
          scrollDelayMs: 150,
          elementsToRemove
        });
      } catch (prepError) {
        console.warn(`[thumbnailQueue] Page preparation warning (${template.slug})`, prepError);
      }

      const screenshotBuffer = await page.screenshot({
        fullPage: true,
        type: 'jpeg',
        quality: screenshotQuality
      });

      const fileName = `${template.slug}.webp`;
      const fullPath = path.join(SCREENSHOT_DIR, fileName);

      await sharp(screenshotBuffer)
        .resize(1000, null, { withoutEnlargement: true })
        .webp({ quality: screenshotQuality })
        .toFile(fullPath);

      const thumbnailName = `${template.slug}_thumb.webp`;
      const thumbnailPath = path.join(THUMBNAIL_DIR, thumbnailName);

      await sharp(screenshotBuffer)
        .resize(500, 500, { fit: 'cover', position: 'top' })
        .webp({ quality: Math.max(10, screenshotQuality - 10) })
        .toFile(thumbnailPath);

      await db.runAsync(
        `UPDATE templates
         SET screenshot_path = ?, screenshot_thumbnail_path = ?, updated_at = datetime('now')
         WHERE id = ?`,
        [`/screenshots/${fileName}`, `/thumbnails/${thumbnailName}`, template.id]
      );

      return {
        full: `/screenshots/${fileName}`,
        thumbnail: `/thumbnails/${thumbnailName}`
      };
    } finally {
      if (page) {
        await page.close().catch(() => undefined);
      }
      if (context) {
        await context.close().catch(() => undefined);
      }
      await browser.close().catch(() => undefined);
    }
  }

  private async getJobWithTemplate(id: number): Promise<ThumbnailJobSummary> {
    const job = await db.getAsync<ThumbnailJobSummary>(
      `SELECT j.*, t.name as template_name, t.slug as template_slug
       FROM thumbnail_jobs j
       JOIN templates t ON t.id = j.template_id
       WHERE j.id = ?`,
      [id]
    );
    if (!job) {
      throw new Error(`Thumbnail job ${id} not found after enqueue`);
    }
    return job;
  }

  private async recoverRunningJobs() {
    if (this.recovered) {
      return;
    }
    this.recovered = true;
    try {
      await db.runAsync(
        `UPDATE thumbnail_jobs
         SET status = 'pending', started_at = NULL
         WHERE status = 'running'`
      );
    } catch (error) {
      console.error('[thumbnailQueue] recovery error:', error);
    }
  }

  private async delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export const thumbnailQueue = ThumbnailQueue.getInstance();
