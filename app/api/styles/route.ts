import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    // Get all styles
    const { data: styles, error: stylesError } = await supabase
      .from('styles')
      .select('id, name, slug, display_name')
      .order('display_name');

    if (stylesError) throw stylesError;

    // Get template counts for each style
    const stylesWithCounts = await Promise.all(
      (styles || []).map(async (style) => {
        const { count } = await supabase
          .from('template_styles')
          .select('*', { count: 'exact', head: true })
          .eq('style_id', style.id);

        return {
          ...style,
          template_count: count || 0
        };
      })
    );

    // Sort by template count descending, then display_name ascending
    stylesWithCounts.sort((a, b) => {
      if (b.template_count !== a.template_count) {
        return b.template_count - a.template_count;
      }
      return (a.display_name || '').localeCompare(b.display_name || '');
    });

    return NextResponse.json(stylesWithCounts);
  } catch (error) {
    console.error('Failed to fetch styles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch styles' },
      { status: 500 }
    );
  }
}
