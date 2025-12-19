import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

function resolveScreenshotPath(screenshotPath?: string | null): string | null {
  if (!screenshotPath) return null;
  const normalized = String(screenshotPath).trim();
  if (!normalized.startsWith('/screenshots/')) return null;
  const filename = path.basename(normalized);
  return path.join(process.cwd(), 'public', 'screenshots', filename);
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawLimit = parseInt(searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10);
    const rawOffset = parseInt(searchParams.get('offset') || '0', 10);

    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const offset = Number.isFinite(rawOffset) ? Math.max(rawOffset, 0) : 0;

    const { data, error } = await supabaseAdmin
      .from('templates')
      .select('id, name, slug, author_id, author_name, screenshot_path, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit);

    if (error) throw error;

    const items = data || [];
    const hasMore = items.length > limit;
    const templates = hasMore ? items.slice(0, limit) : items;

    return NextResponse.json({
      templates,
      hasMore,
      offset,
      limit,
    });
  } catch (error) {
    console.error('Admin logs GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const rawId = searchParams.get('id');
    const templateId = rawId ? Number(rawId) : NaN;

    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: 'Template ID required' }, { status: 400 });
    }

    const { data: template, error: templateError } = await supabaseAdmin
      .from('templates')
      .select('id, screenshot_path')
      .eq('id', templateId)
      .single();

    if (templateError || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    await supabaseAdmin.from('template_subcategories').delete().eq('template_id', templateId);
    await supabaseAdmin.from('template_styles').delete().eq('template_id', templateId);
    await supabaseAdmin.from('template_features').delete().eq('template_id', templateId);
    await supabaseAdmin.from('ultra_featured_templates').delete().eq('template_id', templateId);

    const { error: deleteError } = await supabaseAdmin
      .from('templates')
      .delete()
      .eq('id', templateId);

    if (deleteError) throw deleteError;

    const screenshotFullPath = resolveScreenshotPath(template.screenshot_path);
    if (screenshotFullPath) {
      try {
        await fs.unlink(screenshotFullPath);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          console.warn('Failed to delete screenshot:', err);
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Admin logs DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
