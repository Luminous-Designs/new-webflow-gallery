import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const revalidate = 300;

export async function GET() {
  try {
    const cacheControl = 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600';

    // Fast path: view with counts (single query)
    const { data, error } = await supabaseAdmin
      .from('styles_with_counts')
      .select('id, name, slug, display_name, template_count')
      .order('template_count', { ascending: false })
      .order('display_name', { ascending: true });

    if (!error && data) {
      const res = NextResponse.json(data);
      res.headers.set('Cache-Control', cacheControl);
      res.headers.set('CDN-Cache-Control', cacheControl);
      return res;
    }

    // Fallback (older DB without view)
    const { data: styles, error: stylesError } = await supabaseAdmin
      .from('styles')
      .select('id, name, slug, display_name')
      .order('display_name');
    if (stylesError) throw stylesError;

    const stylesWithCounts = await Promise.all(
      (styles || []).map(async (style) => {
        const { count } = await supabaseAdmin
          .from('template_styles')
          .select('*', { count: 'exact', head: true })
          .eq('style_id', style.id);
        return { ...style, template_count: count || 0 };
      })
    );

    stylesWithCounts.sort((a, b) => {
      if (b.template_count !== a.template_count) return b.template_count - a.template_count;
      return (a.display_name || '').localeCompare(b.display_name || '');
    });

    const res = NextResponse.json(stylesWithCounts);
    res.headers.set('Cache-Control', cacheControl);
    res.headers.set('CDN-Cache-Control', cacheControl);
    return res;
  } catch (error) {
    console.error('Failed to fetch styles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch styles' },
      { status: 500 }
    );
  }
}
