import { NextRequest, NextResponse } from 'next/server';
import { getAlternateHomepageMetrics, getAlternateHomepageTemplates } from '@/lib/db';
import { getHomepagePatterns } from '@/lib/scraper/homepage-detector';

export async function GET(request: NextRequest) {
  try {
    // Check auth
    const authHeader = request.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const token = authHeader.split(' ')[1];
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword || token !== adminPassword) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 });
    }

    // Get metrics
    const metrics = await getAlternateHomepageMetrics();

    // Get templates with alternate homepages
    const templates = await getAlternateHomepageTemplates(50);

    // Get patterns for reference
    const patterns = getHomepagePatterns();

    return NextResponse.json({
      metrics,
      templates: templates.map(t => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        author_name: t.author_name,
        live_preview_url: t.live_preview_url,
        screenshot_url: t.screenshot_url,
        alternate_homepage_path: t.alternate_homepage_path,
        screenshot_thumbnail_path: t.screenshot_thumbnail_path
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
