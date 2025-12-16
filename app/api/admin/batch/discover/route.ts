import { NextRequest, NextResponse } from 'next/server';
import { BatchScraper } from '@/lib/scraper/batch-scraper';

export async function GET(request: NextRequest) {
  // Check admin auth
  const authHeader = request.headers.get('authorization');
  if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Create a temporary scraper just for discovery
    const scraper = new BatchScraper();

    const discovery = await scraper.discoverNewTemplates();

    return NextResponse.json({
      discovery: {
        totalInSitemap: discovery.totalInSitemap,
        existingInDb: discovery.existingInDb,
        blacklisted: discovery.blacklisted,
        newCount: discovery.newTemplates.length,
        newTemplates: discovery.newTemplates
      }
    });
  } catch (error) {
    console.error('Batch discovery error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Discovery failed' },
      { status: 500 }
    );
  }
}
