import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { chromium } from 'playwright';

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await context.params;
    const templateId = Number(id);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: 'Invalid template id' }, { status: 400 });
    }

    const template = await db.getAsync<{ id: number; live_preview_url: string; name: string }>(
      'SELECT id, live_preview_url, name FROM templates WHERE id = ?',
      [templateId]
    );

    if (!template || !template.live_preview_url) {
      return NextResponse.json({ error: 'Template not found or missing preview URL' }, { status: 404 });
    }

    const baseUrl = new URL(template.live_preview_url);
    const browser = await chromium.launch({ headless: true });
    const browserContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await browserContext.newPage();

    try {
      const timeout = 30000;
      page.setDefaultTimeout(timeout);
      page.setDefaultNavigationTimeout(timeout);

      await page.goto(template.live_preview_url, { waitUntil: 'domcontentloaded', timeout });

      const links = await page.evaluate(() => {
        const results: { href: string; text: string }[] = [];
        const anchors = document.querySelectorAll('a[href]');
        anchors.forEach(anchor => {
          const href = anchor.getAttribute('href') || '';
          const text = anchor.textContent?.trim() || '';
          results.push({ href, text });
        });
        return results;
      });

      const unique = new Map<string, { url: string; path: string; text: string }>();

      for (const link of links) {
        const href = link.href;
        if (!href) continue;
        if (href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

        let absoluteUrl: URL;
        try {
          absoluteUrl = new URL(href, baseUrl);
        } catch {
          continue;
        }

        if (absoluteUrl.origin !== baseUrl.origin) {
          continue;
        }

        const normalizedPath = absoluteUrl.pathname + (absoluteUrl.search || '') + (absoluteUrl.hash || '');
        const text = link.text;

        if (!unique.has(absoluteUrl.href)) {
          unique.set(absoluteUrl.href, {
            url: absoluteUrl.href,
            path: normalizedPath || '/',
            text
          });
        }
      }

      return NextResponse.json({
        template: { id: template.id, name: template.name, live_preview_url: template.live_preview_url },
        links: Array.from(unique.values())
      });
    } finally {
      await browserContext.close();
      await browser.close();
    }
  } catch (error) {
    console.error('Template links fetch error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
