/**
 * Migration script: VPS Screenshots → Cloudflare R2
 *
 * This script:
 * 1. Connects to VPS via SSH and lists all screenshots
 * 2. Downloads each screenshot and uploads to R2
 * 3. Updates Supabase template records with new R2 URLs
 *
 * Usage:
 *   npx ts-node scripts/migrate-screenshots-to-r2.ts
 *
 * Or with options:
 *   npx ts-node scripts/migrate-screenshots-to-r2.ts --dry-run
 *   npx ts-node scripts/migrate-screenshots-to-r2.ts --batch-size=50
 *   npx ts-node scripts/migrate-screenshots-to-r2.ts --start-from=500
 */

// Load .env.local
import * as fs from 'fs';
import * as path from 'path';
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex > 0) {
        const key = trimmed.substring(0, eqIndex);
        const value = trimmed.substring(eqIndex + 1);
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';
import { execSync, spawn } from 'child_process';

// Configuration
const VPS_HOST = 'root@178.156.177.252';
const VPS_SCREENSHOT_DIR = '/data/webflow-gallery/screenshots';

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || 'abb44d09f99ddaac0b1e25c92d25ca28';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || 'a96502788d071d64f3b3a0098f2b2b7d';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '4d12eb1aacdc4e4e62e6b4a42f5900a5dbd34e6b669fe08128ebcc1d6b56de3a';
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'webflow-screenshots';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || 'https://screenshots.luminardigital.com';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://evybpccbfjxzvqfqukop.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Parse CLI args
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const BATCH_SIZE = parseInt(args.find(a => a.startsWith('--batch-size='))?.split('=')[1] || '20', 10);
const START_FROM = parseInt(args.find(a => a.startsWith('--start-from='))?.split('=')[1] || '0', 10);
const CONCURRENCY = parseInt(args.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5', 10);

// Initialize clients
const s3Client = new S3Client({
  region: 'auto',
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Stats
let totalFiles = 0;
let uploaded = 0;
let skipped = 0;
let failed = 0;
let dbUpdated = 0;

async function checkR2Exists(key: string): Promise<boolean> {
  try {
    await s3Client.send(new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToR2(key: string, buffer: Buffer): Promise<void> {
  await s3Client.send(new PutObjectCommand({
    Bucket: R2_BUCKET_NAME,
    Key: key,
    Body: buffer,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000',
  }));
}

function downloadFromVPS(filename: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const remotePath = `${VPS_SCREENSHOT_DIR}/${filename}`;
    const chunks: Buffer[] = [];

    const scp = spawn('ssh', [
      '-o', 'StrictHostKeyChecking=no',
      '-o', 'ConnectTimeout=10',
      VPS_HOST,
      `cat "${remotePath}"`
    ]);

    scp.stdout.on('data', (chunk) => chunks.push(chunk));
    scp.stderr.on('data', (data) => {
      // Ignore non-critical stderr
      const msg = data.toString();
      if (!msg.includes('Warning') && !msg.includes('Permanently added')) {
        console.error(`  stderr: ${msg}`);
      }
    });

    scp.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`SSH cat failed with code ${code}`));
      }
    });

    scp.on('error', reject);
  });
}

async function getVPSScreenshotList(): Promise<string[]> {
  console.log('📋 Fetching screenshot list from VPS...');
  const result = execSync(
    `ssh -o StrictHostKeyChecking=no ${VPS_HOST} "ls ${VPS_SCREENSHOT_DIR}/*.webp 2>/dev/null | xargs -n1 basename"`,
    { maxBuffer: 50 * 1024 * 1024 }
  ).toString().trim();

  const files = result.split('\n').filter(f => f.endsWith('.webp'));
  console.log(`   Found ${files.length} screenshots on VPS`);
  return files;
}

async function migrateScreenshot(filename: string): Promise<boolean> {
  const slug = filename.replace('.webp', '');
  const r2Key = filename;
  const r2Url = `${R2_PUBLIC_URL}/${filename}`;

  try {
    // Check if already in R2
    const exists = await checkR2Exists(r2Key);
    if (exists) {
      skipped++;
      return true; // Already migrated
    }

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would upload: ${filename}`);
      return true;
    }

    // Download from VPS
    const buffer = await downloadFromVPS(filename);
    if (buffer.length < 1000) {
      console.log(`  ⚠️  Skipping ${filename} - too small (${buffer.length} bytes)`);
      skipped++;
      return false;
    }

    // Upload to R2
    await uploadToR2(r2Key, buffer);
    uploaded++;

    return true;
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`  ❌ Failed ${filename}: ${msg}`);
    failed++;
    return false;
  }
}

async function updateDatabaseRecords(): Promise<void> {
  console.log('\n📝 Updating database records...');

  if (DRY_RUN) {
    console.log('  [DRY RUN] Would update screenshot_path for all templates');
    return;
  }

  // Get all templates with old-style paths
  const { data: templates, error } = await supabase
    .from('templates')
    .select('id, slug, screenshot_path')
    .not('screenshot_path', 'is', null)
    .not('screenshot_path', 'like', 'https://%');

  if (error) {
    console.error('  Failed to fetch templates:', error.message);
    return;
  }

  console.log(`  Found ${templates?.length || 0} templates with legacy paths`);

  // Update in batches
  const batchSize = 100;
  for (let i = 0; i < (templates?.length || 0); i += batchSize) {
    const batch = templates!.slice(i, i + batchSize);

    for (const template of batch) {
      // Convert /screenshots/slug.webp to full R2 URL
      const filename = template.screenshot_path.replace('/screenshots/', '').replace('screenshots/', '');
      const newPath = `${R2_PUBLIC_URL}/${filename}`;

      const { error: updateError } = await supabase
        .from('templates')
        .update({ screenshot_path: newPath })
        .eq('id', template.id);

      if (updateError) {
        console.error(`  Failed to update template ${template.slug}: ${updateError.message}`);
      } else {
        dbUpdated++;
      }
    }

    process.stdout.write(`\r  Updated ${Math.min(i + batchSize, templates!.length)}/${templates!.length} records`);
  }

  console.log(`\n  ✅ Updated ${dbUpdated} database records`);
}

async function runMigration(): Promise<void> {
  console.log('🚀 VPS → R2 Screenshot Migration');
  console.log('================================');
  console.log(`   Dry run: ${DRY_RUN}`);
  console.log(`   Batch size: ${BATCH_SIZE}`);
  console.log(`   Concurrency: ${CONCURRENCY}`);
  console.log(`   Start from: ${START_FROM}`);
  console.log(`   R2 bucket: ${R2_BUCKET_NAME}`);
  console.log(`   R2 public URL: ${R2_PUBLIC_URL}`);
  console.log('');

  // Get list of screenshots
  const files = await getVPSScreenshotList();
  totalFiles = files.length;

  // Apply start offset
  const filesToProcess = files.slice(START_FROM);
  console.log(`\n📤 Migrating ${filesToProcess.length} screenshots (starting from index ${START_FROM})...\n`);

  // Process in batches with concurrency
  for (let i = 0; i < filesToProcess.length; i += BATCH_SIZE) {
    const batch = filesToProcess.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(filesToProcess.length / BATCH_SIZE);

    console.log(`Batch ${batchNum}/${totalBatches} (files ${START_FROM + i + 1}-${START_FROM + i + batch.length}):`);

    // Process batch with concurrency limit
    const promises: Promise<boolean>[] = [];
    for (const file of batch) {
      if (promises.length >= CONCURRENCY) {
        await Promise.race(promises);
        // Remove completed promises
        const results = await Promise.allSettled(promises);
        promises.length = 0;
      }
      promises.push(migrateScreenshot(file));
    }

    // Wait for remaining
    await Promise.all(promises);

    // Progress update
    const progress = ((i + batch.length) / filesToProcess.length * 100).toFixed(1);
    console.log(`  Progress: ${progress}% | Uploaded: ${uploaded} | Skipped: ${skipped} | Failed: ${failed}\n`);
  }

  // Update database
  await updateDatabaseRecords();

  // Final summary
  console.log('\n================================');
  console.log('📊 Migration Summary');
  console.log('================================');
  console.log(`   Total files on VPS: ${totalFiles}`);
  console.log(`   Uploaded to R2: ${uploaded}`);
  console.log(`   Already existed (skipped): ${skipped}`);
  console.log(`   Failed: ${failed}`);
  console.log(`   Database records updated: ${dbUpdated}`);
  console.log('================================');
}

// Run
runMigration().catch(console.error);
