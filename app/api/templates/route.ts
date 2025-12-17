import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const rawPage = parseInt(searchParams.get('page') || '1', 10);
    const rawLimit = parseInt(searchParams.get('limit') || '20', 10);
    const MAX_LIMIT = 50;

    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_LIMIT) : 20;
    const subcategory = searchParams.get('subcategory');
    const style = searchParams.get('style');
    const author = searchParams.get('author');
    const featured = searchParams.get('featured') === 'true';
    const collection = searchParams.get('collection');

    const offset = (page - 1) * limit;

    console.log('[Templates API] Request params:', {
      page,
      limit,
      offset,
      subcategory,
      style,
      author,
      featured,
      collection
    });

    // Handle ultra-featured collection
    if (collection === 'ultra') {
      const { data: ultraFeatured, error: ultraError } = await supabase
        .from('ultra_featured_templates')
        .select(`
          position,
          templates (
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
            screenshot_thumbnail_path,
            is_featured,
            is_cms,
            is_ecommerce,
            created_at,
            updated_at
          )
        `)
        .order('position')
        .range(offset, offset + limit - 1);

      if (ultraError) {
        console.error('Ultra featured error:', ultraError);
        throw ultraError;
      }

      const { count: totalUltra } = await supabase
        .from('ultra_featured_templates')
        .select('*', { count: 'exact', head: true });

      // Get featured authors for checking
      const { data: featuredAuthors } = await supabase
        .from('featured_authors')
        .select('author_id')
        .eq('is_active', true);
      const featuredAuthorIds = new Set(featuredAuthors?.map(a => a.author_id) || []);

      // Process templates with metadata
      const templates = await Promise.all(
        (ultraFeatured || []).map(async (uf) => {
          const template = uf.templates as Record<string, unknown>;
          if (!template) return null;

          // Get subcategories
          const { data: subcats } = await supabase
            .from('template_subcategories')
            .select('subcategories(name)')
            .eq('template_id', template.id as number);

          // Get styles
          const { data: templateStyles } = await supabase
            .from('template_styles')
            .select('styles(name)')
            .eq('template_id', template.id as number);

          return {
            ...template,
            position: uf.position,
            subcategories: subcats?.map(s => (s.subcategories as { name: string })?.name).filter(Boolean) || [],
            styles: templateStyles?.map(s => (s.styles as { name: string })?.name).filter(Boolean) || [],
            is_featured_author: featuredAuthorIds.has(template.author_id as string)
          };
        })
      );

      const total = totalUltra || 0;
      const totalPages = Math.ceil(total / limit);

      return NextResponse.json({
        templates: templates.filter(Boolean),
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      });
    }

    // Build main query
    let query = supabase.from('templates').select('*', { count: 'exact' });

    // Apply filters
    if (author) {
      query = query.eq('author_id', author);
    }

    // For subcategory filter, we need to get template IDs first
    let templateIdsFromSubcategory: Set<number> | null = null;
    if (subcategory) {
      const { data: subcatData } = await supabase
        .from('subcategories')
        .select('id')
        .eq('slug', subcategory)
        .single();

      if (subcatData) {
        const { data: templateSubcats } = await supabase
          .from('template_subcategories')
          .select('template_id')
          .eq('subcategory_id', subcatData.id);

        templateIdsFromSubcategory = new Set(templateSubcats?.map(ts => ts.template_id) || []);
      }
    }

    // For style filter
    let templateIdsFromStyle: Set<number> | null = null;
    if (style) {
      const { data: styleData } = await supabase
        .from('styles')
        .select('id')
        .eq('slug', style)
        .single();

      if (styleData) {
        const { data: templateStyleData } = await supabase
          .from('template_styles')
          .select('template_id')
          .eq('style_id', styleData.id);

        templateIdsFromStyle = new Set(templateStyleData?.map(ts => ts.template_id) || []);
      }
    }

    // For featured filter
    let featuredAuthorIds: Set<string> | null = null;
    if (featured) {
      const { data: featuredAuthors } = await supabase
        .from('featured_authors')
        .select('author_id')
        .eq('is_active', true);

      featuredAuthorIds = new Set(featuredAuthors?.map(a => a.author_id) || []);
    }

    // Get all featured authors for display
    const { data: allFeaturedAuthors } = await supabase
      .from('featured_authors')
      .select('author_id')
      .eq('is_active', true);
    const allFeaturedAuthorIds = new Set(allFeaturedAuthors?.map(a => a.author_id) || []);

    // Execute main query
    const { data: templates, count, error } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Templates query error:', error);
      throw error;
    }

    // Filter templates based on subcategory/style/featured
    let filteredTemplates = templates || [];

    if (templateIdsFromSubcategory) {
      filteredTemplates = filteredTemplates.filter(t => templateIdsFromSubcategory!.has(t.id));
    }

    if (templateIdsFromStyle) {
      filteredTemplates = filteredTemplates.filter(t => templateIdsFromStyle!.has(t.id));
    }

    if (featuredAuthorIds) {
      filteredTemplates = filteredTemplates.filter(t => t.author_id && featuredAuthorIds!.has(t.author_id));
    }

    // Enhance templates with metadata
    const enhancedTemplates = await Promise.all(
      filteredTemplates.map(async (template) => {
        // Get subcategories
        const { data: subcats } = await supabase
          .from('template_subcategories')
          .select('subcategories(name)')
          .eq('template_id', template.id);

        // Get styles
        const { data: templateStyles } = await supabase
          .from('template_styles')
          .select('styles(name)')
          .eq('template_id', template.id);

        return {
          ...template,
          subcategories: subcats?.map(s => (s.subcategories as { name: string })?.name).filter(Boolean) || [],
          styles: templateStyles?.map(s => (s.styles as { name: string })?.name).filter(Boolean) || [],
          is_featured_author: template.author_id ? allFeaturedAuthorIds.has(template.author_id) : false
        };
      })
    );

    // Sort: featured authors first, then by created_at
    enhancedTemplates.sort((a, b) => {
      if (a.is_featured_author && !b.is_featured_author) return -1;
      if (!a.is_featured_author && b.is_featured_author) return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    // Calculate proper total for filtered results
    let total = count || 0;
    if (subcategory || style || featured) {
      // Recalculate total for filtered results
      let countQuery = supabase.from('templates').select('id', { count: 'exact', head: true });
      if (author) {
        countQuery = countQuery.eq('author_id', author);
      }
      const { count: filteredCount } = await countQuery;

      // Apply same filters
      if (templateIdsFromSubcategory) {
        total = templateIdsFromSubcategory.size;
      } else if (templateIdsFromStyle) {
        total = templateIdsFromStyle.size;
      } else if (featuredAuthorIds) {
        const { count: featuredCount } = await supabase
          .from('templates')
          .select('id', { count: 'exact', head: true })
          .in('author_id', Array.from(featuredAuthorIds));
        total = featuredCount || 0;
      } else {
        total = filteredCount || 0;
      }
    }

    const totalPages = Math.ceil(total / limit);

    console.log('[Templates API] Pagination info:', {
      total,
      totalPages,
      currentPage: page,
      hasNext: page < totalPages,
      returnedCount: enhancedTemplates.length
    });

    return NextResponse.json({
      templates: enhancedTemplates,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });

  } catch (error) {
    console.error('Templates API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Get single template
export async function POST(request: NextRequest) {
  try {
    const { template_id } = await request.json();

    const { data: template, error } = await supabase
      .from('templates')
      .select('*')
      .eq('template_id', template_id)
      .single();

    if (error || !template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    // Get subcategories
    const { data: subcats } = await supabase
      .from('template_subcategories')
      .select('subcategories(name)')
      .eq('template_id', template.id);

    // Get styles
    const { data: templateStyles } = await supabase
      .from('template_styles')
      .select('styles(name)')
      .eq('template_id', template.id);

    // Get features
    const { data: templateFeatures } = await supabase
      .from('template_features')
      .select('features(name)')
      .eq('template_id', template.id);

    return NextResponse.json({
      ...template,
      subcategories: subcats?.map(s => (s.subcategories as { name: string })?.name).filter(Boolean) || [],
      styles: templateStyles?.map(s => (s.styles as { name: string })?.name).filter(Boolean) || [],
      features: templateFeatures?.map(f => (f.features as { name: string })?.name).filter(Boolean) || []
    });

  } catch (error) {
    console.error('Template API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
