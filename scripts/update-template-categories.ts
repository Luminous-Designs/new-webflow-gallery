/**
 * Batch Update Script: Update template categories
 *
 * This script updates the primary_category and webflow_subcategories fields
 * for all existing templates by scraping their storefront pages.
 *
 * Usage:
 *   npx tsx scripts/update-template-categories.ts
 *   npx tsx scripts/update-template-categories.ts --limit 100
 *   npx tsx scripts/update-template-categories.ts --offset 500 --limit 100
 *   npx tsx scripts/update-template-categories.ts --dry-run
 */

import { chromium, Browser, Page } from 'playwright';
import { createClient } from '@supabase/supabase-js';

// Load environment variables
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing required environment variables:');
  console.error('  NEXT_PUBLIC_SUPABASE_URL');
  console.error('  SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Parse command line arguments
const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  return index !== -1 ? args[index + 1] : undefined;
};

const BATCH_SIZE = 50; // Templates per batch
const CONCURRENCY = 5; // Concurrent browser pages
const LIMIT = getArg('limit') ? parseInt(getArg('limit')!, 10) : undefined;
const OFFSET = getArg('offset') ? parseInt(getArg('offset')!, 10) : 0;
const DRY_RUN = args.includes('--dry-run');

interface TemplateRow {
  id: number;
  slug: string;
  storefront_url: string;
  primary_category: string[] | null;
  webflow_subcategories: string[] | null;
}

interface CategoryData {
  primaryCategory: string[];
  webflowSubcategories: string[];
}

async function extractCategories(page: Page, url: string): Promise<CategoryData | null> {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

    const data = await page.evaluate(() => {
      // Extract PRIMARY CATEGORIES from /templates/category/ links
      const primaryCategory: string[] = [];
      document.querySelectorAll('a[href*="/templates/category/"]').forEach(el => {
        const classes = el.className || '';
        if (classes.includes('button')) return;
        const text = el.textContent?.trim();
        // Filter out "Browse all" and similar navigation links
        if (text && !primaryCategory.includes(text) && text.toLowerCase() !== 'browse all') {
          primaryCategory.push(text);
        }
      });

      // Extract WEBFLOW SUBCATEGORIES from /templates/subcategory/ links
      const webflowSubcategories: string[] = [];
      document.querySelectorAll('a[href*="/templates/subcategory/"]').forEach(el => {
        const text = el.textContent?.trim();
        // Filter out "Browse all" and similar navigation links
        if (text && !webflowSubcategories.includes(text) && text.toLowerCase() !== 'browse all') {
          webflowSubcategories.push(text);
        }
      });

      return { primaryCategory, webflowSubcategories };
    });

    return data;
  } catch (error) {
    console.error(`Failed to extract categories from ${url}:`, error instanceof Error ? error.message : error);
    return null;
  }
}

async function updateTemplate(
  templateId: number,
  primaryCategory: string[] | null,
  webflowSubcategories: string[] | null
): Promise<boolean> {
  if (DRY_RUN) {
    console.log(`[DRY RUN] Would update template ${templateId}:`, { primaryCategory, webflowSubcategories });
    return true;
  }

  const { error } = await supabase
    .from('templates')
    .update({
      primary_category: primaryCategory,
      webflow_subcategories: webflowSubcategories,
      updated_at: new Date().toISOString(),
    })
    .eq('id', templateId);

  if (error) {
    console.error(`Failed to update template ${templateId}:`, error.message);
    return false;
  }

  return true;
}

async function processTemplatesBatch(
  templates: TemplateRow[],
  browser: Browser
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  // Process in parallel with limited concurrency
  const chunks: TemplateRow[][] = [];
  for (let i = 0; i < templates.length; i += CONCURRENCY) {
    chunks.push(templates.slice(i, i + CONCURRENCY));
  }

  for (const chunk of chunks) {
    const results = await Promise.all(
      chunk.map(async (template) => {
        const page = await browser.newPage();
        try {
          const categories = await extractCategories(page, template.storefront_url);

          if (!categories) {
            console.log(`[SKIP] ${template.slug}: Failed to extract categories`);
            return false;
          }

          const updated = await updateTemplate(
            template.id,
            categories.primaryCategory.length > 0 ? categories.primaryCategory : null,
            categories.webflowSubcategories.length > 0 ? categories.webflowSubcategories : null
          );

          if (updated) {
            console.log(`[OK] ${template.slug}: ${categories.primaryCategory.join(', ')} | ${categories.webflowSubcategories.join(', ')}`);
            return true;
          } else {
            console.log(`[FAIL] ${template.slug}: Database update failed`);
            return false;
          }
        } catch (error) {
          console.error(`[ERROR] ${template.slug}:`, error instanceof Error ? error.message : error);
          return false;
        } finally {
          await page.close();
        }
      })
    );

    success += results.filter(Boolean).length;
    failed += results.filter((r) => !r).length;
  }

  return { success, failed };
}

async function fetchAllTemplates(onlyMissing: boolean = true): Promise<TemplateRow[]> {
  const PAGE_SIZE = 1000; // Supabase max
  const allTemplates: TemplateRow[] = [];
  let offset = OFFSET;
  let hasMore = true;

  while (hasMore) {
    let query = supabase
      .from('templates')
      .select('id, slug, storefront_url, primary_category, webflow_subcategories')
      .order('id', { ascending: true });

    // Only fetch templates missing categories if flag is set
    if (onlyMissing) {
      query = query.is('primary_category', null);
    }

    const { data, error } = await query.range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      throw new Error(`Failed to fetch templates: ${error.message}`);
    }

    if (!data || data.length === 0) {
      hasMore = false;
    } else {
      allTemplates.push(...(data as TemplateRow[]));
      offset += PAGE_SIZE;

      // If we got less than PAGE_SIZE, we've reached the end
      if (data.length < PAGE_SIZE) {
        hasMore = false;
      }

      // Respect LIMIT if set
      if (LIMIT && allTemplates.length >= LIMIT) {
        return allTemplates.slice(0, LIMIT);
      }
    }
  }

  return allTemplates;
}

async function main() {
  console.log('='.repeat(60));
  console.log('Template Category Batch Update');
  console.log('='.repeat(60));
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`);
  console.log(`Offset: ${OFFSET}`);
  console.log(`Limit: ${LIMIT ?? 'all'}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log('='.repeat(60));

  // Fetch templates count
  const { count: totalCount } = await supabase
    .from('templates')
    .select('*', { count: 'exact', head: true });

  const { count: missingCount } = await supabase
    .from('templates')
    .select('*', { count: 'exact', head: true })
    .is('primary_category', null);

  console.log(`Total templates in database: ${totalCount}`);
  console.log(`Templates missing categories: ${missingCount}`);
  console.log('Fetching templates (paginating through Supabase)...');

  // Fetch all templates that need updating
  const templates = await fetchAllTemplates(true);
  const error = null;

  if (error) {
    console.error('Failed to fetch templates:', error.message);
    process.exit(1);
  }

  if (!templates || templates.length === 0) {
    console.log('No templates to process');
    process.exit(0);
  }

  console.log(`Processing ${templates.length} templates...`);
  console.log('');

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  let totalSuccess = 0;
  let totalFailed = 0;
  const startTime = Date.now();

  try {
    // Process in batches
    for (let i = 0; i < templates.length; i += BATCH_SIZE) {
      const batch = templates.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(templates.length / BATCH_SIZE);

      console.log(`\n--- Batch ${batchNum}/${totalBatches} (${batch.length} templates) ---`);

      const { success, failed } = await processTemplatesBatch(batch as TemplateRow[], browser);
      totalSuccess += success;
      totalFailed += failed;

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const processed = i + batch.length;
      const rate = (processed / parseFloat(elapsed)).toFixed(1);
      console.log(`Progress: ${processed}/${templates.length} (${rate} templates/sec)`);
    }
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total processed: ${templates.length}`);
  console.log(`Successful: ${totalSuccess}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Time elapsed: ${elapsed}s`);
  console.log(`Rate: ${(templates.length / parseFloat(elapsed)).toFixed(1)} templates/sec`);
  console.log('='.repeat(60));

  if (DRY_RUN) {
    console.log('\nThis was a DRY RUN. No changes were made to the database.');
    console.log('Run without --dry-run to apply changes.');
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
