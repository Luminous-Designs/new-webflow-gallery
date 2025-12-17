import { NextRequest, NextResponse } from 'next/server';
import { supabase, getUltraFeaturedTemplates, replaceUltraFeaturedTemplates } from '@/lib/supabase';

/* eslint-disable @typescript-eslint/no-explicit-any */

function isAuthorized(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  return authHeader && authHeader === `Bearer ${process.env.ADMIN_PASSWORD}`;
}

async function getTemplateMetadata(templateId: number) {
  const [subcatsData, stylesData] = await Promise.all([
    supabase
      .from('template_subcategories')
      .select('subcategories(name)')
      .eq('template_id', templateId),
    supabase
      .from('template_styles')
      .select('styles(name)')
      .eq('template_id', templateId)
  ]);

  const subcategories = subcatsData.data?.map(d => (d.subcategories as { name: string })?.name).filter(Boolean) || [];
  const styles = stylesData.data?.map(d => (d.styles as { name: string })?.name).filter(Boolean) || [];

  return { subcategories, styles };
}

export async function GET(request: NextRequest) {
  try {
    if (!isAuthorized(request)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get ultra featured templates
    const ultraFeatured = await getUltraFeaturedTemplates();

    // Get featured author IDs
    const { data: featuredAuthors } = await supabase
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
    const { data: templates } = await supabase
      .from('templates')
      .select('*')
      .in('author_id', authorIds)
      .order('updated_at', { ascending: false });

    // Add metadata to each template
    const pool = await Promise.all(
      (templates || []).map(async (template) => {
        const { subcategories, styles } = await getTemplateMetadata(template.id);
        return {
          ...template,
          subcategories,
          styles
        };
      })
    );

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
