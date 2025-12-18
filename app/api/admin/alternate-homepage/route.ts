import { NextRequest, NextResponse } from 'next/server';
import { getHomepagePatterns } from '@/lib/scraper/homepage-detector';
import { supabaseAdmin } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || token !== adminPassword) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    const [{ count: totalTemplates }, { count: alternateHomepageCount }] = await Promise.all([
      supabaseAdmin.from('templates').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('templates').select('id', { count: 'exact', head: true }).eq('is_alternate_homepage', true),
    ]);

    const total = totalTemplates || 0;
    const alternateCount = alternateHomepageCount || 0;
    const indexPageCount = Math.max(0, total - alternateCount);
    const alternatePercentage = total > 0 ? Math.round((alternateCount / total) * 100) : 0;

    const { data: alternatePathsRows } = await supabaseAdmin
      .from('templates')
      .select('alternate_homepage_path')
      .eq('is_alternate_homepage', true)
      .not('alternate_homepage_path', 'is', null)
      .limit(10_000);

    const pathCounts = new Map<string, number>();
    for (const row of alternatePathsRows || []) {
      const path = (row.alternate_homepage_path as string | null) || '';
      if (!path) continue;
      pathCounts.set(path, (pathCounts.get(path) || 0) + 1);
    }

    const topAlternatePaths = Array.from(pathCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([path, count]) => ({ path, count }));

    const { data: templates } = await supabaseAdmin
      .from('templates')
      .select('id, name, slug, author_name, live_preview_url, screenshot_url, alternate_homepage_path, screenshot_path')
      .eq('is_alternate_homepage', true)
      .order('updated_at', { ascending: false })
      .limit(50);

    // Get patterns for reference
    const patterns = getHomepagePatterns();

    return NextResponse.json({
      metrics: {
        totalTemplates: total,
        alternateHomepageCount: alternateCount,
        indexPageCount,
        alternatePercentage,
        topAlternatePaths,
      },
      templates: (templates || []).map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        author_name: t.author_name,
        live_preview_url: t.live_preview_url,
        screenshot_url: t.screenshot_url,
        alternate_homepage_path: t.alternate_homepage_path,
        screenshot_path: t.screenshot_path,
      })),
      patterns
    });
  } catch (error) {
    console.error('Error fetching alternate homepage metrics:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics' },
      { status: 500 }
    );
  }
}
