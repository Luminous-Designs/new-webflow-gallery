import { NextRequest, NextResponse } from 'next/server';
import { chromium, Browser, Page } from 'playwright';
import { supabaseAdmin } from '@/lib/supabase';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function checkAuth(request: NextRequest): boolean {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return false;
  return authHeader.slice(7) === ADMIN_PASSWORD;
}

interface CategoryData {
  primaryCategory: string[];
  webflowSubcategories: string[];
}

async function extractCategories(page: Page, url: string): Promise<CategoryData | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const data = await page.evaluate(() => {
      const primaryCategory: string[] = [];
      document.querySelectorAll('a[href*="/templates/category/"]').forEach(el => {
        const classes = el.className || '';
        if (classes.includes('button')) return;
        const text = el.textContent?.trim();
        // Filter out "Browse all" navigation links
        if (text && !primaryCategory.includes(text) && text.toLowerCase() !== 'browse all') {
          primaryCategory.push(text);
        }
      });

      const webflowSubcategories: string[] = [];
      document.querySelectorAll('a[href*="/templates/subcategory/"]').forEach(el => {
        const text = el.textContent?.trim();
        // Filter out "Browse all" navigation links
        if (text && !webflowSubcategories.includes(text) && text.toLowerCase() !== 'browse all') {
          webflowSubcategories.push(text);
        }
      });

      return { primaryCategory, webflowSubcategories };
    });

    return data;
  } catch {
    return null;
  }
}

// GET: Get current status/stats
export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { count: total } = await supabaseAdmin
    .from('templates')
    .select('*', { count: 'exact', head: true });

  const { count: withPrimary } = await supabaseAdmin
    .from('templates')
    .select('*', { count: 'exact', head: true })
    .not('primary_category', 'is', null);

  const { count: withSubcategories } = await supabaseAdmin
    .from('templates')
    .select('*', { count: 'exact', head: true })
    .not('webflow_subcategories', 'is', null);

  // Get sample of categories
  const { data: sampleData } = await supabaseAdmin
    .from('templates')
    .select('slug, primary_category, webflow_subcategories')
    .not('primary_category', 'is', null)
    .limit(5);

  return NextResponse.json({
    stats: {
      total,
      withPrimaryCategory: withPrimary,
      withWebflowSubcategories: withSubcategories,
      missingPrimaryCategory: (total || 0) - (withPrimary || 0),
      missingWebflowSubcategories: (total || 0) - (withSubcategories || 0),
    },
    samples: sampleData,
  });
}

// POST: Run batch update
export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const limit = Math.min(body.limit || 100, 500); // Max 500 per request
  const offset = body.offset || 0;
  const onlyMissing = body.onlyMissing !== false; // Default to only update missing

  // Build query
  let query = supabaseAdmin
    .from('templates')
    .select('id, slug, storefront_url, primary_category, webflow_subcategories')
    .order('id', { ascending: true });

  if (onlyMissing) {
    query = query.is('primary_category', null);
  }

  query = query.range(offset, offset + limit - 1);

  const { data: templates, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!templates || templates.length === 0) {
    return NextResponse.json({
      message: 'No templates to process',
      processed: 0,
      success: 0,
      failed: 0,
    });
  }

  let browser: Browser | null = null;
  let success = 0;
  let failed = 0;
  const results: Array<{ slug: string; status: string; categories?: CategoryData }> = [];

  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    // Process with limited concurrency
    const CONCURRENCY = 5;
    for (let i = 0; i < templates.length; i += CONCURRENCY) {
      const batch = templates.slice(i, i + CONCURRENCY);

      await Promise.all(
        batch.map(async (template) => {
          const page = await browser!.newPage();
          try {
            const categories = await extractCategories(page, template.storefront_url);

            if (!categories) {
              results.push({ slug: template.slug, status: 'failed', categories: undefined });
              failed++;
              return;
            }

            const { error: updateError } = await supabaseAdmin
              .from('templates')
              .update({
                primary_category: categories.primaryCategory.length > 0 ? categories.primaryCategory : null,
                webflow_subcategories: categories.webflowSubcategories.length > 0 ? categories.webflowSubcategories : null,
                updated_at: new Date().toISOString(),
              })
              .eq('id', template.id);

            if (updateError) {
              results.push({ slug: template.slug, status: 'db_error', categories });
              failed++;
            } else {
              results.push({ slug: template.slug, status: 'success', categories });
              success++;
            }
          } catch {
            results.push({ slug: template.slug, status: 'error' });
            failed++;
          } finally {
            await page.close();
          }
        })
      );
    }
  } finally {
    if (browser) await browser.close();
  }

  return NextResponse.json({
    message: `Processed ${templates.length} templates`,
    processed: templates.length,
    success,
    failed,
    results: results.slice(0, 20), // Only return first 20 for brevity
  });
}
