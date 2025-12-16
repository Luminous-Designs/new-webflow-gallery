import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { thumbnailQueue } from '@/lib/screenshot/thumbnail-queue';
import { existsSync } from 'fs';
import path from 'path';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const PUBLIC_DIR = path.join(process.cwd(), 'public');

function isAuthorized(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.substring(7);
  return token === ADMIN_PASSWORD;
}

interface TemplateMissingImage {
  id: number;
  name: string;
  slug: string;
  live_preview_url: string;
  screenshot_path: string | null;
  screenshot_thumbnail_path: string | null;
  missing_screenshot?: boolean;
  missing_thumbnail?: boolean;
}

// Check if an image file actually exists on disk
function imageFileExists(imagePath: string | null): boolean {
  if (!imagePath) return false;
  // Convert URL path (e.g., "/screenshots/foo.webp") to filesystem path
  const fsPath = path.join(PUBLIC_DIR, imagePath);
  return existsSync(fsPath);
}

// GET - Get count and list of templates missing images (checks actual file existence)
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all templates with a live preview URL
    const allTemplates = await db.allAsync<TemplateMissingImage>(
      `SELECT id, name, slug, live_preview_url, screenshot_path, screenshot_thumbnail_path
       FROM templates
       WHERE live_preview_url IS NOT NULL AND live_preview_url != ''
       ORDER BY name ASC`
    );

    // Check actual file existence for each template
    const missingTemplates: TemplateMissingImage[] = [];
    let withImagesCount = 0;

    for (const template of allTemplates) {
      const screenshotExists = imageFileExists(template.screenshot_path);
      const thumbnailExists = imageFileExists(template.screenshot_thumbnail_path);

      if (!screenshotExists || !thumbnailExists) {
        missingTemplates.push({
          ...template,
          missing_screenshot: !screenshotExists,
          missing_thumbnail: !thumbnailExists
        });
      } else {
        withImagesCount++;
      }
    }

    // Get total template count
    const totalResult = await db.getAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM templates'
    );

    // Check how many are already queued (pending or running)
    const queuedResult = await db.getAsync<{ count: number }>(
      `SELECT COUNT(DISTINCT template_id) as count FROM thumbnail_jobs
       WHERE status IN ('pending', 'running')`
    );

    return NextResponse.json({
      missingCount: missingTemplates.length,
      totalTemplates: totalResult?.count || 0,
      withImages: withImagesCount,
      alreadyQueued: queuedResult?.count || 0,
      templates: missingTemplates
    });
  } catch (error) {
    console.error('Failed to fetch missing images:', error);
    return NextResponse.json(
      { error: 'Failed to fetch missing images data' },
      { status: 500 }
    );
  }
}

// POST - Enqueue templates missing images for screenshot generation
export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { templateIds } = body;

    // Get templates to check
    let templatesToCheck: TemplateMissingImage[];

    if (templateIds && Array.isArray(templateIds) && templateIds.length > 0) {
      // Get specific templates
      const placeholders = templateIds.map(() => '?').join(',');
      templatesToCheck = await db.allAsync<TemplateMissingImage>(
        `SELECT id, name, slug, live_preview_url, screenshot_path, screenshot_thumbnail_path
         FROM templates
         WHERE id IN (${placeholders})
           AND live_preview_url IS NOT NULL AND live_preview_url != ''`,
        templateIds
      );
    } else {
      // Get all templates with live preview URLs
      templatesToCheck = await db.allAsync<TemplateMissingImage>(
        `SELECT id, name, slug, live_preview_url, screenshot_path, screenshot_thumbnail_path
         FROM templates
         WHERE live_preview_url IS NOT NULL AND live_preview_url != ''
         ORDER BY name ASC`
      );
    }

    // Filter to only templates actually missing files on disk
    const templatesToProcess = templatesToCheck.filter(template => {
      const screenshotExists = imageFileExists(template.screenshot_path);
      const thumbnailExists = imageFileExists(template.screenshot_thumbnail_path);
      return !screenshotExists || !thumbnailExists;
    });

    if (templatesToProcess.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No templates need processing - all files exist on disk',
        enqueued: 0
      });
    }

    // Check which templates are already in the queue (pending or running)
    const existingJobs = await db.allAsync<{ template_id: number }>(
      `SELECT DISTINCT template_id FROM thumbnail_jobs
       WHERE status IN ('pending', 'running')`
    );
    const queuedTemplateIds = new Set(existingJobs.map(j => j.template_id));

    // Enqueue templates that aren't already queued
    let enqueuedCount = 0;
    const skippedCount = templatesToProcess.filter(t => queuedTemplateIds.has(t.id)).length;

    for (const template of templatesToProcess) {
      if (queuedTemplateIds.has(template.id)) {
        continue; // Skip already queued
      }

      try {
        await thumbnailQueue.enqueue({
          templateId: template.id,
          targetUrl: template.live_preview_url,
          requestedBy: 'missing-images-bulk'
        });
        enqueuedCount++;
      } catch (err) {
        console.warn(`Failed to enqueue template ${template.id}:`, err);
      }
    }

    return NextResponse.json({
      success: true,
      message: `Enqueued ${enqueuedCount} templates for screenshot generation`,
      enqueued: enqueuedCount,
      skipped: skippedCount,
      total: templatesToProcess.length
    });
  } catch (error) {
    console.error('Failed to enqueue missing images:', error);
    return NextResponse.json(
      { error: 'Failed to enqueue templates' },
      { status: 500 }
    );
  }
}
