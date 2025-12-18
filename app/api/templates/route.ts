import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const revalidate = 60;

const MAX_LIMIT = 50;

const TEMPLATE_CARD_SELECT = `
  id,
  template_id,
  name,
  slug,
  author_name,
  author_id,
  storefront_url,
  live_preview_url,
  designer_preview_url,
  price,
  short_description,
  screenshot_path,
  is_featured,
  is_cms,
  is_ecommerce,
  screenshot_url,
  is_alternate_homepage,
  alternate_homepage_path,
  scraped_at,
  created_at,
  updated_at
`;

type TemplateRow = Record<string, unknown> & { id: number; author_id?: string | null };

function jsonResponse(body: unknown, init?: Parameters<typeof NextResponse.json>[1]) {
  const res = NextResponse.json(body, init);
  res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
  return res;
}

async function getFeaturedAuthorIdSet(): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('featured_authors')
    .select('author_id')
    .eq('is_active', true);
  if (error) return new Set();
  return new Set((data || []).map(r => r.author_id));
}

async function attachSubcategoriesAndStyles(
  templates: TemplateRow[]
): Promise<Array<TemplateRow & { subcategories: string[]; styles: string[] }>> {
  if (templates.length === 0) return [];

  const templateIds = templates.map(t => t.id);
  const [subcatRes, styleRes] = await Promise.all([
    supabaseAdmin
      .from('template_subcategories')
      .select('template_id, subcategories(name, display_name)')
      .in('template_id', templateIds),
    supabaseAdmin
      .from('template_styles')
      .select('template_id, styles(name, display_name)')
      .in('template_id', templateIds),
  ]);

  const subcatsByTemplateId = new Map<number, string[]>();
  for (const row of subcatRes.data || []) {
    const templateId = row.template_id as number;
    const label =
      (row.subcategories as { display_name?: string; name?: string } | null)?.display_name ||
      (row.subcategories as { name?: string } | null)?.name;
    if (!label) continue;
    const existing = subcatsByTemplateId.get(templateId) || [];
    existing.push(label);
    subcatsByTemplateId.set(templateId, existing);
  }

  const stylesByTemplateId = new Map<number, string[]>();
  for (const row of styleRes.data || []) {
    const templateId = row.template_id as number;
    const label =
      (row.styles as { display_name?: string; name?: string } | null)?.display_name ||
      (row.styles as { name?: string } | null)?.name;
    if (!label) continue;
    const existing = stylesByTemplateId.get(templateId) || [];
    existing.push(label);
    stylesByTemplateId.set(templateId, existing);
  }

  return templates.map(t => ({
    ...t,
    subcategories: subcatsByTemplateId.get(t.id) || [],
    styles: stylesByTemplateId.get(t.id) || [],
  }));
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : 20;
    const offset = (page - 1) * limit;

    const subcategory = searchParams.get('subcategory');
    const style = searchParams.get('style');
    const author = searchParams.get('author');
    const featured = searchParams.get('featured') === 'true';
    const collection = searchParams.get('collection');

    const featuredAuthorIds = await getFeaturedAuthorIdSet();
    const featuredAuthorIdList = featured ? Array.from(featuredAuthorIds) : null;

    if (collection === 'ultra') {
      const { data, count: total, error } = await supabaseAdmin
        .from('ultra_featured_templates')
        .select(`position, templates!inner(${TEMPLATE_CARD_SELECT})`, { count: 'exact' })
        .order('position')
        .range(offset, offset + limit - 1);

      if (error) throw error;

      const templatesOnly = (data || [])
        .map((row) => {
          const rel = (row as unknown as { templates?: unknown })?.templates;
          const template: TemplateRow | null = Array.isArray(rel) ? (rel[0] as TemplateRow | undefined) || null : (rel as TemplateRow | null);
          if (!template) return null;
          return {
            ...template,
            position: (row as { position: number }).position,
          } as TemplateRow & { position: number };
        })
        .filter(Boolean) as Array<TemplateRow & { position: number }>;

      const templatesWithMeta = await attachSubcategoriesAndStyles(templatesOnly);
      const enhanced = templatesWithMeta.map((t) => ({
        ...t,
        is_featured_author: !!t.author_id && featuredAuthorIds.has(t.author_id),
      }));

      const totalRows = total || 0;
      const totalPages = Math.ceil(totalRows / limit);

      return jsonResponse({
        templates: enhanced,
        pagination: {
          page,
          limit,
          total: totalRows,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      });
    }

    let templates: TemplateRow[] = [];
    let total = 0;

    if (subcategory) {
      const { data: subcat, error: subcatError } = await supabaseAdmin
        .from('subcategories')
        .select('id')
        .eq('slug', subcategory)
        .single();
      if (subcatError || !subcat) {
        return jsonResponse({
          templates: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: page > 1 },
        });
      }

      let query = supabaseAdmin
        .from('template_subcategories')
        .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`, { count: 'exact' })
        .eq('subcategory_id', subcat.id)
        .order('created_at', { foreignTable: 'templates', ascending: false })
        .range(offset, offset + limit - 1);

      if (author) query = query.eq('templates.author_id', author);
      if (featuredAuthorIdList && featuredAuthorIdList.length > 0) {
        query = query.in('templates.author_id', featuredAuthorIdList);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      total = count || 0;
      templates = (data || [])
        .map((row) => {
          const rel = (row as unknown as { templates?: unknown })?.templates;
          return Array.isArray(rel) ? (rel[0] as TemplateRow | undefined) : (rel as TemplateRow | undefined);
        })
        .filter(Boolean) as TemplateRow[];
    } else if (style) {
      const { data: styleRow, error: styleError } = await supabaseAdmin
        .from('styles')
        .select('id')
        .eq('slug', style)
        .single();
      if (styleError || !styleRow) {
        return jsonResponse({
          templates: [],
          pagination: { page, limit, total: 0, totalPages: 0, hasNext: false, hasPrev: page > 1 },
        });
      }

      let query = supabaseAdmin
        .from('template_styles')
        .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`, { count: 'exact' })
        .eq('style_id', styleRow.id)
        .order('created_at', { foreignTable: 'templates', ascending: false })
        .range(offset, offset + limit - 1);

      if (author) query = query.eq('templates.author_id', author);
      if (featuredAuthorIdList && featuredAuthorIdList.length > 0) {
        query = query.in('templates.author_id', featuredAuthorIdList);
      }

      const { data, count, error } = await query;
      if (error) throw error;
      total = count || 0;
      templates = (data || [])
        .map((row) => {
          const rel = (row as unknown as { templates?: unknown })?.templates;
          return Array.isArray(rel) ? (rel[0] as TemplateRow | undefined) : (rel as TemplateRow | undefined);
        })
        .filter(Boolean) as TemplateRow[];
    } else {
      let query = supabaseAdmin.from('templates').select(TEMPLATE_CARD_SELECT, { count: 'exact' });
      if (author) query = query.eq('author_id', author);
      if (featuredAuthorIdList && featuredAuthorIdList.length > 0) {
        query = query.in('author_id', featuredAuthorIdList);
      }

      const { data, count, error } = await query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;
      total = count || 0;
      templates = (data || []) as TemplateRow[];
    }

    const templatesWithMeta = await attachSubcategoriesAndStyles(templates);
    const enhancedTemplates = templatesWithMeta.map((t) => ({
      ...t,
      is_featured_author: !!t.author_id && featuredAuthorIds.has(t.author_id),
    }));

    const totalPages = Math.ceil(total / limit);

    return jsonResponse({
      templates: enhancedTemplates,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    });
  } catch (error) {
    console.error('Templates API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { template_id } = (await request.json()) as { template_id?: string };
    if (!template_id) {
      return NextResponse.json({ error: 'template_id required' }, { status: 400 });
    }

    const { data: template, error } = await supabaseAdmin
      .from('templates')
      .select('*')
      .eq('template_id', template_id)
      .single();

    if (error || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    const [subcats, styles, features] = await Promise.all([
      supabaseAdmin.from('template_subcategories').select('subcategories(name, display_name)').eq('template_id', template.id),
      supabaseAdmin.from('template_styles').select('styles(name, display_name)').eq('template_id', template.id),
      supabaseAdmin.from('template_features').select('features(name, display_name)').eq('template_id', template.id),
    ]);

    return jsonResponse({
      ...template,
      subcategories: (subcats.data || [])
        .map((s) => (s.subcategories as { display_name?: string; name?: string } | null)?.display_name
          || (s.subcategories as { name?: string } | null)?.name)
        .filter(Boolean),
      styles: (styles.data || [])
        .map((s) => (s.styles as { display_name?: string; name?: string } | null)?.display_name
          || (s.styles as { name?: string } | null)?.name)
        .filter(Boolean),
      features: (features.data || [])
        .map((f) => (f.features as { display_name?: string; name?: string } | null)?.display_name
          || (f.features as { name?: string } | null)?.name)
        .filter(Boolean),
    });
  } catch (error) {
    console.error('Template API error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
