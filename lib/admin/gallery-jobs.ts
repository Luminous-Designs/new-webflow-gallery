import { FreshScraper, type FreshScraperConfig } from '@/lib/scraper/fresh-scraper';

export type AdminGalleryJobType =
  | 'retake_screenshot'
  | 'retake_screenshot_remove_selector'
  | 'retake_author_remove_selector'
  | 'change_homepage';

export type AdminGalleryJobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled';

export interface AdminGalleryJobItem {
  templateId: number;
  slug: string;
  name: string | null;
  storefrontUrl: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'canceled';
  screenshotPath?: string;
  error?: string;
}

export interface AdminGalleryJob {
  id: string;
  type: AdminGalleryJobType;
  status: AdminGalleryJobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  createdByEmail: string;

  templateId?: number;
  templateSlug?: string;
  templateName?: string | null;
  authorId?: string | null;
  authorName?: string | null;

  selector?: string;
  homepageUrl?: string;
  config: Partial<FreshScraperConfig>;

  progress: { processed: number; total: number };
  items: AdminGalleryJobItem[];

  lastError?: string;
}

function newJobId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `job_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function getSerialScreenshotDefaults(): Pick<
  FreshScraperConfig,
  | 'jobMode'
  | 'concurrency'
  | 'browserInstances'
  | 'pagesPerBrowser'
  | 'batchSize'
  | 'timeout'
  | 'screenshotAnimationWaitMs'
  | 'screenshotNudgeScrollRatio'
  | 'screenshotNudgeWaitMs'
  | 'screenshotNudgeAfterMs'
  | 'screenshotStabilityStableMs'
  | 'screenshotStabilityMaxWaitMs'
  | 'screenshotStabilityCheckIntervalMs'
  | 'screenshotJpegQuality'
  | 'screenshotWebpQuality'
> {
  return {
    jobMode: 'screenshots_only',
    concurrency: 1,
    browserInstances: 1,
    pagesPerBrowser: 1,
    batchSize: 1,
    timeout: 60_000,
    screenshotAnimationWaitMs: 3000,
    screenshotNudgeScrollRatio: 0.2,
    screenshotNudgeWaitMs: 500,
    screenshotNudgeAfterMs: 500,
    screenshotStabilityStableMs: 1000,
    screenshotStabilityMaxWaitMs: 7000,
    screenshotStabilityCheckIntervalMs: 250,
    screenshotJpegQuality: 80,
    screenshotWebpQuality: 75,
  };
}

const queue: AdminGalleryJob[] = [];
let active: AdminGalleryJob | null = null;
const history: AdminGalleryJob[] = [];
let isProcessing = false;
let activeScraper: FreshScraper | null = null;
let cancelActiveRequested = false;
let cancelActiveReason = 'Canceled by admin';

export function getAdminGalleryJobsSnapshot(): {
  active: AdminGalleryJob | null;
  queue: AdminGalleryJob[];
  history: AdminGalleryJob[];
} {
  return {
    active,
    queue: [...queue],
    history: [...history].slice(0, 50),
  };
}

export async function cancelAllAdminGalleryJobs(reason = 'Canceled by admin'): Promise<void> {
  cancelActiveReason = reason;

  // Cancel queued jobs immediately.
  while (queue.length) {
    const job = queue.shift();
    if (!job) break;
    job.status = 'canceled';
    job.lastError = reason;
    job.finishedAt = nowIso();
    job.items = job.items.map((i) => ({
      ...i,
      status: i.status === 'succeeded' || i.status === 'failed' || i.status === 'skipped' ? i.status : 'canceled',
      error: i.error || reason,
    }));
    history.unshift(job);
  }
  if (history.length > 200) history.splice(200);

  // Request cancellation for the currently running job (handled by processQueue).
  if (active && active.status === 'running') {
    cancelActiveRequested = true;
    active.lastError = reason;
    try {
      await activeScraper?.close();
    } catch {
      // ignore
    }
  }
}

export function enqueueAdminGalleryJob(input: {
  type: AdminGalleryJobType;
  createdByEmail: string;
  templateId?: number;
  templateSlug?: string;
  templateName?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  selector?: string;
  homepageUrl?: string;
  config?: Partial<FreshScraperConfig>;
  items: Array<{
    templateId: number;
    slug: string;
    name: string | null;
    storefrontUrl: string;
  }>;
}): AdminGalleryJob {
  const id = newJobId();
  const createdAt = nowIso();

  const job: AdminGalleryJob = {
    id,
    type: input.type,
    status: 'queued',
    createdAt,
    createdByEmail: input.createdByEmail,
    templateId: input.templateId,
    templateSlug: input.templateSlug,
    templateName: input.templateName ?? null,
    authorId: input.authorId ?? null,
    authorName: input.authorName ?? null,
    selector: input.selector,
    homepageUrl: input.homepageUrl,
    config: input.config ?? {},
    progress: { processed: 0, total: input.items.length },
    items: input.items.map((t) => ({
      templateId: t.templateId,
      slug: t.slug,
      name: t.name ?? null,
      storefrontUrl: t.storefrontUrl,
      status: 'queued',
    })),
  };

  queue.push(job);
  void processQueue();
  return job;
}

async function runJob(job: AdminGalleryJob): Promise<void> {
  const base = getSerialScreenshotDefaults();

  const jobConfig: FreshScraperConfig = {
    ...base,
    ...job.config,
    jobMode: 'screenshots_only',
    concurrency: 1,
    browserInstances: 1,
    pagesPerBrowser: 1,
    batchSize: 1,
    appendCacheBusterToScreenshotPath: true,
    additionalScreenshotSelectors:
      job.type === 'retake_screenshot_remove_selector' || job.type === 'retake_author_remove_selector'
        ? (job.selector ? [job.selector] : [])
        : [],
    forceScreenshotUrl: job.type === 'change_homepage' ? job.homepageUrl : undefined,
    skipIfMissingRequiredSelectors: job.type === 'retake_author_remove_selector',
    requiredSelectors: job.type === 'retake_author_remove_selector' && job.selector ? [job.selector] : [],
  };

  // In screenshots_only mode, the scraper only needs the slug to look up the live preview URL
  // in Supabase. Using slugs here avoids failures when `storefront_url` is missing or malformed.
  const urls = job.items.map((i) => i.slug);

  const scraper = new FreshScraper(jobConfig);
  activeScraper = scraper;
  await scraper.init(false);

  scraper.on('progress', (p) => {
    job.progress = { processed: p.processed, total: p.total };
  });

  scraper.on('template-phase', (data) => {
    const item = job.items.find((i) => i.slug === data.url);
    if (!item) return;
    if (data.phase === 'taking_screenshot' || data.phase === 'processing_screenshot') {
      item.status = 'running';
    }
    if (data.phase === 'skipped') {
      item.status = 'skipped';
    }
    if (data.phase === 'failed') {
      item.status = 'failed';
    }
  });

  scraper.on('template-complete', (data) => {
    const item = job.items.find((i) => i.slug === data.slug);
    if (!item) return;
    if (data.success) {
      // If screenshotPath is missing, this might be a "skipped" template (e.g., required selector missing).
      item.status = data.screenshotPath ? 'succeeded' : item.status === 'skipped' ? 'skipped' : 'succeeded';
      if (data.screenshotPath) item.screenshotPath = data.screenshotPath;
      item.error = undefined;
    } else {
      item.status = 'failed';
      item.error = data.error || 'Unknown error';
    }
  });

  try {
    await scraper.initBrowserPool();
    await scraper.scrapeBatch(urls);
  } finally {
    try {
      await scraper.close();
    } catch {
      // ignore
    }
    if (activeScraper === scraper) activeScraper = null;
  }
}

async function processQueue(): Promise<void> {
  if (isProcessing) return;
  isProcessing = true;
  try {
    while (true) {
      if (active) return;
      const next = queue.shift();
      if (!next) return;

      active = next;
      active.status = 'running';
      active.startedAt = nowIso();
      cancelActiveRequested = false;
      cancelActiveReason = 'Canceled by admin';

      try {
        await runJob(active);
        if (cancelActiveRequested) {
          active.status = 'canceled';
          active.lastError = cancelActiveReason;
          active.items = active.items.map((i) => ({
            ...i,
            status: i.status === 'succeeded' || i.status === 'failed' || i.status === 'skipped' ? i.status : 'canceled',
            error: i.error || cancelActiveReason,
          }));
        } else {
          active.status = 'succeeded';
        }
      } catch (error) {
        if (cancelActiveRequested) {
          active.status = 'canceled';
          active.lastError = cancelActiveReason;
        } else {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          active.status = 'failed';
          active.lastError = msg;
        }
      } finally {
        active.finishedAt = nowIso();
        history.unshift(active);
        active = null;
        if (history.length > 200) history.splice(200);
      }
    }
  } finally {
    activeScraper = null;
    cancelActiveRequested = false;
    isProcessing = false;
  }
}
