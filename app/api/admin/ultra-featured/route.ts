import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, getUltraFeaturedTemplates, replaceUltraFeaturedTemplates } from '@/lib/supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

async function attachMetadata(templates: any[]) {
  if (templates.length === 0) return templates;
  const templateIds = templates.map((t) => t.id);

  const [subcatsData, stylesData] = await Promise.all([
    supabaseAdmin
      .from('template_subcategories')
      .select('template_id, subcategories(name)')
      .in('template_id', templateIds),
    supabaseAdmin
      .from('template_styles')
      .select('template_id, styles(name)')
      .in('template_id', templateIds),
  ]);

  const subcatsByTemplateId = new Map<number, string[]>();
  (subcatsData.data || []).forEach((row: any) => {
    const templateId = row.template_id as number;
    const rel = row?.subcategories;
    const names = Array.isArray(rel)
      ? rel.map((r) => r?.name).filter(Boolean)
      : rel?.name ? [rel.name] : [];
    if (!names.length) return;
    const existing = subcatsByTemplateId.get(templateId) || [];
    subcatsByTemplateId.set(templateId, [...existing, ...names]);
  });

  const stylesByTemplateId = new Map<number, string[]>();
  (stylesData.data || []).forEach((row: any) => {
    const templateId = row.template_id as number;
    const rel = row?.styles;
    const names = Array.isArray(rel)
      ? rel.map((r) => r?.name).filter(Boolean)
      : rel?.name ? [rel.name] : [];
    if (!names.length) return;
    const existing = stylesByTemplateId.get(templateId) || [];
    stylesByTemplateId.set(templateId, [...existing, ...names]);
  });

  return templates.map((template) => ({
    ...template,
    subcategories: subcatsByTemplateId.get(template.id) || [],
    styles: stylesByTemplateId.get(template.id) || [],
  }));
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const includePool = searchParams.get('include_pool') === 'true';

    // Get ultra featured templates
    const ultraFeatured = await getUltraFeaturedTemplates();

    if (!includePool) {
      return NextResponse.json({
        ultraFeatured,
        pool: []
      });
    }

    // Get featured author IDs
    const { data: featuredAuthors } = await supabaseAdmin
      .from('featured_authors')
      .select('author_id')
      .eq('is_active', true);

    const authorIds = featuredAuthors?.map(a => a.author_id) || [];

    if (authorIds.length === 0) {
      return NextResponse.json({
        ultraFeatured,
        pool: []
      });
    }

    // Get templates from featured authors
    const { data: templates } = await supabaseAdmin
      .from('templates')
      .select('*')
      .in('author_id', authorIds)
      .order('updated_at', { ascending: false });

    // Add metadata to each template
    const pool = await attachMetadata(templates || []);

    return NextResponse.json({
      ultraFeatured,
      pool
    });
  } catch (error) {
    console.error('Ultra featured GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { templateIds } = await request.json();

    if (!Array.isArray(templateIds)) {
      return NextResponse.json({ error: 'templateIds must be an array' }, { status: 400 });
    }

    const numericIds = Array.from(new Set(
      templateIds
        .map((id: any) => Number(id))
        .filter((id: number) => Number.isFinite(id))
    ));

    await replaceUltraFeaturedTemplates(numericIds);

    const ultraFeatured = await getUltraFeaturedTemplates();

    return NextResponse.json({
      message: 'Ultra featured templates updated',
      ultraFeatured
    });
  } catch (error) {
    console.error('Ultra featured POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
