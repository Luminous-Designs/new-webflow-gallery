import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const revalidate = 300;

export async function GET() {
  try {
    // Fast path: view with counts (single query)
    const { data, error } = await supabaseAdmin
      .from('subcategories_with_counts')
      .select('id, name, slug, display_name, template_count')
      .order('template_count', { ascending: false });

    if (!error && data) {
      const res = NextResponse.json(data);
      res.headers.set('Cache-Control', 'public, max-age=0, s-maxage=300, stale-while-revalidate=3600');
      return res;
    }

    // Fallback (older DB without view)
    const { data: subcategories, error: subErr } = await supabaseAdmin
      .from('subcategories')
      .select('id, name, slug, display_name')
      .order('name');
    if (subErr) throw subErr;

    const subcategoriesWithCounts = await Promise.all(
      (subcategories || []).map(async (sub) => {
        const { count } = await supabaseAdmin
          .from('template_subcategories')
          .select('*', { count: 'exact', head: true })
          .eq('subcategory_id', sub.id);
        return { ...sub, template_count: count || 0 };
      })
    );

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
