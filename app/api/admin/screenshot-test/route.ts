import { NextRequest, NextResponse } from 'next/server';
import { chromium, type BrowserContext, type Page } from 'playwright';
import sharp from 'sharp';
import { preparePageForScreenshot } from '@/lib/screenshot/prepare';
import { getActiveScreenshotExclusions } from '@/lib/db';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7);
  return token === ADMIN_PASSWORD;
}

interface TestScreenshotResult {
  success: boolean;
  screenshotBase64?: string;
  thumbnailBase64?: string;
  dimensions?: { width: number; height: number };
  timings?: {
    total: number;
    navigation: number;
    preparation: number;
    capture: number;
    processing: number;
  };
  exclusionsApplied?: string[];
  error?: string;
}

// POST - Test screenshot capture for a URL
export async function POST(request: NextRequest): Promise<NextResponse<TestScreenshotResult>> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  let browser = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;

  const timings = {
    total: 0,
    navigation: 0,
    preparation: 0,
    capture: 0,
    processing: 0,
  };

  const startTime = Date.now();

  try {
    const body = await request.json();
    const { url, useExclusions = true } = body;

    if (!url || typeof url !== 'string') {
      return NextResponse.json({
        success: false,
        error: 'URL is required'
      }, { status: 400 });
    }

    // Validate URL
    let validUrl: URL;
    try {
      validUrl = new URL(url);
      if (!['http:', 'https:'].includes(validUrl.protocol)) {
        throw new Error('Invalid protocol');
      }
    } catch {
      return NextResponse.json({
        success: false,
        error: 'Invalid URL format'
      }, { status: 400 });
    }

    // Get active exclusions if enabled
    let exclusions: string[] = [];
    if (useExclusions) {
      exclusions = await getActiveScreenshotExclusions();
    }

    // Launch browser
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    page = await context.newPage();

    const timeout = 45000;
    page.setDefaultTimeout(timeout);
    page.setDefaultNavigationTimeout(timeout);

    // Navigate to URL
    const navStart = Date.now();
    await page.goto(validUrl.toString(), {
      waitUntil: 'domcontentloaded',
      timeout,
    });
    timings.navigation = Date.now() - navStart;

    // Prepare page for screenshot
    const prepStart = Date.now();
    try {
      await preparePageForScreenshot(page, {
        loadTimeoutMs: 30000,
        animationWaitMs: 3000,
        scrollDelayMs: 150,
        elementsToRemove: exclusions,
      });
    } catch (prepError) {
      console.warn('[screenshot-test] Page preparation warning:', prepError);
    }
    timings.preparation = Date.now() - prepStart;

    // Capture screenshot
    const captureStart = Date.now();
    const screenshotBuffer = await page.screenshot({
      fullPage: true,
      type: 'jpeg',
      quality: 85,
    });
    timings.capture = Date.now() - captureStart;

    // Process images
    const processStart = Date.now();
    const screenshotQuality = parseInt(process.env.SCREENSHOT_QUALITY || '85', 10);

    // Create full screenshot as WebP
    const fullScreenshot = await sharp(screenshotBuffer)
      .resize(1000, null, { withoutEnlargement: true })
      .webp({ quality: screenshotQuality })
      .toBuffer();

    // Get dimensions
    const metadata = await sharp(fullScreenshot).metadata();
    const dimensions = {
      width: metadata.width || 0,
      height: metadata.height || 0,
    };

    // Create thumbnail
    const thumbnail = await sharp(screenshotBuffer)
      .resize(500, 500, { fit: 'cover', position: 'top' })
      .webp({ quality: Math.max(10, screenshotQuality - 10) })
      .toBuffer();

    timings.processing = Date.now() - processStart;
    timings.total = Date.now() - startTime;

    // Convert to base64 for response
    const screenshotBase64 = `data:image/webp;base64,${fullScreenshot.toString('base64')}`;
    const thumbnailBase64 = `data:image/webp;base64,${thumbnail.toString('base64')}`;

    return NextResponse.json({
      success: true,
      screenshotBase64,
      thumbnailBase64,
      dimensions,
      timings,
      exclusionsApplied: exclusions,
    });

  } catch (error) {
    console.error('[screenshot-test] Error:', error);
    timings.total = Date.now() - startTime;

    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Screenshot capture failed',
      timings,
    }, { status: 500 });

  } finally {
    if (page) {
      await page.close().catch(() => undefined);
    }
    if (context) {
      await context.close().catch(() => undefined);
    }
    if (browser) {
      await browser.close().catch(() => undefined);
    }
  }
}
