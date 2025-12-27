import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { requireAdminUser } from '@/lib/admin/auth';
import { enqueueAdminGalleryJob, getAdminGalleryJobsSnapshot, type AdminGalleryJobType } from '@/lib/admin/gallery-jobs';
import { clampFreshScraperConfig, type FreshScraperConfig } from '@/lib/scraper/fresh-scraper';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function json(body: unknown, init?: number | ResponseInit) {
  const res = NextResponse.json(body, typeof init === 'number' ? { status: init } : init);
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function pickAllowedScreenshotConfig(
  raw: unknown
): Partial<FreshScraperConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const clamped = clampFreshScraperConfig(raw as Partial<FreshScraperConfig>);
  const allowed: Array<keyof FreshScraperConfig> = [
    'timeout',
    'screenshotAnimationWaitMs',
    'screenshotNudgeScrollRatio',
    'screenshotNudgeWaitMs',
    'screenshotNudgeAfterMs',
    'screenshotStabilityStableMs',
    'screenshotStabilityMaxWaitMs',
    'screenshotStabilityCheckIntervalMs',
    'screenshotJpegQuality',
    'screenshotWebpQuality',
  ];
  const out: Partial<FreshScraperConfig> = {};
  for (const k of allowed) {
    if (clamped[k] !== undefined) (out[k] as unknown) = clamped[k];
  }
  return out;
}

function isJobType(value: unknown): value is AdminGalleryJobType {
  return (
    value === 'retake_screenshot' ||
    value === 'retake_screenshot_remove_selector' ||
    value === 'retake_author_remove_selector' ||
    value === 'change_homepage'
  );
}

export async function GET() {
  const admin = await requireAdminUser();
  if (!admin.ok) return json({ error: admin.error }, admin.status);
  return json(getAdminGalleryJobsSnapshot());
}

export async function POST(request: NextRequest) {
  const admin = await requireAdminUser();
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

  const type = obj.type;
  if (!isJobType(type)) {
    return json({ error: 'Invalid job type' }, 400);
  }

  const templateId = Number(obj.templateId);
  if (!Number.isFinite(templateId) || templateId <= 0) {
    return json({ error: 'templateId is required' }, 400);
  }

  const selector = typeof obj.selector === 'string' ? obj.selector.trim() : undefined;
  const homepageUrlRaw = typeof obj.homepageUrl === 'string' ? obj.homepageUrl.trim() : undefined;
  const persistToAuthor = typeof obj.persistToAuthor === 'boolean' ? obj.persistToAuthor : false;
  const config = pickAllowedScreenshotConfig(obj.config);

  if ((type === 'retake_screenshot_remove_selector' || type === 'retake_author_remove_selector') && !selector) {
    return json({ error: 'selector is required for this job type' }, 400);
  }

  if (type === 'change_homepage' && !homepageUrlRaw) {
    return json({ error: 'homepageUrl is required for this job type' }, 400);
  }

  const { data: template, error: templateError } = await supabaseAdmin
    .from('templates')
    .select('id, slug, name, storefront_url, live_preview_url, author_id, author_name')
    .eq('id', templateId)
    .single();
  if (templateError || !template) {
    return json({ error: templateError?.message || 'Template not found' }, 404);
  }

  if (persistToAuthor && selector) {
    const authorId = (template.author_id as string | null) || null;
    const authorName = (template.author_name as string | null) || null;
    if (authorId) {
      // Best effort: infer selector_type from prefix if not explicit
      const selectorType = selector.startsWith('#')
        ? 'selector'
        : selector.startsWith('.')
          ? 'selector'
          : 'class';
      await supabaseAdmin
        .from('author_screenshot_exclusions')
        .upsert({
          author_id: authorId,
          author_name: authorName,
          selector,
          selector_type: selectorType,
          is_active: true,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'author_id,selector' });
    }
  }

  const createdByEmail = (admin.user.email || '').toLowerCase();

  const baseItem = {
    templateId: template.id as number,
    slug: template.slug as string,
    name: (template.name as string | null) || null,
    storefrontUrl: template.storefront_url as string,
  };

  let items: typeof baseItem[] = [baseItem];

  if (type === 'retake_author_remove_selector') {
    const authorId = template.author_id as string | null;
    if (!authorId) {
      return json({ error: 'Template has no author_id' }, 400);
    }
    const { data: authorTemplates, error } = await supabaseAdmin
      .from('templates')
      .select('id, slug, name, storefront_url')
      .eq('author_id', authorId)
      .order('id', { ascending: true });
    if (error || !authorTemplates) {
      return json({ error: error?.message || 'Failed to load author templates' }, 500);
    }
    items = authorTemplates.map((t) => ({
      templateId: t.id as number,
      slug: t.slug as string,
      name: (t.name as string | null) || null,
      storefrontUrl: t.storefront_url as string,
    }));
  }

  let homepageUrl: string | undefined = undefined;
  if (type === 'change_homepage') {
    const base = new URL(template.live_preview_url as string);
    const forced = new URL(homepageUrlRaw!, base.origin);
    if (forced.origin !== base.origin) {
      return json({ error: `homepageUrl must be on the same origin as live_preview_url (${base.origin})` }, 400);
    }
    homepageUrl = forced.toString();
  }

  const job = enqueueAdminGalleryJob({
    type,
    createdByEmail,
    templateId: template.id as number,
    templateSlug: template.slug as string,
    templateName: (template.name as string | null) || null,
    authorId: (template.author_id as string | null) || null,
    authorName: (template.author_name as string | null) || null,
    selector,
    homepageUrl,
    config,
    items,
  });

  return json({ job }, 201);
}
