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

function normalizeSelectorInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  if (trimmed.startsWith('.') || trimmed.startsWith('#') || trimmed.startsWith('[')) return trimmed;
  // If it looks like a full selector (not a bare id/class token), don't rewrite.
  if (/[ >:+~.,#[\]()]/.test(trimmed)) return trimmed;
  return `.${trimmed}, #${trimmed}`;
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin.ok) return json({ error: admin.error }, admin.status);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const obj = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};

  const templateId = Number(obj.templateId);
  const selectorRaw = typeof obj.selector === 'string' ? obj.selector : '';
  const selector = selectorRaw.trim();
  if (!Number.isFinite(templateId) || templateId <= 0 || !selector) {
    return json({ error: 'templateId and selector are required' }, 400);
  }

  const { data: template, error } = await supabaseAdmin
    .from('templates')
    .select('id, live_preview_url')
    .eq('id', templateId)
    .single();
  if (error || !template) {
    return json({ error: error?.message || 'Template not found' }, 404);
  }

  const normalizedSelector = normalizeSelectorInput(selector);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();

    await page.goto(template.live_preview_url as string, { waitUntil: 'domcontentloaded', timeout: 45_000 });

    const matchCount = await page.evaluate((sel) => {
      try {
        return document.querySelectorAll(sel).length;
      } catch {
        return -1;
      }
    }, normalizedSelector);

    return json({
      ok: matchCount >= 0,
      exists: matchCount > 0,
      matchCount: matchCount >= 0 ? matchCount : 0,
      normalizedSelector,
    });
  } finally {
    await browser.close();
  }
}
