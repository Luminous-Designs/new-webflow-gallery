import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Get all subcategories
    const { data: subcategories, error } = await supabase
      .from('subcategories')
      .select('*')
      .order('name');

    if (error) {
      throw error;
    }

    // Get counts for each subcategory
    const subcategoriesWithCounts = await Promise.all(
      (subcategories || []).map(async (sub) => {
        const { count } = await supabase
          .from('template_subcategories')
          .select('*', { count: 'exact', head: true })
          .eq('subcategory_id', sub.id);

        return { ...sub, template_count: count || 0 };
      })
    );

    // Sort by template count descending
    subcategoriesWithCounts.sort((a, b) => b.template_count - a.template_count);

    return NextResponse.json(subcategoriesWithCounts);

  } catch (error) {
    console.error('Subcategories API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
