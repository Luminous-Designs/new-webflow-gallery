import { NextRequest, NextResponse } from 'next/server';
import axios from 'axios';
import { db } from '@/lib/db';

// Force dynamic rendering - this route uses database
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // Check admin auth
    const authHeader = request.headers.get('authorization');
    if (!authHeader || authHeader !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Step 1: Fetch sitemap from Webflow
    const sitemapUrl = 'https://templates.webflow.com/sitemap.xml';
    const response = await axios.get(sitemapUrl, { timeout: 30000 });
    const xml = response.data;

    // Parse template URLs (only /html/ subdirectory)
    const htmlTemplateRegex = /<loc>(https:\/\/templates\.webflow\.com\/html\/[^<]+)<\/loc>/g;
    const sitemapUrls: string[] = [];
    let match;
    while ((match = htmlTemplateRegex.exec(xml)) !== null) {
      sitemapUrls.push(match[1]);
    }

    // Step 2: Get existing templates from database
    const existingTemplates = await db.allAsync<{ storefront_url: string; name: string }>(
      'SELECT storefront_url, name FROM templates'
    );
    const existingUrls = new Set(existingTemplates.map(t => t.storefront_url));

    // Step 3: Find new templates
    const newTemplates = sitemapUrls
      .filter(url => !existingUrls.has(url))
      .map(url => {
        // Extract slug from URL
        const parts = url.split('/');
        const rawSlug = parts[parts.length - 1];
        const slug = rawSlug.replace('-website-template', '');
        // Create display name from slug
        const displayName = slug
          .split('-')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        return { url, slug, displayName };
      });

    return NextResponse.json({
      success: true,
      discovery: {
        totalInSitemap: sitemapUrls.length,
        existingInDb: existingTemplates.length,
        newCount: newTemplates.length,
        newTemplates: newTemplates
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Discovery API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to discover new templates',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
