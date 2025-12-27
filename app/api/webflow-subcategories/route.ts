import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/client';

export const revalidate = 300; // 5 minutes

export async function GET() {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY');
    }

    // Get all unique webflow subcategories with their template counts
    const { data: templates, error } = await supabaseAdmin
      .from('templates')
      .select('webflow_subcategories')
      .not('webflow_subcategories', 'is', null);

    if (error) throw error;

    // Aggregate subcategories and count occurrences
    const subcategoryMap = new Map<string, number>();

    for (const template of templates || []) {
      const subcategories = template.webflow_subcategories as string[] | null;
      if (subcategories && Array.isArray(subcategories)) {
        for (const subcategory of subcategories) {
          subcategoryMap.set(subcategory, (subcategoryMap.get(subcategory) || 0) + 1);
        }
      }
    }

    // Convert to array and sort by count (descending)
    const subcategories = Array.from(subcategoryMap.entries())
      .map(([name, count]) => ({
        name,
        slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
        display_name: name,
        template_count: count,
        type: 'subcategory' as const,
      }))
      .sort((a, b) => b.template_count - a.template_count);

    return NextResponse.json(subcategories, {
      headers: {
        'Cache-Control': 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching webflow subcategories:', error);
    return NextResponse.json(
      { error: 'Failed to fetch webflow subcategories' },
      { status: 500 }
    );
  }
}
