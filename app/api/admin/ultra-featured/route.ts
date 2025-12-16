import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

type FeaturedTemplateRow = Record<string, unknown> & {
  subcategories?: string | null;
  styles?: string | null;
};

/* eslint-disable @typescript-eslint/no-explicit-any */

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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

    const [ultraFeatured, featuredAuthorTemplates] = await Promise.all([
      db.getUltraFeaturedTemplates(),
      db.allAsync<FeaturedTemplateRow>(
        `SELECT ${selectColumns},
                GROUP_CONCAT(DISTINCT s.name) as subcategories,
                GROUP_CONCAT(DISTINCT st.name) as styles
         FROM templates t
         JOIN featured_authors fa ON fa.author_id = t.author_id
         LEFT JOIN template_subcategories ts ON t.id = ts.template_id
         LEFT JOIN subcategories s ON ts.subcategory_id = s.id
         LEFT JOIN template_styles tst ON t.id = tst.template_id
         LEFT JOIN styles st ON tst.style_id = st.id
         WHERE fa.is_active = 1
         GROUP BY t.id
         ORDER BY t.updated_at DESC`
      )
    ]);

    return NextResponse.json({
      ultraFeatured,
      pool: featuredAuthorTemplates.map((template) => ({
        ...template,
        subcategories: typeof template.subcategories === 'string'
          ? template.subcategories.split(',')
          : [],
        styles: typeof template.styles === 'string'
          ? template.styles.split(',')
          : [],
      }))
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

    await db.replaceUltraFeaturedTemplates(numericIds);

    const ultraFeatured = await db.getUltraFeaturedTemplates();

    return NextResponse.json({
      message: 'Ultra featured templates updated',
      ultraFeatured
    });
  } catch (error) {
    console.error('Ultra featured POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
