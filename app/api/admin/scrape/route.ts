import { NextRequest, NextResponse } from 'next/server';
import WebflowScraper from '@/lib/scraper/webflow-scraper';

type ScraperLogEntry = {
  timestamp: string;
  type?: string;
  message?: string;
  [key: string]: unknown;
};

interface ScraperProgressState {
  jobId: number | null;
  processed: number;
  successful: number;
  failed: number;
  total: number;
}

// Store active scraper instance
let activeScraper: WebflowScraper | null = null;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, url, urls, concurrency, browserInstances, pagesPerBrowser } = body;

    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (activeScraper) {
      return NextResponse.json({ error: 'Scrape job already in progress' }, { status: 400 });
    }

    // Configure scraper with advanced concurrency options
    activeScraper = new WebflowScraper({
      concurrency: concurrency || 5,
      browserInstances: browserInstances || 1,
      pagesPerBrowser: pagesPerBrowser || concurrency || 5
    });

    const scraper = activeScraper;

    if (!scraper) {
      return NextResponse.json({ error: 'Unable to initialize scraper' }, { status: 500 });
    }

    // Setup event listeners
    const logs: ScraperLogEntry[] = [];
    let progress: ScraperProgressState = {
      jobId: null,
      processed: 0,
      successful: 0,
      failed: 0,
      total: 0
    };

    scraper.on('log', (data) => {
      logs.push({ ...data, timestamp: new Date().toISOString() });
    });

    scraper.on('error', (data) => {
      logs.push({ ...data, type: 'error', timestamp: new Date().toISOString() });
    });

    scraper.on('progress', (data) => {
      progress = data;
    });

    const jobIdPromise: Promise<number> = new Promise((resolve) => {
      scraper.on('job-started', (data) => {
        progress.jobId = data.jobId;
        progress.total = data.totalTemplates;
        resolve(data.jobId);
      });
    });

    // Initialize scraper
    await scraper.init();

    // Start appropriate scrape job
    let scrapePromise: Promise<void>;

    switch (action) {
      case 'full':
        scrapePromise = scraper.scrapeFullSitemap();
        break;
      case 'update':
        scrapePromise = scraper.scrapeNewTemplates();
        break;
      case 'single':
        if (!url) {
          await scraper.close();
          activeScraper = null;
          return NextResponse.json({ error: 'URL required for single scrape' }, { status: 400 });
        }
        scrapePromise = scraper.scrapeSingleTemplate(url);
        break;
      case 'urls':
        // New action: scrape specific pre-discovered URLs
        if (!urls || !Array.isArray(urls) || urls.length === 0) {
          await scraper.close();
          activeScraper = null;
          return NextResponse.json({ error: 'URLs array required for urls scrape' }, { status: 400 });
        }
        scrapePromise = scraper.scrapeUrls(urls);
        break;
      default:
        await scraper.close();
        activeScraper = null;
        return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    }

    // Wait for job ID to be created
    const jobId = await Promise.race([
      jobIdPromise,
      new Promise<number>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout waiting for job ID')), 5000)
      )
    ]).catch(() => null);

    // Continue processing in background
    scrapePromise
      .finally(async () => {
        if (activeScraper) {
          await activeScraper.close();
          activeScraper = null;
        }
      })
      .catch(console.error);

    return NextResponse.json({
      message: 'Scrape job started',
      jobId: jobId,
      totalTemplates: action === 'urls' ? urls.length : undefined
    });

  } catch (error) {
    console.error('Scrape API error:', error);
    if (activeScraper) {
      await activeScraper.close();
      activeScraper = null;
    }
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json({
    isActive: activeScraper !== null
  });
}
