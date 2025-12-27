/**
 * Monitor Publish Date Scraper Progress
 *
 * Run this in a separate terminal to watch the scraper's progress:
 *   npx tsx scripts/monitor-publish-dates.ts
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Load environment variables
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
    } catch {}
  }
}

loadEnv();

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

interface Stats {
  total: number;
  withDate: number;
  withoutDate: number;
  percentage: number;
}

let startTime = Date.now();
let initialWithDate = 0;
let lastWithDate = 0;
let rateHistory: number[] = [];

async function getStats(): Promise<Stats> {
  const [totalRes, withDateRes] = await Promise.all([
    supabase.from('templates').select('*', { count: 'exact', head: true }),
    supabase.from('templates').select('*', { count: 'exact', head: true }).not('publish_date', 'is', null),
  ]);

  const total = totalRes.count || 0;
  const withDate = withDateRes.count || 0;

  return {
    total,
    withDate,
    withoutDate: total - withDate,
    percentage: total > 0 ? (withDate / total) * 100 : 0,
  };
}

function createProgressBar(pct: number, width: number = 50): string {
  const filled = Math.round((pct / 100) * width);
  const empty = width - filled;
  return `${c.green}${'█'.repeat(filled)}${c.dim}${'░'.repeat(empty)}${c.reset}`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function clearScreen() {
  console.clear();
}

async function render() {
  const stats = await getStats();

  // Track rate
  const processed = stats.withDate - initialWithDate;
  const elapsed = Date.now() - startTime;
  const currentRate = elapsed > 0 ? (processed / elapsed) * 1000 : 0;

  // Calculate instantaneous rate
  const instantRate = stats.withDate - lastWithDate;
  rateHistory.push(instantRate);
  if (rateHistory.length > 12) rateHistory.shift(); // Keep last 12 samples (1 minute at 5s intervals)
  const avgRate = rateHistory.reduce((a, b) => a + b, 0) / rateHistory.length;
  lastWithDate = stats.withDate;

  // ETA calculation
  const remaining = stats.withoutDate;
  const etaMs = avgRate > 0 ? (remaining / avgRate) * 5000 : 0; // avgRate is per 5s interval

  clearScreen();

  console.log(`
${c.bright}${c.cyan}╔════════════════════════════════════════════════════════════════╗
║         ${c.white}📊 PUBLISH DATE SCRAPER - LIVE MONITOR${c.cyan}                 ║
╚════════════════════════════════════════════════════════════════╝${c.reset}

  ${createProgressBar(stats.percentage)} ${c.bright}${stats.percentage.toFixed(1)}%${c.reset}

  ${c.green}✅ Completed:${c.reset}    ${stats.withDate.toLocaleString()} templates
  ${c.yellow}⏳ Remaining:${c.reset}    ${stats.withoutDate.toLocaleString()} templates
  ${c.blue}📦 Total:${c.reset}        ${stats.total.toLocaleString()} templates

  ${c.cyan}⏱  Monitoring:${c.reset}   ${formatDuration(elapsed)}
  ${c.magenta}⚡ Rate:${c.reset}         ${currentRate.toFixed(2)}/s (avg: ${(avgRate / 5).toFixed(2)}/s)
  ${c.white}🏁 ETA:${c.reset}          ${etaMs > 0 ? formatDuration(etaMs) : 'calculating...'}

${c.dim}  Press Ctrl+C to stop monitoring (won't stop the scraper)${c.reset}
${c.dim}  Refreshing every 5 seconds...${c.reset}
`);
}

async function main() {
  // Get initial stats
  const initial = await getStats();
  initialWithDate = initial.withDate;
  lastWithDate = initial.withDate;
  startTime = Date.now();

  // Initial render
  await render();

  // Update every 5 seconds
  setInterval(render, 5000);
}

main().catch(console.error);
