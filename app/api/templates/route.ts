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
  updated_at,
  primary_category,
  webflow_subcategories,
  publish_date
`;

type TemplateRow = Record<string, unknown> & { id: number; author_id?: string | null };

function jsonResponse(body: unknown, init?: Parameters<typeof NextResponse.json>[1]) {
  const res = NextResponse.json(body, init);
  const cacheControl = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300';
  res.headers.set('Cache-Control', cacheControl);
  res.headers.set('CDN-Cache-Control', cacheControl);
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

type TemplateJoinRow = { templates?: TemplateRow | TemplateRow[] | null };

function unwrapTemplates(rows: TemplateJoinRow[]): TemplateRow[] {
  return (rows || [])
    .map((row) => {
      const rel = row?.templates;
      return Array.isArray(rel) ? (rel[0] as TemplateRow | undefined) : (rel as TemplateRow | undefined);
    })
    .filter(Boolean) as TemplateRow[];
}

function toPostgrestList(values: string[]): string {
  const escaped = values.map((value) => `"${String(value).replace(/"/g, '\\"')}"`);
  return `(${escaped.join(',')})`;
}

function applyNonFeaturedAuthorFilter<T extends { or: (filters: string, options?: { foreignTable?: string }) => T }>(
  query: T,
  featuredAuthorIds: string[],
  foreignTable?: string
) {
  if (!featuredAuthorIds.length) return query;
  const list = toPostgrestList(featuredAuthorIds);
  const filter = `author_id.is.null,author_id.not.in.${list}`;
  return foreignTable ? query.or(filter, { foreignTable }) : query.or(filter);
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

    // New category filters (supports multiple values comma-separated)
    const primaryCategories = searchParams.get('primaryCategory')?.split(',').filter(Boolean) || [];
    const webflowSubcategories = searchParams.get('webflowSubcategory')?.split(',').filter(Boolean) || [];
    const hasNewCategoryFilters = primaryCategories.length > 0 || webflowSubcategories.length > 0;

    const featuredAuthorIds = await getFeaturedAuthorIdSet();
    const featuredAuthorIdList = Array.from(featuredAuthorIds);
    const prioritizeFeaturedAuthors = !featured && !author && collection !== 'ultra' && featuredAuthorIdList.length > 0;
    const applyFeaturedFilter = featured && featuredAuthorIdList.length > 0;

    const emptyPagination = {
      page,
      limit,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrev: page > 1,
    };

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

    if (featured && featuredAuthorIdList.length === 0) {
      return jsonResponse({ templates: [], pagination: emptyPagination });
    }

    let templates: TemplateRow[] = [];
    let total = 0;

    // Handle new category filters (primary_category and webflow_subcategories arrays)
    if (hasNewCategoryFilters) {
      // Build count query
      let countQuery = supabaseAdmin.from('templates').select('id', { count: 'exact', head: true });

      // Apply array contains filters for each selected category
      for (const category of primaryCategories) {
        countQuery = countQuery.contains('primary_category', [category]);
      }
      for (const subcategory of webflowSubcategories) {
        countQuery = countQuery.contains('webflow_subcategories', [subcategory]);
      }

      if (author) countQuery = countQuery.eq('author_id', author);
      if (applyFeaturedFilter) {
        countQuery = countQuery.in('author_id', featuredAuthorIdList);
      }

      const { count, error: countError } = await countQuery;
      if (countError) throw countError;
      total = count || 0;

      if (offset >= total) {
        templates = [];
      } else {
        // Build data query
        let query = supabaseAdmin.from('templates').select(TEMPLATE_CARD_SELECT);

        // Apply array contains filters
        for (const category of primaryCategories) {
          query = query.contains('primary_category', [category]);
        }
        for (const subcategory of webflowSubcategories) {
          query = query.contains('webflow_subcategories', [subcategory]);
        }

        if (author) query = query.eq('author_id', author);
        if (applyFeaturedFilter) {
          query = query.in('author_id', featuredAuthorIdList);
        }

        const { data, error } = await query
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);
        if (error) throw error;
        templates = (data || []) as TemplateRow[];
      }
    } else if (subcategory) {
      const { data: subcat, error: subcatError } = await supabaseAdmin
        .from('subcategories')
        .select('id')
        .eq('slug', subcategory)
        .single();
      if (subcatError || !subcat) {
        return jsonResponse({ templates: [], pagination: emptyPagination });
      }

      if (prioritizeFeaturedAuthors) {
        const { count: totalCount, error: totalError } = await supabaseAdmin
          .from('template_subcategories')
          .select('template_id', { count: 'exact', head: true })
          .eq('subcategory_id', subcat.id);
        if (totalError) throw totalError;
        total = totalCount || 0;

        if (total > 0) {
          const { count: featuredCount, error: featuredError } = await supabaseAdmin
            .from('template_subcategories')
            .select('template_id, templates!inner(author_id)', { count: 'exact', head: true })
            .eq('subcategory_id', subcat.id)
            .in('templates.author_id', featuredAuthorIdList);
          if (featuredError) throw featuredError;
          const featuredTotal = featuredCount || 0;

          const start = offset;
          if (start < featuredTotal) {
            const featuredOffset = start;
            const featuredLimit = Math.min(limit, featuredTotal - featuredOffset);
            const remainingLimit = limit - featuredLimit;

            const { data: featuredData, error: featuredDataError } = await supabaseAdmin
              .from('template_subcategories')
              .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`)
              .eq('subcategory_id', subcat.id)
              .in('templates.author_id', featuredAuthorIdList)
              .order('created_at', { foreignTable: 'templates', ascending: false })
              .range(featuredOffset, featuredOffset + featuredLimit - 1);
            if (featuredDataError) throw featuredDataError;

            const featuredTemplates = unwrapTemplates((featuredData || []) as TemplateJoinRow[]);
            templates = [...featuredTemplates];

            if (remainingLimit > 0) {
              let nonFeaturedQuery = supabaseAdmin
                .from('template_subcategories')
                .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`)
                .eq('subcategory_id', subcat.id)
                .order('created_at', { foreignTable: 'templates', ascending: false });
              nonFeaturedQuery = applyNonFeaturedAuthorFilter(nonFeaturedQuery, featuredAuthorIdList, 'templates');

              const { data: nonFeaturedData, error: nonFeaturedError } = await nonFeaturedQuery
                .range(0, remainingLimit - 1);
              if (nonFeaturedError) throw nonFeaturedError;

              templates = [...templates, ...unwrapTemplates((nonFeaturedData || []) as TemplateJoinRow[])];
            }
          } else {
            const nonFeaturedOffset = start - featuredTotal;
            let nonFeaturedQuery = supabaseAdmin
              .from('template_subcategories')
              .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`)
              .eq('subcategory_id', subcat.id)
              .order('created_at', { foreignTable: 'templates', ascending: false });
            nonFeaturedQuery = applyNonFeaturedAuthorFilter(nonFeaturedQuery, featuredAuthorIdList, 'templates');

            const { data: nonFeaturedData, error: nonFeaturedError } = await nonFeaturedQuery
              .range(nonFeaturedOffset, nonFeaturedOffset + limit - 1);
            if (nonFeaturedError) throw nonFeaturedError;

            templates = unwrapTemplates((nonFeaturedData || []) as TemplateJoinRow[]);
          }
        }
      } else {
        let query = supabaseAdmin
          .from('template_subcategories')
          .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`, { count: 'exact' })
          .eq('subcategory_id', subcat.id)
          .order('created_at', { foreignTable: 'templates', ascending: false })
          .range(offset, offset + limit - 1);

        if (author) query = query.eq('templates.author_id', author);
        if (applyFeaturedFilter) {
          query = query.in('templates.author_id', featuredAuthorIdList);
        }

        const { data, count, error } = await query;
        if (error) throw error;
        total = count || 0;
        templates = unwrapTemplates((data || []) as TemplateJoinRow[]);
      }
    } else if (style) {
      const { data: styleRow, error: styleError } = await supabaseAdmin
        .from('styles')
        .select('id')
        .eq('slug', style)
        .single();
      if (styleError || !styleRow) {
        return jsonResponse({ templates: [], pagination: emptyPagination });
      }

      if (prioritizeFeaturedAuthors) {
        const { count: totalCount, error: totalError } = await supabaseAdmin
          .from('template_styles')
          .select('template_id', { count: 'exact', head: true })
          .eq('style_id', styleRow.id);
        if (totalError) throw totalError;
        total = totalCount || 0;

        if (total > 0) {
          const { count: featuredCount, error: featuredError } = await supabaseAdmin
            .from('template_styles')
            .select('template_id, templates!inner(author_id)', { count: 'exact', head: true })
            .eq('style_id', styleRow.id)
            .in('templates.author_id', featuredAuthorIdList);
          if (featuredError) throw featuredError;
          const featuredTotal = featuredCount || 0;

          const start = offset;
          if (start < featuredTotal) {
            const featuredOffset = start;
            const featuredLimit = Math.min(limit, featuredTotal - featuredOffset);
            const remainingLimit = limit - featuredLimit;

            const { data: featuredData, error: featuredDataError } = await supabaseAdmin
              .from('template_styles')
              .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`)
              .eq('style_id', styleRow.id)
              .in('templates.author_id', featuredAuthorIdList)
              .order('created_at', { foreignTable: 'templates', ascending: false })
              .range(featuredOffset, featuredOffset + featuredLimit - 1);
            if (featuredDataError) throw featuredDataError;

            const featuredTemplates = unwrapTemplates((featuredData || []) as TemplateJoinRow[]);
            templates = [...featuredTemplates];

            if (remainingLimit > 0) {
              let nonFeaturedQuery = supabaseAdmin
                .from('template_styles')
                .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`)
                .eq('style_id', styleRow.id)
                .order('created_at', { foreignTable: 'templates', ascending: false });
              nonFeaturedQuery = applyNonFeaturedAuthorFilter(nonFeaturedQuery, featuredAuthorIdList, 'templates');

              const { data: nonFeaturedData, error: nonFeaturedError } = await nonFeaturedQuery
                .range(0, remainingLimit - 1);
              if (nonFeaturedError) throw nonFeaturedError;

              templates = [...templates, ...unwrapTemplates((nonFeaturedData || []) as TemplateJoinRow[])];
            }
          } else {
            const nonFeaturedOffset = start - featuredTotal;
            let nonFeaturedQuery = supabaseAdmin
              .from('template_styles')
              .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`)
              .eq('style_id', styleRow.id)
              .order('created_at', { foreignTable: 'templates', ascending: false });
            nonFeaturedQuery = applyNonFeaturedAuthorFilter(nonFeaturedQuery, featuredAuthorIdList, 'templates');

            const { data: nonFeaturedData, error: nonFeaturedError } = await nonFeaturedQuery
              .range(nonFeaturedOffset, nonFeaturedOffset + limit - 1);
            if (nonFeaturedError) throw nonFeaturedError;

            templates = unwrapTemplates((nonFeaturedData || []) as TemplateJoinRow[]);
          }
        }
      } else {
        let query = supabaseAdmin
          .from('template_styles')
          .select(`template_id, templates!inner(${TEMPLATE_CARD_SELECT})`, { count: 'exact' })
          .eq('style_id', styleRow.id)
          .order('created_at', { foreignTable: 'templates', ascending: false })
          .range(offset, offset + limit - 1);

        if (author) query = query.eq('templates.author_id', author);
        if (applyFeaturedFilter) {
          query = query.in('templates.author_id', featuredAuthorIdList);
        }

        const { data, count, error } = await query;
        if (error) throw error;
        total = count || 0;
        templates = unwrapTemplates((data || []) as TemplateJoinRow[]);
      }
    } else {
      if (prioritizeFeaturedAuthors) {
        const { count: totalCount, error: totalError } = await supabaseAdmin
          .from('templates')
          .select('id', { count: 'exact', head: true });
        if (totalError) throw totalError;
        total = totalCount || 0;

        if (total > 0) {
          const { count: featuredCount, error: featuredError } = await supabaseAdmin
            .from('templates')
            .select('id', { count: 'exact', head: true })
            .in('author_id', featuredAuthorIdList);
          if (featuredError) throw featuredError;
          const featuredTotal = featuredCount || 0;

          const start = offset;
          if (start < featuredTotal) {
            const featuredOffset = start;
            const featuredLimit = Math.min(limit, featuredTotal - featuredOffset);
            const remainingLimit = limit - featuredLimit;

            const { data: featuredData, error: featuredDataError } = await supabaseAdmin
              .from('templates')
              .select(TEMPLATE_CARD_SELECT)
              .in('author_id', featuredAuthorIdList)
              .order('created_at', { ascending: false })
              .range(featuredOffset, featuredOffset + featuredLimit - 1);
            if (featuredDataError) throw featuredDataError;

            templates = (featuredData || []) as TemplateRow[];

            if (remainingLimit > 0) {
              let nonFeaturedQuery = supabaseAdmin
                .from('templates')
                .select(TEMPLATE_CARD_SELECT)
                .order('created_at', { ascending: false });
              nonFeaturedQuery = applyNonFeaturedAuthorFilter(nonFeaturedQuery, featuredAuthorIdList);

              const { data: nonFeaturedData, error: nonFeaturedError } = await nonFeaturedQuery
                .range(0, remainingLimit - 1);
              if (nonFeaturedError) throw nonFeaturedError;

              templates = [...templates, ...((nonFeaturedData || []) as TemplateRow[])];
            }
          } else {
            const nonFeaturedOffset = start - featuredTotal;
            let nonFeaturedQuery = supabaseAdmin
              .from('templates')
              .select(TEMPLATE_CARD_SELECT)
              .order('created_at', { ascending: false });
            nonFeaturedQuery = applyNonFeaturedAuthorFilter(nonFeaturedQuery, featuredAuthorIdList);

            const { data: nonFeaturedData, error: nonFeaturedError } = await nonFeaturedQuery
              .range(nonFeaturedOffset, nonFeaturedOffset + limit - 1);
            if (nonFeaturedError) throw nonFeaturedError;

            templates = (nonFeaturedData || []) as TemplateRow[];
          }
        }
      } else {
        // First get the count to check if we're within bounds
        let countQuery = supabaseAdmin.from('templates').select('id', { count: 'exact', head: true });
        if (author) countQuery = countQuery.eq('author_id', author);
        if (applyFeaturedFilter) {
          countQuery = countQuery.in('author_id', featuredAuthorIdList);
        }

        const { count, error: countError } = await countQuery;
        if (countError) throw countError;
        total = count || 0;

        // If offset is beyond available data, return empty results
        if (offset >= total) {
          templates = [];
        } else {
          let query = supabaseAdmin.from('templates').select(TEMPLATE_CARD_SELECT);
          if (author) query = query.eq('author_id', author);
          if (applyFeaturedFilter) {
            query = query.in('author_id', featuredAuthorIdList);
          }

          const { data, error } = await query
            .order('created_at', { ascending: false })
            .range(offset, offset + limit - 1);
          if (error) throw error;
          templates = (data || []) as TemplateRow[];
        }
      }
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
    // Log more details about the error
    console.error('Templates API error:', {
      message: error instanceof Error ? error.message : String(error),
      name: error instanceof Error ? error.name : 'Unknown',
      stack: error instanceof Error ? error.stack : undefined,
      raw: error
    });
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
