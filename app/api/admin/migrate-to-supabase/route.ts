import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { supabase, logActivity } from '@/lib/supabase';

// Verify admin access
function verifyAdmin(request: NextRequest): boolean {
  const password = request.headers.get('x-admin-password');
  return password === process.env.ADMIN_PASSWORD;
}

export async function GET(request: NextRequest) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get migration status
  try {
    const [sqliteStats, supabaseStats] = await Promise.all([
      db.getStats(),
      getSupabaseStats(),
    ]);

    return NextResponse.json({
      sqlite: sqliteStats,
      supabase: supabaseStats,
      migrationNeeded: sqliteStats.templates > 0 && supabaseStats.templates === 0,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
}

async function getSupabaseStats() {
  const [templates, subcategories, styles, features, authors] = await Promise.all([
    supabase.from('templates').select('*', { count: 'exact', head: true }),
    supabase.from('subcategories').select('*', { count: 'exact', head: true }),
    supabase.from('styles').select('*', { count: 'exact', head: true }),
    supabase.from('features').select('*', { count: 'exact', head: true }),
    supabase.from('featured_authors').select('*', { count: 'exact', head: true }),
  ]);

  return {
    templates: templates.count || 0,
    subcategories: subcategories.count || 0,
    styles: styles.count || 0,
    features: features.count || 0,
    featuredAuthors: authors.count || 0,
  };
}

export async function POST(request: NextRequest) {
  if (!verifyAdmin(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startTime = Date.now();
  const results: Record<string, { success: number; failed: number; total: number }> = {};

  try {
    // 1. Migrate subcategories
    console.log('Migrating subcategories...');
    const subcategories = await db.allAsync<{
      id: number;
      name: string;
      slug: string;
      display_name: string;
    }>('SELECT * FROM subcategories');

    results.subcategories = { success: 0, failed: 0, total: subcategories.length };

    for (const sub of subcategories) {
      const { error } = await supabase.from('subcategories').upsert({
        id: sub.id,
        name: sub.name,
        slug: sub.slug,
        display_name: sub.display_name,
      }, { onConflict: 'slug' });

      if (error) {
        results.subcategories.failed++;
        console.error('Subcategory error:', error);
      } else {
        results.subcategories.success++;
      }
    }

    // 2. Migrate styles
    console.log('Migrating styles...');
    const styles = await db.allAsync<{
      id: number;
      name: string;
      slug: string;
      display_name: string;
    }>('SELECT * FROM styles');

    results.styles = { success: 0, failed: 0, total: styles.length };

    for (const style of styles) {
      const { error } = await supabase.from('styles').upsert({
        id: style.id,
        name: style.name,
        slug: style.slug,
        display_name: style.display_name,
      }, { onConflict: 'slug' });

      if (error) {
        results.styles.failed++;
        console.error('Style error:', error);
      } else {
        results.styles.success++;
      }
    }

    // 3. Migrate features
    console.log('Migrating features...');
    const features = await db.allAsync<{
      id: number;
      name: string;
      slug: string;
      display_name: string;
      description?: string;
      icon_type?: string;
    }>('SELECT * FROM features');

    results.features = { success: 0, failed: 0, total: features.length };

    for (const feature of features) {
      const { error } = await supabase.from('features').upsert({
        id: feature.id,
        name: feature.name,
        slug: feature.slug,
        display_name: feature.display_name,
        description: feature.description || null,
        icon_type: feature.icon_type || null,
      }, { onConflict: 'slug' });

      if (error) {
        results.features.failed++;
        console.error('Feature error:', error);
      } else {
        results.features.success++;
      }
    }

    // 4. Migrate featured authors
    console.log('Migrating featured authors...');
    const featuredAuthors = await db.allAsync<{
      id: number;
      author_id: string;
      author_name: string;
      is_active: boolean;
    }>('SELECT * FROM featured_authors');

    results.featuredAuthors = { success: 0, failed: 0, total: featuredAuthors.length };

    for (const author of featuredAuthors) {
      const { error } = await supabase.from('featured_authors').upsert({
        id: author.id,
        author_id: author.author_id,
        author_name: author.author_name,
        is_active: author.is_active,
      }, { onConflict: 'author_id' });

      if (error) {
        results.featuredAuthors.failed++;
        console.error('Featured author error:', error);
      } else {
        results.featuredAuthors.success++;
      }
    }

    // 5. Migrate templates in batches
    console.log('Migrating templates...');
    const templates = await db.allAsync<{
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
      is_featured: boolean;
      is_cms: boolean;
      is_ecommerce: boolean;
      screenshot_url: string | null;
      is_alternate_homepage: boolean;
      alternate_homepage_path: string | null;
      scraped_at: string | null;
      updated_at: string | null;
      created_at: string | null;
    }>('SELECT * FROM templates');

    results.templates = { success: 0, failed: 0, total: templates.length };

    // Batch insert templates
    const batchSize = 100;
    for (let i = 0; i < templates.length; i += batchSize) {
      const batch = templates.slice(i, i + batchSize);
      const templatesData = batch.map(t => ({
        id: t.id,
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
        scraped_at: t.scraped_at || new Date().toISOString(),
        updated_at: t.updated_at || new Date().toISOString(),
        created_at: t.created_at || new Date().toISOString(),
      }));

      const { error } = await supabase.from('templates').upsert(templatesData, { onConflict: 'template_id' });

      if (error) {
        results.templates.failed += batch.length;
        console.error('Template batch error:', error);
      } else {
        results.templates.success += batch.length;
      }

      console.log(`Migrated templates: ${Math.min(i + batchSize, templates.length)}/${templates.length}`);
    }

    // 6. Migrate template_subcategories junction
    console.log('Migrating template_subcategories...');
    const templateSubcategories = await db.allAsync<{
      template_id: number;
      subcategory_id: number;
    }>('SELECT * FROM template_subcategories');

    results.templateSubcategories = { success: 0, failed: 0, total: templateSubcategories.length };

    for (let i = 0; i < templateSubcategories.length; i += batchSize) {
      const batch = templateSubcategories.slice(i, i + batchSize);
      const { error } = await supabase.from('template_subcategories').upsert(batch);

      if (error) {
        results.templateSubcategories.failed += batch.length;
      } else {
        results.templateSubcategories.success += batch.length;
      }
    }

    // 7. Migrate template_styles junction
    console.log('Migrating template_styles...');
    const templateStyles = await db.allAsync<{
      template_id: number;
      style_id: number;
    }>('SELECT * FROM template_styles');

    results.templateStyles = { success: 0, failed: 0, total: templateStyles.length };

    for (let i = 0; i < templateStyles.length; i += batchSize) {
      const batch = templateStyles.slice(i, i + batchSize);
      const { error } = await supabase.from('template_styles').upsert(batch);

      if (error) {
        results.templateStyles.failed += batch.length;
      } else {
        results.templateStyles.success += batch.length;
      }
    }

    // 8. Migrate template_features junction
    console.log('Migrating template_features...');
    const templateFeatures = await db.allAsync<{
      template_id: number;
      feature_id: number;
    }>('SELECT * FROM template_features');

    results.templateFeatures = { success: 0, failed: 0, total: templateFeatures.length };

    for (let i = 0; i < templateFeatures.length; i += batchSize) {
      const batch = templateFeatures.slice(i, i + batchSize);
      const { error } = await supabase.from('template_features').upsert(batch);

      if (error) {
        results.templateFeatures.failed += batch.length;
      } else {
        results.templateFeatures.success += batch.length;
      }
    }

    // 9. Migrate ultra_featured_templates
    console.log('Migrating ultra_featured_templates...');
    const ultraFeatured = await db.allAsync<{
      id: number;
      template_id: number;
      position: number;
    }>('SELECT * FROM ultra_featured_templates');

    results.ultraFeaturedTemplates = { success: 0, failed: 0, total: ultraFeatured.length };

    for (const uf of ultraFeatured) {
      const { error } = await supabase.from('ultra_featured_templates').upsert({
        id: uf.id,
        template_id: uf.template_id,
        position: uf.position,
      });

      if (error) {
        results.ultraFeaturedTemplates.failed++;
      } else {
        results.ultraFeaturedTemplates.success++;
      }
    }

    // 10. Migrate template_blacklist
    console.log('Migrating template_blacklist...');
    const blacklist = await db.allAsync<{
      id: number;
      domain_slug: string;
      storefront_url: string | null;
      reason: string;
    }>('SELECT * FROM template_blacklist');

    results.blacklist = { success: 0, failed: 0, total: blacklist.length };

    for (const bl of blacklist) {
      const { error } = await supabase.from('template_blacklist').upsert({
        id: bl.id,
        domain_slug: bl.domain_slug,
        storefront_url: bl.storefront_url,
        reason: bl.reason,
      }, { onConflict: 'domain_slug' });

      if (error) {
        results.blacklist.failed++;
      } else {
        results.blacklist.success++;
      }
    }

    // 11. Migrate screenshot_exclusions
    console.log('Migrating screenshot_exclusions...');
    const exclusions = await db.allAsync<{
      id: number;
      selector: string;
      selector_type: string;
      description: string | null;
      is_active: boolean;
    }>('SELECT * FROM screenshot_exclusions');

    results.screenshotExclusions = { success: 0, failed: 0, total: exclusions.length };

    for (const exc of exclusions) {
      const { error } = await supabase.from('screenshot_exclusions').upsert({
        id: exc.id,
        selector: exc.selector,
        selector_type: exc.selector_type,
        description: exc.description,
        is_active: exc.is_active,
      }, { onConflict: 'selector' });

      if (error) {
        results.screenshotExclusions.failed++;
      } else {
        results.screenshotExclusions.success++;
      }
    }

    const duration = Date.now() - startTime;

    // Log migration activity
    await logActivity(
      'migration',
      'all_tables',
      Object.values(results).reduce((acc, r) => acc + r.total, 0),
      results,
      true,
      undefined,
      duration
    );

    return NextResponse.json({
      success: true,
      duration: `${(duration / 1000).toFixed(2)}s`,
      results,
    });
  } catch (error) {
    console.error('Migration error:', error);

    await logActivity(
      'migration',
      'all_tables',
      0,
      { error: error instanceof Error ? error.message : 'Unknown error' },
      false,
      error instanceof Error ? error.message : 'Unknown error'
    );

    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unknown error',
      results,
    }, { status: 500 });
  }
}
