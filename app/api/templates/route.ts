import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

type TemplateRow = Record<string, unknown> & {
  subcategories?: string | null;
  styles?: string | null;
  is_featured_author?: number | null;
  features?: string | null;
};

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

    const selectColumns = `
      t.id,
      t.template_id,
      t.name,
      t.slug,
      t.author_name,
      t.author_id,
      t.storefront_url,
      t.live_preview_url,
      t.designer_preview_url,
      t.price,
      t.short_description,
      t.screenshot_path,
      t.screenshot_thumbnail_path,
      t.is_featured,
      t.is_cms,
      t.is_ecommerce,
      t.created_at,
      t.updated_at
    `;

    if (collection === 'ultra') {
      const templates = await db.allAsync<TemplateRow>(
        `SELECT ${selectColumns},
                uft.position,
                GROUP_CONCAT(DISTINCT s.name) as subcategories,
                GROUP_CONCAT(DISTINCT st.name) as styles,
                CASE WHEN fa.author_id IS NOT NULL THEN 1 ELSE 0 END as is_featured_author
         FROM ultra_featured_templates uft
         JOIN templates t ON t.id = uft.template_id
         LEFT JOIN template_subcategories ts ON t.id = ts.template_id
         LEFT JOIN subcategories s ON ts.subcategory_id = s.id
         LEFT JOIN template_styles tst ON t.id = tst.template_id
         LEFT JOIN styles st ON tst.style_id = st.id
         LEFT JOIN featured_authors fa ON t.author_id = fa.author_id AND fa.is_active = 1
         GROUP BY t.id
         ORDER BY uft.position ASC
         LIMIT ? OFFSET ?`,
        [limit, offset]
      );

      const countResult = await db.getAsync<{ total: number }>(
        'SELECT COUNT(*) as total FROM ultra_featured_templates'
      );

      const total = countResult?.total || 0;
      const totalPages = Math.ceil(total / limit);

      return NextResponse.json({
        templates: templates.map((t) => ({
          ...t,
          subcategories: typeof t.subcategories === 'string' ? t.subcategories.split(',') : [],
          styles: typeof t.styles === 'string' ? t.styles.split(',') : [],
          is_featured_author: t.is_featured_author === 1
        })),
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

    let query = `
      SELECT DISTINCT ${selectColumns},
        GROUP_CONCAT(DISTINCT s.name) as subcategories,
        GROUP_CONCAT(DISTINCT st.name) as styles,
        CASE WHEN fa.author_id IS NOT NULL THEN 1 ELSE 0 END as is_featured_author
      FROM templates t
      LEFT JOIN template_subcategories ts ON t.id = ts.template_id
      LEFT JOIN subcategories s ON ts.subcategory_id = s.id
      LEFT JOIN template_styles tst ON t.id = tst.template_id
      LEFT JOIN styles st ON tst.style_id = st.id
      LEFT JOIN featured_authors fa ON t.author_id = fa.author_id AND fa.is_active = 1
    `;

    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (subcategory) {
      conditions.push(`s.slug = ?`);
      params.push(subcategory);
    }

    if (style) {
      conditions.push(`st.slug = ?`);
      params.push(style);
    }

    if (author) {
      conditions.push(`t.author_id = ?`);
      params.push(author);
    }

    if (featured) {
      conditions.push(`t.author_id IN (SELECT author_id FROM featured_authors WHERE is_active = 1)`);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    // Order by featured authors first, then by creation date
    query += `
      GROUP BY t.id
      ORDER BY
        CASE WHEN t.author_id IN (SELECT author_id FROM featured_authors WHERE is_active = 1) THEN 0 ELSE 1 END,
        t.created_at DESC
      LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const templates = await db.allAsync<TemplateRow>(query, params);
    console.log('[Templates API] Query returned', templates.length, 'templates');

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(DISTINCT t.id) as total
      FROM templates t
      LEFT JOIN template_subcategories ts ON t.id = ts.template_id
      LEFT JOIN subcategories s ON ts.subcategory_id = s.id
      LEFT JOIN template_styles tst ON t.id = tst.template_id
      LEFT JOIN styles st ON tst.style_id = st.id
    `;

    if (conditions.length > 0) {
      countQuery += ` WHERE ${conditions.join(' AND ')}`;
    }

    const countResult = await db.getAsync<{ total: number }>(
      countQuery,
      params.slice(0, -2) // Remove limit and offset
    );

    const total = countResult?.total || 0;
    const totalPages = Math.ceil(total / limit);

    console.log('[Templates API] Pagination info:', {
      total,
      totalPages,
      currentPage: page,
      hasNext: page < totalPages,
      returnedCount: templates.length
    });

    return NextResponse.json({
      templates: templates.map((t) => ({
        ...t,
        subcategories: typeof t.subcategories === 'string' ? t.subcategories.split(',') : [],
        styles: typeof t.styles === 'string' ? t.styles.split(',') : [],
        is_featured_author: t.is_featured_author === 1
      })),
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

    const template = await db.getAsync<TemplateRow>(
      `SELECT t.*,
        GROUP_CONCAT(DISTINCT s.name) as subcategories,
        GROUP_CONCAT(DISTINCT st.name) as styles,
        GROUP_CONCAT(DISTINCT f.name) as features
      FROM templates t
      LEFT JOIN template_subcategories ts ON t.id = ts.template_id
      LEFT JOIN subcategories s ON ts.subcategory_id = s.id
      LEFT JOIN template_styles tst ON t.id = tst.template_id
      LEFT JOIN styles st ON tst.style_id = st.id
      LEFT JOIN template_features tf ON t.id = tf.template_id
      LEFT JOIN features f ON tf.feature_id = f.id
      WHERE t.template_id = ?
      GROUP BY t.id`,
      [template_id]
    );

    if (!template) {
      return NextResponse.json({ error: 'Template not found' }, { status: 404 });
    }

    return NextResponse.json({
      ...template,
      subcategories: typeof template.subcategories === 'string' ? template.subcategories.split(',') : [],
      styles: typeof template.styles === 'string' ? template.styles.split(',') : [],
      features: typeof template.features === 'string' ? template.features.split(',') : []
    });

  } catch (error) {
    console.error('Template API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
