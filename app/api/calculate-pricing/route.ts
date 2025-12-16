import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sitemapUrl, websiteUrl } = body;

    if (!sitemapUrl || !websiteUrl) {
      return NextResponse.json({ error: 'Website URL required' }, { status: 400 });
    }

    let pageCount = 0;

    try {
      // Fetch sitemap
      const response = await axios.get(sitemapUrl, {
        timeout: 10000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; LuminousBot/1.0)'
        }
      });

      const xml = response.data;

      // Count <loc> tags (excluding blog URLs)
      const locRegex = /<loc>([^<]+)<\/loc>/g;
      let match;
      let count = 0;

      while ((match = locRegex.exec(xml)) !== null) {
        const url = match[1];
        // Exclude blog URLs
        if (!url.includes('/blog/') && !url.includes('/post/') && !url.includes('/article/')) {
          count += 1;
        }
      }

      pageCount = count;

    } catch (error) {
      console.error('Sitemap fetch error:', error);

      // If sitemap fails, try a basic estimation
      // In production, you might want to use a web crawler or other method
      pageCount = 10; // Default assumption
    }

    // Check if approved (under 100 pages)
    const approved = pageCount <= 100;

    return NextResponse.json({
      pageCount,
      approved,
      price: approved ? 1200 : null,
      message: approved
        ? 'Your website qualifies for standard pricing'
        : 'Your website requires custom pricing'
    });

  } catch (error) {
    console.error('Pricing calculation error:', error);
    return NextResponse.json(
      { error: 'Failed to calculate pricing' },
      { status: 500 }
    );
  }
}
