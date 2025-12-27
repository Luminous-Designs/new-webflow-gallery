import { NextRequest, NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/admin/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, init?: number | ResponseInit) {
  const res = NextResponse.json(body, typeof init === 'number' ? { status: init } : init);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

type LinkCandidate = { href: string; text: string };

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser();
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  const { searchParams } = new URL(request.url);
  const templateId = Number(searchParams.get('templateId'));
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return json({ error: 'templateId is required' }, 400);
  }

  const { data: template, error } = await supabaseAdmin
    .from('templates')
    .select('id, live_preview_url')
    .eq('id', templateId)
    .single();
  if (error || !template) {
    return json({ error: error?.message || 'Template not found' }, 404);
  }

  const base = new URL(template.live_preview_url as string);
  const baseOrigin = base.origin;

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    await page.goto(base.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const raw = await page.evaluate(() => {
      const out: LinkCandidate[] = [];
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = a.getAttribute('href') || '';
        if (!href) continue;
        const text = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
        out.push({ href, text });
      }
      return out;
    });

    const urls = new Map<string, { url: string; path: string; text: string }>();
    for (const link of raw) {
      const href = (link?.href || '').trim();
      if (!href) continue;
      if (href.startsWith('#')) continue;
      if (href.startsWith('javascript:')) continue;
      if (href.startsWith('mailto:')) continue;
      if (href.startsWith('tel:')) continue;

      let u: URL;
      try {
        u = new URL(href, baseOrigin);
      } catch {
        continue;
      }
      if (u.origin !== baseOrigin) continue;
      u.hash = '';

      const url = u.toString();
      if (!urls.has(url)) {
        urls.set(url, { url, path: u.pathname, text: link.text || '' });
      }
    }

    const list = Array.from(urls.values())
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, 250);

    return json({ baseUrl: base.toString(), links: list });
  } finally {
    await browser.close();
  }
}

