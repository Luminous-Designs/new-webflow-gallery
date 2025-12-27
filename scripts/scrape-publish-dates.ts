/**
 * Publish Date Scraper
 *
 * Scrapes publish dates from Webflow template storefront pages and updates the database.
 *
 * Usage:
 *   npx tsx scripts/scrape-publish-dates.ts
 *
 * Options:
 *   --dry-run      Don't update the database, just show what would be updated
 *   --limit=N      Only process N templates (for testing)
 *   --concurrency=N  Number of concurrent browser pages (default: 5)
 *   --skip-existing  Skip templates that already have a publish_date
 */

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Types
type Page = Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>['newPage']>>;

// Load environment variables manually
function loadEnv() {
  const envFiles = [
    path.join(__dirname, '..', '.env.local'),
    path.join(__dirname, '..', '.env'),
  ];

  for (const envFile of envFiles) {
    try {
      if (fs.existsSync(envFile)) {
        const content = fs.readFileSync(envFile, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (trimmed && !trimmed.startsWith('#')) {
            const eqIndex = trimmed.indexOf('=');
            if (eqIndex > 0) {
              const key = trimmed.slice(0, eqIndex).trim();
              let value = trimmed.slice(eqIndex + 1).trim();
              // Remove quotes if present
              if ((value.startsWith('"') && value.endsWith('"')) ||
                  (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
              }
              if (!process.env[key]) {
                process.env[key] = value;
              }
            }
          }
        }
      }
    } catch {
      // Ignore file read errors
    }
  }
}

loadEnv();

// Supabase client
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('\x1b[31mError: Missing Supabase credentials in environment variables\x1b[0m');
  console.error('Required: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Parse command line arguments
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const SKIP_EXISTING = args.includes('--skip-existing');
const limitArg = args.find((a: string) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const concurrencyArg = args.find((a: string) => a.startsWith('--concurrency='));
const CONCURRENCY = concurrencyArg ? parseInt(concurrencyArg.split('=')[1], 10) : 5;

// Configuration
const BATCH_SIZE = 100; // Supabase batch update size
const PAGE_SIZE = 1000; // Supabase fetch page size (max 1000)
const REQUEST_TIMEOUT = 30000; // 30 seconds

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
};

// Progress tracking
interface ProgressState {
  total: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  startTime: number;
  currentTemplate: string;
  recentDates: string[];
}

const state: ProgressState = {
  total: 0,
  processed: 0,
  successful: 0,
  failed: 0,
  skipped: 0,
  startTime: Date.now(),
  currentTemplate: '',
  recentDates: [],
};

// Terminal utilities
function clearLine() {
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  }
  return `${seconds}s`;
}

function formatETA(processed: number, total: number, elapsedMs: number): string {
  if (processed === 0) return 'calculating...';
  const rate = processed / elapsedMs;
  const remaining = total - processed;
  const etaMs = remaining / rate;
  return formatDuration(etaMs);
}

function createProgressBar(current: number, total: number, width: number = 40): string {
  const percentage = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((current / total) * width);
  const empty = width - filled;

  const bar = `${colors.green}${'█'.repeat(filled)}${colors.dim}${'░'.repeat(empty)}${colors.reset}`;
  return `[${bar}] ${percentage}%`;
}

function renderProgress() {
  const elapsed = Date.now() - state.startTime;
  const eta = formatETA(state.processed, state.total, elapsed);
  const rate = state.processed > 0 ? ((state.processed / elapsed) * 1000).toFixed(2) : '0.00';

  clearLine();

  // Build progress display
  const progressBar = createProgressBar(state.processed, state.total);
  const stats = `${colors.green}✓${state.successful}${colors.reset} ${colors.red}✗${state.failed}${colors.reset} ${colors.yellow}○${state.skipped}${colors.reset}`;
  const timing = `${colors.cyan}${formatDuration(elapsed)}${colors.reset} | ETA: ${colors.magenta}${eta}${colors.reset} | ${rate}/s`;

  process.stdout.write(
    `${progressBar} ${state.processed}/${state.total} | ${stats} | ${timing}`
  );
}

function printHeader() {
  console.log(`
${colors.bright}${colors.cyan}╔══════════════════════════════════════════════════════════════╗
║           ${colors.white}WEBFLOW TEMPLATE PUBLISH DATE SCRAPER${colors.cyan}              ║
╚══════════════════════════════════════════════════════════════╝${colors.reset}
`);

  console.log(`${colors.dim}Configuration:${colors.reset}`);
  console.log(`  ${colors.blue}•${colors.reset} Concurrency: ${colors.yellow}${CONCURRENCY}${colors.reset} browser pages`);
  console.log(`  ${colors.blue}•${colors.reset} Batch size: ${colors.yellow}${BATCH_SIZE}${colors.reset} templates per DB update`);
  console.log(`  ${colors.blue}•${colors.reset} Dry run: ${DRY_RUN ? colors.yellow + 'YES' : colors.green + 'NO'}${colors.reset}`);
  console.log(`  ${colors.blue}•${colors.reset} Skip existing: ${SKIP_EXISTING ? colors.green + 'YES' : colors.yellow + 'NO'}${colors.reset}`);
  if (LIMIT) console.log(`  ${colors.blue}•${colors.reset} Limit: ${colors.yellow}${LIMIT}${colors.reset} templates`);
  console.log('');
}

function printSummary() {
  const elapsed = Date.now() - state.startTime;
  const rate = state.processed > 0 ? ((state.processed / elapsed) * 1000).toFixed(2) : '0.00';

  console.log(`\n
${colors.bright}${colors.cyan}╔══════════════════════════════════════════════════════════════╗
║                        ${colors.white}SUMMARY${colors.cyan}                                 ║
╚══════════════════════════════════════════════════════════════╝${colors.reset}

  ${colors.green}✓ Successful:${colors.reset}  ${state.successful}
  ${colors.red}✗ Failed:${colors.reset}      ${state.failed}
  ${colors.yellow}○ Skipped:${colors.reset}     ${state.skipped}
  ${colors.blue}━ Total:${colors.reset}       ${state.processed}

  ${colors.cyan}⏱ Duration:${colors.reset}    ${formatDuration(elapsed)}
  ${colors.magenta}⚡ Rate:${colors.reset}        ${rate} templates/second

${state.recentDates.length > 0 ? `  ${colors.dim}Recent dates found:${colors.reset}
${state.recentDates.slice(-5).map((d: string) => `    ${colors.green}•${colors.reset} ${d}`).join('\n')}
` : ''}
`);
}

// Parse date string like "Dec 24, 2025" to ISO date
function parsePublishDate(dateStr: string): string | null {
  if (!dateStr) return null;

  try {
    // Clean up the date string
    const cleaned = dateStr.trim();

    // Parse "Dec 24, 2025" format
    const date = new Date(cleaned);

    if (isNaN(date.getTime())) {
      // Try manual parsing for "Dec 24, 2025" format
      const months: { [key: string]: number } = {
        'jan': 0, 'feb': 1, 'mar': 2, 'apr': 3, 'may': 4, 'jun': 5,
        'jul': 6, 'aug': 7, 'sep': 8, 'oct': 9, 'nov': 10, 'dec': 11
      };

      const match = cleaned.match(/^(\w{3})\s+(\d{1,2}),?\s+(\d{4})$/i);
      if (match) {
        const [, monthStr, day, year] = match;
        const monthNum = months[monthStr.toLowerCase()];
        if (monthNum !== undefined) {
          const parsedDate = new Date(parseInt(year), monthNum, parseInt(day));
          return parsedDate.toISOString().split('T')[0];
        }
      }

      return null;
    }

    return date.toISOString().split('T')[0];
  } catch {
    return null;
  }
}

// Scrape publish date from a template storefront page
async function scrapePublishDate(page: Page, storefrontUrl: string): Promise<string | null> {
  try {
    await page.goto(storefrontUrl, {
      waitUntil: 'domcontentloaded',
      timeout: REQUEST_TIMEOUT,
    });

    // Try multiple selectors to find the publish date
    // The publish date is typically in a specific location on the page
    const dateText = await page.evaluate(() => {
      // Strategy 1: Look for elements with "publish" in class name
      const publishElements = document.querySelectorAll('[class*="publish"]');
      for (const el of publishElements) {
        const text = el.textContent?.trim();
        if (text && /\w{3}\s+\d{1,2},?\s+\d{4}/.test(text)) {
          return text;
        }
      }

      // Strategy 2: Look in the product hero section for date patterns
      const heroSection = document.querySelector('.product-hero, .product-header, .template-hero');
      if (heroSection) {
        // Look for date pattern in any child element
        const allText = heroSection.textContent || '';
        const dateMatch = allText.match(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}\b/i);
        if (dateMatch) {
          return dateMatch[0];
        }
      }

      // Strategy 3: Search all text nodes for date pattern
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_TEXT,
        null
      );

      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent?.trim();
        if (text) {
          const dateMatch = text.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i);
          if (dateMatch) {
            return dateMatch[0];
          }
        }
      }

      // Strategy 4: Look for any element containing just a date
      const allElements = document.querySelectorAll('div, span, p, time');
      for (const el of allElements) {
        // Check direct text content (not including children)
        const directText = Array.from(el.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent?.trim())
          .join(' ')
          .trim();

        const dateMatch = directText.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i);
        if (dateMatch) {
          return dateMatch[0];
        }
      }

      return null;
    });

    if (dateText) {
      return parsePublishDate(dateText);
    }

    return null;
  } catch {
    return null;
  }
}

// Fetch all templates from Supabase with pagination
async function fetchAllTemplates(): Promise<Array<{ id: number; slug: string; storefront_url: string; publish_date: string | null }>> {
  const templates: Array<{ id: number; slug: string; storefront_url: string; publish_date: string | null }> = [];
  let offset = 0;

  console.log(`${colors.blue}Fetching templates from database...${colors.reset}`);

  while (true) {
    let query = supabase
      .from('templates')
      .select('id, slug, storefront_url, publish_date')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (SKIP_EXISTING) {
      query = query.is('publish_date', null);
    }

    const { data, error } = await query;

    if (error) {
      console.error(`${colors.red}Error fetching templates:${colors.reset}`, error.message);
      throw error;
    }

    if (!data || data.length === 0) break;

    templates.push(...data);
    offset += data.length;

    process.stdout.write(`\r  ${colors.dim}Fetched ${templates.length} templates...${colors.reset}`);

    if (data.length < PAGE_SIZE) break;
  }

  console.log(`\r  ${colors.green}✓${colors.reset} Found ${templates.length} templates to process\n`);

  return templates;
}

// Update templates in batches
async function updateTemplatesBatch(
  updates: Array<{ id: number; publish_date: string }>
): Promise<void> {
  if (DRY_RUN || updates.length === 0) return;

  // Update one by one (Supabase doesn't support bulk update with different values)
  for (const update of updates) {
    const { error } = await supabase
      .from('templates')
      .update({ publish_date: update.publish_date })
      .eq('id', update.id);

    if (error) {
      console.error(`\n${colors.red}Error updating template ${update.id}:${colors.reset}`, error.message);
    }
  }
}

// Semaphore for concurrency control
class Semaphore {
  private permits: number;
  private waiting: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits--;
      return;
    }
    return new Promise(resolve => {
      this.waiting.push(resolve);
    });
  }

  release(): void {
    if (this.waiting.length > 0) {
      const next = this.waiting.shift();
      next?.();
    } else {
      this.permits++;
    }
  }
}

// Main scraping function
async function main() {
  printHeader();

  // Fetch templates
  let templates = await fetchAllTemplates();

  if (LIMIT && templates.length > LIMIT) {
    templates = templates.slice(0, LIMIT);
    console.log(`${colors.yellow}Limited to ${LIMIT} templates${colors.reset}\n`);
  }

  if (templates.length === 0) {
    console.log(`${colors.yellow}No templates to process${colors.reset}`);
    return;
  }

  state.total = templates.length;
  state.startTime = Date.now();

  console.log(`${colors.blue}Starting scraper with ${CONCURRENCY} concurrent pages...${colors.reset}\n`);

  // Launch browser
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  const semaphore = new Semaphore(CONCURRENCY);
  const pendingUpdates: Array<{ id: number; publish_date: string }> = [];

  // Progress update interval
  const progressInterval = setInterval(() => {
    renderProgress();
  }, 100);

  // Process templates
  const processTemplate = async (template: typeof templates[0]) => {
    await semaphore.acquire();

    let page: Page | null = null;
    try {
      page = await context.newPage();
      state.currentTemplate = template.slug;

      const publishDate = await scrapePublishDate(page, template.storefront_url);

      if (publishDate) {
        state.successful++;
        pendingUpdates.push({ id: template.id, publish_date: publishDate });
        state.recentDates.push(`${template.slug}: ${publishDate}`);
        if (state.recentDates.length > 10) state.recentDates.shift();

        // Batch update when we have enough
        if (pendingUpdates.length >= BATCH_SIZE) {
          const batch = pendingUpdates.splice(0, BATCH_SIZE);
          await updateTemplatesBatch(batch);
        }
      } else {
        state.skipped++;
      }
    } catch {
      state.failed++;
    } finally {
      state.processed++;
      if (page) {
        try { await page.close(); } catch {}
      }
      semaphore.release();
    }
  };

  // Process all templates concurrently
  await Promise.all(templates.map(t => processTemplate(t)));

  // Update remaining templates
  if (pendingUpdates.length > 0) {
    await updateTemplatesBatch(pendingUpdates);
  }

  // Cleanup
  clearInterval(progressInterval);
  await context.close();
  await browser.close();

  // Final progress and summary
  clearLine();
  renderProgress();
  printSummary();
}

// Run
main().catch(error => {
  console.error(`\n${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
