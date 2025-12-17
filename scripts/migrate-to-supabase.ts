/**
 * Migration script to transfer data from SQLite to Supabase
 * Run with: npx tsx scripts/migrate-to-supabase.ts
 */

import sqlite3 from 'sqlite3';
import { createClient } from '@supabase/supabase-js';

const DATABASE_PATH = process.env.DATABASE_PATH || './data/webflow.db';
const SUPABASE_URL = 'https://evybpccbfjxzvqfqukop.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2eWJwY2NiZmp4enZxZnF1a29wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMTA1MTcsImV4cCI6MjA4MTU4NjUxN30.8qFbXe8Mh_eVsUpfzNihYuH1kbJBI5kldf7uAzqMzjM';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Helper to promisify SQLite
function query<T>(db: sqlite3.Database, sql: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all(sql, (err, rows) => {
      if (err) reject(err);
      else resolve(rows as T[]);
    });
  });
}

async function migrate() {
  console.log('Starting migration from SQLite to Supabase...\n');
  const startTime = Date.now();

  // Open SQLite database
  const db = new sqlite3.Database(DATABASE_PATH);

  try {
    // 1. Migrate subcategories
    console.log('1. Migrating subcategories...');
    const subcategories = await query<{
      id: number;
      name: string;
      slug: string;
      display_name: string;
    }>(db, 'SELECT * FROM subcategories');

    if (subcategories.length > 0) {
      const { error } = await supabase.from('subcategories').upsert(
        subcategories.map(s => ({
          name: s.name,
          slug: s.slug,
          display_name: s.display_name,
        })),
        { onConflict: 'slug' }
      );
      if (error) console.error('  Error:', error.message);
      else console.log(`  Migrated ${subcategories.length} subcategories`);
    }

    // 2. Migrate styles
    console.log('\n2. Migrating styles...');
    const styles = await query<{
      id: number;
      name: string;
      slug: string;
      display_name: string;
    }>(db, 'SELECT * FROM styles');

    if (styles.length > 0) {
      const { error } = await supabase.from('styles').upsert(
        styles.map(s => ({
          name: s.name,
          slug: s.slug,
          display_name: s.display_name,
        })),
        { onConflict: 'slug' }
      );
      if (error) console.error('  Error:', error.message);
      else console.log(`  Migrated ${styles.length} styles`);
    }

    // 3. Migrate features
    console.log('\n3. Migrating features...');
    const features = await query<{
      id: number;
      name: string;
      slug: string;
      display_name: string;
      description: string | null;
      icon_type: string | null;
    }>(db, 'SELECT * FROM features');

    if (features.length > 0) {
      const { error } = await supabase.from('features').upsert(
        features.map(f => ({
          name: f.name,
          slug: f.slug,
          display_name: f.display_name,
          description: f.description,
          icon_type: f.icon_type,
        })),
        { onConflict: 'slug' }
      );
      if (error) console.error('  Error:', error.message);
      else console.log(`  Migrated ${features.length} features`);
    }

    // 4. Migrate featured authors
    console.log('\n4. Migrating featured authors...');
    const featuredAuthors = await query<{
      id: number;
      author_id: string;
      author_name: string;
      is_active: number;
    }>(db, 'SELECT * FROM featured_authors');

    if (featuredAuthors.length > 0) {
      const { error } = await supabase.from('featured_authors').upsert(
        featuredAuthors.map(a => ({
          author_id: a.author_id,
          author_name: a.author_name,
          is_active: !!a.is_active,
        })),
        { onConflict: 'author_id' }
      );
      if (error) console.error('  Error:', error.message);
      else console.log(`  Migrated ${featuredAuthors.length} featured authors`);
    }

    // 5. Migrate templates in batches
    console.log('\n5. Migrating templates...');
    const templates = await query<{
      id: number;
      template_id: string;
      name: string;
      slug: string;
      author_name: string | null;
      author_id: string | null;
      author_avatar: string | null;
      storefront_url: string;
      live_preview_url: string;
      designer_preview_url: string | null;
      price: string | null;
      short_description: string | null;
      long_description: string | null;
      screenshot_path: string | null;
      screenshot_thumbnail_path: string | null;
      is_featured: number;
      is_cms: number;
      is_ecommerce: number;
      screenshot_url: string | null;
      is_alternate_homepage: number;
      alternate_homepage_path: string | null;
      scraped_at: string | null;
      updated_at: string | null;
      created_at: string | null;
    }>(db, 'SELECT * FROM templates');

    console.log(`  Found ${templates.length} templates to migrate`);

    const batchSize = 100;
    let success = 0;
    let failed = 0;

    for (let i = 0; i < templates.length; i += batchSize) {
      const batch = templates.slice(i, i + batchSize);
      const templateData = batch.map(t => ({
        template_id: t.template_id,
        name: t.name,
        slug: t.slug,
        author_name: t.author_name,
        author_id: t.author_id,
        author_avatar: t.author_avatar,
        storefront_url: t.storefront_url,
        live_preview_url: t.live_preview_url,
        designer_preview_url: t.designer_preview_url,
        price: t.price,
        short_description: t.short_description,
        long_description: t.long_description,
        screenshot_path: t.screenshot_path,
        screenshot_thumbnail_path: t.screenshot_thumbnail_path,
        is_featured: !!t.is_featured,
        is_cms: !!t.is_cms,
        is_ecommerce: !!t.is_ecommerce,
        screenshot_url: t.screenshot_url,
        is_alternate_homepage: !!t.is_alternate_homepage,
        alternate_homepage_path: t.alternate_homepage_path,
      }));

      const { error } = await supabase.from('templates').upsert(templateData, { onConflict: 'template_id' });

      if (error) {
        console.error(`  Batch error at ${i}:`, error.message);
        failed += batch.length;
      } else {
        success += batch.length;
      }

      process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, templates.length)}/${templates.length} (${success} success, ${failed} failed)`);
    }
    console.log('\n');

    // 6. Get ID mappings for junction tables
    console.log('6. Building ID mappings...');

    // Get new IDs from Supabase
    const { data: newSubcats } = await supabase.from('subcategories').select('id, slug');
    const { data: newStyles } = await supabase.from('styles').select('id, slug');
    const { data: newFeatures } = await supabase.from('features').select('id, slug');
    const { data: newTemplates } = await supabase.from('templates').select('id, template_id');

    // Build mappings: old slug -> new id
    const subcatMap = new Map(subcategories.map(s => [s.id, newSubcats?.find(ns => ns.slug === s.slug)?.id]));
    const styleMap = new Map(styles.map(s => [s.id, newStyles?.find(ns => ns.slug === s.slug)?.id]));
    const featureMap = new Map(features.map(f => [f.id, newFeatures?.find(nf => nf.slug === f.slug)?.id]));
    const templateMap = new Map(templates.map(t => [t.id, newTemplates?.find(nt => nt.template_id === t.template_id)?.id]));

    // 7. Migrate template_subcategories
    console.log('\n7. Migrating template_subcategories...');
    const templateSubcategories = await query<{
      template_id: number;
      subcategory_id: number;
    }>(db, 'SELECT * FROM template_subcategories');

    if (templateSubcategories.length > 0) {
      const mapped = templateSubcategories
        .map(ts => ({
          template_id: templateMap.get(ts.template_id),
          subcategory_id: subcatMap.get(ts.subcategory_id),
        }))
        .filter(ts => ts.template_id && ts.subcategory_id);

      for (let i = 0; i < mapped.length; i += batchSize) {
        const batch = mapped.slice(i, i + batchSize);
        await supabase.from('template_subcategories').upsert(batch as { template_id: number; subcategory_id: number }[]);
        process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, mapped.length)}/${mapped.length}`);
      }
      console.log(`\n  Migrated ${mapped.length} template_subcategories`);
    }

    // 8. Migrate template_styles
    console.log('\n8. Migrating template_styles...');
    const templateStyles = await query<{
      template_id: number;
      style_id: number;
    }>(db, 'SELECT * FROM template_styles');

    if (templateStyles.length > 0) {
      const mapped = templateStyles
        .map(ts => ({
          template_id: templateMap.get(ts.template_id),
          style_id: styleMap.get(ts.style_id),
        }))
        .filter(ts => ts.template_id && ts.style_id);

      for (let i = 0; i < mapped.length; i += batchSize) {
        const batch = mapped.slice(i, i + batchSize);
        await supabase.from('template_styles').upsert(batch as { template_id: number; style_id: number }[]);
        process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, mapped.length)}/${mapped.length}`);
      }
      console.log(`\n  Migrated ${mapped.length} template_styles`);
    }

    // 9. Migrate template_features
    console.log('\n9. Migrating template_features...');
    const templateFeatures = await query<{
      template_id: number;
      feature_id: number;
    }>(db, 'SELECT * FROM template_features');

    if (templateFeatures.length > 0) {
      const mapped = templateFeatures
        .map(tf => ({
          template_id: templateMap.get(tf.template_id),
          feature_id: featureMap.get(tf.feature_id),
        }))
        .filter(tf => tf.template_id && tf.feature_id);

      for (let i = 0; i < mapped.length; i += batchSize) {
        const batch = mapped.slice(i, i + batchSize);
        await supabase.from('template_features').upsert(batch as { template_id: number; feature_id: number }[]);
        process.stdout.write(`\r  Progress: ${Math.min(i + batchSize, mapped.length)}/${mapped.length}`);
      }
      console.log(`\n  Migrated ${mapped.length} template_features`);
    }

    // 10. Migrate ultra_featured_templates
    console.log('\n10. Migrating ultra_featured_templates...');
    const ultraFeatured = await query<{
      id: number;
      template_id: number;
      position: number;
    }>(db, 'SELECT * FROM ultra_featured_templates');

    if (ultraFeatured.length > 0) {
      const mapped = ultraFeatured
        .map(uf => ({
          template_id: templateMap.get(uf.template_id),
          position: uf.position,
        }))
        .filter(uf => uf.template_id);

      const { error } = await supabase.from('ultra_featured_templates').upsert(mapped as { template_id: number; position: number }[]);
      if (error) console.error('  Error:', error.message);
      else console.log(`  Migrated ${mapped.length} ultra_featured_templates`);
    }

    // 11. Migrate blacklist
    console.log('\n11. Migrating template_blacklist...');
    const blacklist = await query<{
      id: number;
      domain_slug: string;
      storefront_url: string | null;
      reason: string;
    }>(db, 'SELECT * FROM template_blacklist');

    if (blacklist.length > 0) {
      const { error } = await supabase.from('template_blacklist').upsert(
        blacklist.map(b => ({
          domain_slug: b.domain_slug,
          storefront_url: b.storefront_url,
          reason: b.reason,
        })),
        { onConflict: 'domain_slug' }
      );
      if (error) console.error('  Error:', error.message);
      else console.log(`  Migrated ${blacklist.length} blacklist entries`);
    }

    // 12. Migrate screenshot_exclusions
    console.log('\n12. Migrating screenshot_exclusions...');
    const exclusions = await query<{
      id: number;
      selector: string;
      selector_type: string;
      description: string | null;
      is_active: number;
    }>(db, 'SELECT * FROM screenshot_exclusions');

    if (exclusions.length > 0) {
      const { error } = await supabase.from('screenshot_exclusions').upsert(
        exclusions.map(e => ({
          selector: e.selector,
          selector_type: e.selector_type,
          description: e.description,
          is_active: !!e.is_active,
        })),
        { onConflict: 'selector' }
      );
      if (error) console.error('  Error:', error.message);
      else console.log(`  Migrated ${exclusions.length} screenshot_exclusions`);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Migration completed in ${duration}s`);

    // Verify final counts
    console.log('\nVerifying migration:');
    const { count: templateCount } = await supabase.from('templates').select('*', { count: 'exact', head: true });
    const { count: subcatCount } = await supabase.from('subcategories').select('*', { count: 'exact', head: true });
    const { count: styleCount } = await supabase.from('styles').select('*', { count: 'exact', head: true });

    console.log(`  Templates: ${templateCount} (SQLite: ${templates.length})`);
    console.log(`  Subcategories: ${subcatCount} (SQLite: ${subcategories.length})`);
    console.log(`  Styles: ${styleCount} (SQLite: ${styles.length})`);

  } catch (error) {
    console.error('Migration failed:', error);
  } finally {
    db.close();
  }
}

migrate();
