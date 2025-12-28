import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/client';

export const revalidate = 300; // 5 minutes

export async function GET() {
  try {
    // Get all unique primary categories with their template counts
    const { data: templates, error } = await supabaseAdmin
      .from('templates')
      .select('primary_category')
      .not('primary_category', 'is', null);

    if (error) throw error;

    // Aggregate categories and count occurrences
    const categoryMap = new Map<string, number>();

    for (const template of templates || []) {
      const categories = template.primary_category as string[] | null;
      if (categories && Array.isArray(categories)) {
        for (const category of categories) {
          categoryMap.set(category, (categoryMap.get(category) || 0) + 1);
        }
      }
    }

    // Convert to array and sort by count (descending)
    const categories = Array.from(categoryMap.entries())
      .map(([name, count]) => ({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        display_name: name,
        template_count: count,
        type: 'primary' as const,
      }))
      .sort((a, b) => b.template_count - a.template_count);

    return NextResponse.json(categories, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
        'CDN-Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching primary categories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch primary categories' },
      { status: 500 }
    );
  }
}
