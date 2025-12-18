// Supabase Database Module
// This module provides the database interface for the Webflow Gallery application
// Backed by Supabase (Postgres)

import {
  supabase,
  supabaseAdmin,
  checkConnection,
  getConnectionStatus,
  connectionQueue,
  executeWithRetry,
  logActivity,
  getSupabaseConfig,
} from './client';

import type {
  Template,
  TemplateInsert,
  TemplateUpdate,
  TemplateWithMetadata,
  Subcategory,
  Style,
  Feature,
  FeaturedAuthor,
  ScrapeJob,
  ScrapeSession,
  ScrapeBatch,
  BatchTemplate,
  FreshScrapeState,
  Visitor,
  Purchase,
  ScreenshotExclusion,
  ScrapeSessionConfig,
  ScrapeSessionType,
  ScrapeSessionStatus,
  BatchStatus,
  BatchTemplateStatus,
  BlacklistReason,
  AlternateHomepageMetrics,
} from './types';

// Re-export client utilities
export {
  supabase,
  supabaseAdmin,
  checkConnection,
  getConnectionStatus,
  connectionQueue,
  executeWithRetry,
  logActivity,
  getSupabaseConfig,
};

// Re-export types
export type {
  Template,
  TemplateInsert,
  TemplateUpdate,
  TemplateWithMetadata,
  Subcategory,
  Style,
  Feature,
  FeaturedAuthor,
  ScrapeJob,
  ScrapeSession,
  ScrapeBatch,
  BatchTemplate,
  FreshScrapeState,
  Visitor,
  Purchase,
  ScreenshotExclusion,
  ScrapeSessionConfig,
  ScrapeSessionType,
  ScrapeSessionStatus,
  BatchStatus,
  BatchTemplateStatus,
  BlacklistReason,
  AlternateHomepageMetrics,
};

// ============================================
// TEMPLATE OPERATIONS
// ============================================

/**
 * Get all templates with optional filtering and pagination
 */
export async function getTemplates(options: {
  subcategory?: string;
  style?: string;
  author?: string;
  featured?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'created_at' | 'updated_at' | 'name';
  sortOrder?: 'asc' | 'desc';
} = {}): Promise<TemplateWithMetadata[]> {
  const {
    subcategory,
    style,
    author,
    featured,
    search,
    limit = 50,
    offset = 0,
    sortBy = 'created_at',
    sortOrder = 'desc',
  } = options;

  let query = supabase.from('templates').select('*');

  // Apply filters
  if (featured !== undefined) {
    query = query.eq('is_featured', featured);
  }
  if (author) {
    query = query.eq('author_id', author);
  }
  if (search) {
    query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
  }

  // Apply sorting and pagination
  query = query
    .order(sortBy, { ascending: sortOrder === 'asc' })
    .range(offset, offset + limit - 1);

  const { data: templates, error } = await query;

  if (error) {
    console.error('Error fetching templates:', error);
    throw error;
  }

  // If filtering by subcategory or style, we need to join
  let filteredTemplates = templates || [];

  if (subcategory) {
    const { data: subcatTemplates } = await supabase
      .from('template_subcategories')
      .select('template_id, subcategories!inner(slug)')
      .eq('subcategories.slug', subcategory);

    const templateIds = new Set(subcatTemplates?.map(t => t.template_id) || []);
    filteredTemplates = filteredTemplates.filter(t => templateIds.has(t.id));
  }

  if (style) {
    const { data: styleTemplates } = await supabase
      .from('template_styles')
      .select('template_id, styles!inner(slug)')
      .eq('styles.slug', style);

    const templateIds = new Set(styleTemplates?.map(t => t.template_id) || []);
    filteredTemplates = filteredTemplates.filter(t => templateIds.has(t.id));
  }

  // Fetch metadata for all templates
  const templatesWithMetadata = await Promise.all(
    filteredTemplates.map(async (template) => {
      const [subcategories, styles] = await Promise.all([
        getTemplateSubcategories(template.id),
        getTemplateStyles(template.id),
      ]);
      return {
        ...template,
        subcategories,
        styles,
      };
    })
  );

  return templatesWithMetadata;
}

/**
 * Get a single template by ID or slug
 */
export async function getTemplate(idOrSlug: number | string): Promise<TemplateWithMetadata | null> {
  const query = typeof idOrSlug === 'number'
    ? supabase.from('templates').select('*').eq('id', idOrSlug)
    : supabase.from('templates').select('*').eq('slug', idOrSlug);

  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  const [subcategories, styles] = await Promise.all([
    getTemplateSubcategories(data.id),
    getTemplateStyles(data.id),
  ]);

  return {
    ...data,
    subcategories,
    styles,
  };
}

/**
 * Get template subcategories
 */
async function getTemplateSubcategories(templateId: number): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('template_subcategories')
    .select('subcategories(name)')
    .eq('template_id', templateId);

  const rows = (data || []) as Array<Record<string, unknown>>;
  return rows
    .flatMap((row) => {
      const rel = row.subcategories as unknown;
      if (!rel) return [];
      if (Array.isArray(rel)) {
        return rel
          .map((r) => (r && typeof r === 'object' ? ((r as Record<string, unknown>).name as string | undefined) : undefined))
          .filter((v): v is string => !!v);
      }
      if (typeof rel === 'object') {
        const name = (rel as Record<string, unknown>).name as string | undefined;
        return name ? [name] : [];
      }
      return [];
    })
    .filter(Boolean);
}

/**
 * Get template styles
 */
async function getTemplateStyles(templateId: number): Promise<string[]> {
  const { data } = await supabaseAdmin
    .from('template_styles')
    .select('styles(name)')
    .eq('template_id', templateId);

  const rows = (data || []) as Array<Record<string, unknown>>;
  return rows
    .flatMap((row) => {
      const rel = row.styles as unknown;
      if (!rel) return [];
      if (Array.isArray(rel)) {
        return rel
          .map((r) => (r && typeof r === 'object' ? ((r as Record<string, unknown>).name as string | undefined) : undefined))
          .filter((v): v is string => !!v);
      }
      if (typeof rel === 'object') {
        const name = (rel as Record<string, unknown>).name as string | undefined;
        return name ? [name] : [];
      }
      return [];
    })
    .filter(Boolean);
}

/**
 * Create or update a template
 */
export async function upsertTemplate(template: TemplateInsert): Promise<Template> {
  const startTime = Date.now();

  const { data, error } = await supabase
    .from('templates')
    .upsert(template, { onConflict: 'template_id' })
    .select()
    .single();

  if (error) {
    await logActivity('upsert', 'templates', 1, { template_id: template.template_id }, false, error.message);
    throw error;
  }

  await logActivity('upsert', 'templates', 1, { template_id: template.template_id, name: template.name }, true, undefined, Date.now() - startTime);

  return data;
}

/**
 * Batch upsert templates (for scraping)
 */
export async function batchUpsertTemplates(templates: TemplateInsert[]): Promise<{ success: number; failed: number }> {
  const startTime = Date.now();
  let success = 0;
  let failed = 0;

  // Process in batches of 100 to avoid request size limits
  const batchSize = 100;
  for (let i = 0; i < templates.length; i += batchSize) {
    const batch = templates.slice(i, i + batchSize);

    const { error } = await connectionQueue.enqueue(async () => {
      return supabase.from('templates').upsert(batch, { onConflict: 'template_id' });
    });

    if (error) {
      failed += batch.length;
      console.error('Batch upsert error:', error);
    } else {
      success += batch.length;
    }
  }

  await logActivity(
    'batch_upsert',
    'templates',
    templates.length,
    { success, failed },
    failed === 0,
    failed > 0 ? `${failed} templates failed` : undefined,
    Date.now() - startTime
  );

  return { success, failed };
}

/**
 * Update a template
 */
export async function updateTemplate(id: number, updates: TemplateUpdate): Promise<Template | null> {
  const { data, error } = await supabase
    .from('templates')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating template:', error);
    return null;
  }

  return data;
}

/**
 * Delete a template
 */
export async function deleteTemplate(id: number): Promise<boolean> {
  const { error } = await supabase.from('templates').delete().eq('id', id);
  return !error;
}

/**
 * Delete all templates (for fresh scrape)
 */
export async function deleteAllTemplates(): Promise<{ success: boolean; deletedCount: number }> {
  const startTime = Date.now();

  // Get count before deletion
  const { count } = await supabase.from('templates').select('*', { count: 'exact', head: true });

  // Delete all junction table entries first
  await supabase.from('template_subcategories').delete().neq('template_id', 0);
  await supabase.from('template_styles').delete().neq('template_id', 0);
  await supabase.from('template_features').delete().neq('template_id', 0);
  await supabase.from('ultra_featured_templates').delete().neq('template_id', 0);

  // Delete all templates
  const { error } = await supabase.from('templates').delete().neq('id', 0);

  const success = !error;
  await logActivity(
    'delete_all',
    'templates',
    count || 0,
    { deletedCount: count },
    success,
    error?.message,
    Date.now() - startTime
  );

  return { success, deletedCount: count || 0 };
}

/**
 * Get total template count
 */
export async function getTemplateCount(): Promise<number> {
  const { count, error } = await supabase
    .from('templates')
    .select('*', { count: 'exact', head: true });

  if (error) return 0;
  return count || 0;
}

// ============================================
// SUBCATEGORY OPERATIONS
// ============================================

/**
 * Get all subcategories with template counts
 */
export async function getSubcategories(): Promise<(Subcategory & { template_count: number })[]> {
  const { data: subcategories, error } = await supabase
    .from('subcategories')
    .select('*')
    .order('name');

  if (error || !subcategories) return [];

  // Get counts for each subcategory
  const subcategoriesWithCounts = await Promise.all(
    subcategories.map(async (sub) => {
      const { count } = await supabase
        .from('template_subcategories')
        .select('*', { count: 'exact', head: true })
        .eq('subcategory_id', sub.id);

      return { ...sub, template_count: count || 0 };
    })
  );

  return subcategoriesWithCounts;
}

/**
 * Get or create a subcategory
 */
export async function getOrCreateSubcategory(name: string, slug: string, displayName: string): Promise<Subcategory> {
  // Try to get existing
  const { data: existing } = await supabase
    .from('subcategories')
    .select('*')
    .eq('slug', slug)
    .single();

  if (existing) return existing;

  // Create new
  const { data, error } = await supabase
    .from('subcategories')
    .insert({ name, slug, display_name: displayName })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Link template to subcategory
 */
export async function linkTemplateSubcategory(templateId: number, subcategoryId: number): Promise<void> {
  await supabase
    .from('template_subcategories')
    .upsert({ template_id: templateId, subcategory_id: subcategoryId });
}

// ============================================
// STYLE OPERATIONS
// ============================================

/**
 * Get all styles
 */
export async function getStyles(): Promise<Style[]> {
  const { data, error } = await supabase.from('styles').select('*').order('name');
  if (error) return [];
  return data || [];
}

/**
 * Get or create a style
 */
export async function getOrCreateStyle(name: string, slug: string, displayName: string): Promise<Style> {
  const { data: existing } = await supabase
    .from('styles')
    .select('*')
    .eq('slug', slug)
    .single();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('styles')
    .insert({ name, slug, display_name: displayName })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Link template to style
 */
export async function linkTemplateStyle(templateId: number, styleId: number): Promise<void> {
  await supabase
    .from('template_styles')
    .upsert({ template_id: templateId, style_id: styleId });
}

// ============================================
// FEATURED AUTHORS OPERATIONS
// ============================================

/**
 * Get all featured authors
 */
export async function getFeaturedAuthors(): Promise<FeaturedAuthor[]> {
  const { data, error } = await supabaseAdmin
    .from('featured_authors')
    .select('*')
    .eq('is_active', true)
    .order('featured_at', { ascending: false });

  if (error) return [];
  return data || [];
}

/**
 * Add a featured author
 */
export async function addFeaturedAuthor(authorId: string, authorName: string): Promise<FeaturedAuthor | null> {
  const { data, error } = await supabaseAdmin
    .from('featured_authors')
    .upsert({ author_id: authorId, author_name: authorName, is_active: true }, { onConflict: 'author_id' })
    .select()
    .single();

  if (error) return null;
  return data;
}

/**
 * Remove a featured author
 */
export async function removeFeaturedAuthor(authorId: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from('featured_authors')
    .update({ is_active: false })
    .eq('author_id', authorId);

  return !error;
}

// ============================================
// ULTRA FEATURED TEMPLATES OPERATIONS
// ============================================

/**
 * Get ultra featured templates
 */
export async function getUltraFeaturedTemplates(): Promise<TemplateWithMetadata[]> {
  const { data, error } = await supabaseAdmin
    .from('ultra_featured_templates')
    .select('position, templates(*)')
    .order('position');

  if (error || !data) return [];

  const templates = await Promise.all(
    data.map(async (item) => {
      const rel = (item as Record<string, unknown>).templates as unknown;
      const template = (Array.isArray(rel) ? rel[0] : rel) as Template | undefined;
      if (!template) return null;
      const [subcategories, styles] = await Promise.all([
        getTemplateSubcategories(template.id),
        getTemplateStyles(template.id),
      ]);
      return {
        ...template,
        position: (item as Record<string, unknown>).position as number,
        subcategories,
        styles,
      };
    })
  );

  return templates.filter(Boolean) as TemplateWithMetadata[];
}

/**
 * Replace ultra featured templates
 */
export async function replaceUltraFeaturedTemplates(templateIds: number[]): Promise<void> {
  // Delete existing
  await supabaseAdmin.from('ultra_featured_templates').delete().neq('id', 0);

  // Insert new
  const entries = templateIds.map((templateId, index) => ({
    template_id: templateId,
    position: index + 1,
  }));

  if (entries.length > 0) {
    await supabaseAdmin.from('ultra_featured_templates').insert(entries);
  }
}

/**
 * Search templates for ultra-featured curation
 */
export async function searchTemplates(query: string, limit = 10): Promise<TemplateWithMetadata[]> {
  const { data, error } = await supabaseAdmin
    .from('templates')
    .select('*')
    .or(`name.ilike.%${query}%,slug.ilike.%${query}%,author_name.ilike.%${query}%`)
    .order('updated_at', { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return Promise.all(
    data.map(async (template) => {
      const [subcategories, styles] = await Promise.all([
        getTemplateSubcategories(template.id),
        getTemplateStyles(template.id),
      ]);
      return { ...template, subcategories, styles };
    })
  );
}

// ============================================
// BLACKLIST OPERATIONS
// ============================================

/**
 * Extract domain slug from live preview URL
 */
export function extractDomainSlug(livePreviewUrl: string): string | null {
  try {
    const url = new URL(livePreviewUrl);
    const hostname = url.hostname;
    if (hostname.endsWith('.webflow.io')) {
      return hostname.replace('.webflow.io', '');
    }
    return hostname;
  } catch {
    return null;
  }
}

/**
 * Check if template is blacklisted
 */
export async function isTemplateBlacklisted(livePreviewUrl: string): Promise<boolean> {
  const domainSlug = extractDomainSlug(livePreviewUrl);
  if (!domainSlug) return false;

  const { data } = await supabase
    .from('template_blacklist')
    .select('id')
    .eq('domain_slug', domainSlug)
    .single();

  return !!data;
}

/**
 * Add template to blacklist
 */
export async function blacklistTemplate(
  livePreviewUrl: string,
  storefrontUrl?: string,
  reason: BlacklistReason = 'manual_skip'
): Promise<number | null> {
  const domainSlug = extractDomainSlug(livePreviewUrl);
  if (!domainSlug) return null;

  const { data, error } = await supabase
    .from('template_blacklist')
    .upsert({ domain_slug: domainSlug, storefront_url: storefrontUrl, reason }, { onConflict: 'domain_slug' })
    .select('id')
    .single();

  if (error) return null;
  return data.id;
}

/**
 * Remove template from blacklist
 */
export async function unblacklistTemplate(domainSlug: string): Promise<boolean> {
  const { error } = await supabase.from('template_blacklist').delete().eq('domain_slug', domainSlug);
  return !error;
}

/**
 * Get all blacklisted templates
 */
export async function getBlacklistedTemplates(): Promise<Array<{
  id: number;
  domain_slug: string;
  storefront_url: string | null;
  reason: string;
  created_at: string;
}>> {
  const { data, error } = await supabase
    .from('template_blacklist')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

/**
 * Get blacklist as a Set for efficient lookup
 */
export async function getBlacklistSet(): Promise<Set<string>> {
  const { data } = await supabase.from('template_blacklist').select('domain_slug');
  return new Set(data?.map(b => b.domain_slug) || []);
}

// ============================================
// SCREENSHOT EXCLUSIONS
// ============================================

/**
 * Get active screenshot exclusions
 */
export async function getActiveScreenshotExclusions(): Promise<string[]> {
  const { data, error } = await supabase
    .from('screenshot_exclusions')
    .select('selector, selector_type')
    .eq('is_active', true);

  if (error || !data) return [];

  return data.map(exc => {
    if (exc.selector_type === 'class' && !exc.selector.startsWith('.')) {
      return `.${exc.selector}`;
    }
    if (exc.selector_type === 'id' && !exc.selector.startsWith('#')) {
      return `#${exc.selector}`;
    }
    return exc.selector;
  });
}

/**
 * Get all screenshot exclusions
 */
export async function getScreenshotExclusions(): Promise<ScreenshotExclusion[]> {
  const { data, error } = await supabase
    .from('screenshot_exclusions')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) return [];
  return data || [];
}

/**
 * Add screenshot exclusion
 */
export async function addScreenshotExclusion(
  selector: string,
  selectorType: 'class' | 'id' | 'selector',
  description?: string
): Promise<ScreenshotExclusion | null> {
  const { data, error } = await supabase
    .from('screenshot_exclusions')
    .insert({ selector, selector_type: selectorType, description, is_active: true })
    .select()
    .single();

  if (error) return null;
  return data;
}

/**
 * Toggle screenshot exclusion
 */
export async function toggleScreenshotExclusion(id: number, isActive: boolean): Promise<boolean> {
  const { error } = await supabase
    .from('screenshot_exclusions')
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq('id', id);

  return !error;
}

/**
 * Delete screenshot exclusion
 */
export async function deleteScreenshotExclusion(id: number): Promise<boolean> {
  const { error } = await supabase.from('screenshot_exclusions').delete().eq('id', id);
  return !error;
}

// ============================================
// SCRAPE JOB OPERATIONS
// ============================================

/**
 * Create a scrape job
 */
export async function createScrapeJob(jobType: string, totalTemplates: number): Promise<ScrapeJob> {
  const { data, error } = await supabase
    .from('scrape_jobs')
    .insert({
      job_type: jobType,
      status: 'running',
      total_templates: totalTemplates,
      started_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update scrape job progress
 */
export async function updateScrapeJobProgress(
  jobId: number,
  updates: {
    processed_templates?: number;
    successful_templates?: number;
    failed_templates?: number;
    status?: string;
    error_message?: string;
  }
): Promise<void> {
  const updateData: Record<string, unknown> = { ...updates };
  if (updates.status === 'completed' || updates.status === 'failed') {
    updateData.completed_at = new Date().toISOString();
  }

  await supabase.from('scrape_jobs').update(updateData).eq('id', jobId);
}

/**
 * Get scrape job by ID
 */
export async function getScrapeJob(jobId: number): Promise<ScrapeJob | null> {
  const { data } = await supabase.from('scrape_jobs').select('*').eq('id', jobId).single();
  return data;
}

// ============================================
// FRESH SCRAPE STATE OPERATIONS
// ============================================

/**
 * Get current fresh scrape state
 */
export async function getFreshScrapeState(): Promise<FreshScrapeState | null> {
  const { data } = await supabase
    .from('fresh_scrape_state')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  return data;
}

/**
 * Create fresh scrape state
 */
export async function createFreshScrapeState(state: Partial<FreshScrapeState>): Promise<FreshScrapeState> {
  const { data, error } = await supabase
    .from('fresh_scrape_state')
    .insert(state as FreshScrapeState)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update fresh scrape state
 */
export async function updateFreshScrapeState(id: number, updates: Partial<FreshScrapeState>): Promise<void> {
  await supabase
    .from('fresh_scrape_state')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id);
}

/**
 * Add fresh scrape screenshot
 */
export async function addFreshScrapeScreenshot(
  freshScrapeId: number,
  templateName: string,
  templateSlug: string,
  screenshotPath: string,
  isFeatured: boolean
): Promise<void> {
  await supabase.from('fresh_scrape_screenshots').insert({
    fresh_scrape_id: freshScrapeId,
    template_name: templateName,
    template_slug: templateSlug,
    screenshot_thumbnail_path: screenshotPath,
    is_featured_author: isFeatured,
  });
}

/**
 * Get recent fresh scrape screenshots
 */
export async function getFreshScrapeScreenshots(freshScrapeId: number, limit = 20): Promise<Array<{
  template_name: string;
  template_slug: string;
  screenshot_thumbnail_path: string;
  is_featured_author: boolean;
  captured_at: string;
}>> {
  const { data } = await supabase
    .from('fresh_scrape_screenshots')
    .select('*')
    .eq('fresh_scrape_id', freshScrapeId)
    .order('captured_at', { ascending: false })
    .limit(limit);

  return data || [];
}

// ============================================
// VISITOR & ANALYTICS OPERATIONS
// ============================================

/**
 * Get or create visitor
 */
export async function getOrCreateVisitor(sessionId: string, ipAddress?: string, userAgent?: string): Promise<Visitor> {
  const { data: existing } = await supabase
    .from('visitors')
    .select('*')
    .eq('session_id', sessionId)
    .single();

  if (existing) {
    // Update last activity
    await supabase
      .from('visitors')
      .update({ last_activity: new Date().toISOString() })
      .eq('id', existing.id);
    return existing;
  }

  const { data, error } = await supabase
    .from('visitors')
    .insert({ session_id: sessionId, ip_address: ipAddress, user_agent: userAgent })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Update visitor
 */
export async function updateVisitor(
  sessionId: string,
  updates: {
    current_step?: string;
    selected_template_id?: number;
    form_data?: unknown;
  }
): Promise<void> {
  await supabase
    .from('visitors')
    .update({ ...updates, last_activity: new Date().toISOString() })
    .eq('session_id', sessionId);
}

// ============================================
// DATABASE STATS
// ============================================

/**
 * Get database statistics
 */
export async function getStats(): Promise<{
  templates: number;
  subcategories: number;
  styles: number;
  features: number;
  featuredAuthors: number;
  scrapeJobs: number;
  activeVisitors: number;
  completedPurchases: number;
}> {
  const [templates, subcategories, styles, features, authors, jobs, visitors, purchases] = await Promise.all([
    supabase.from('templates').select('*', { count: 'exact', head: true }),
    supabase.from('subcategories').select('*', { count: 'exact', head: true }),
    supabase.from('styles').select('*', { count: 'exact', head: true }),
    supabase.from('features').select('*', { count: 'exact', head: true }),
    supabase.from('featured_authors').select('*', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('scrape_jobs').select('*', { count: 'exact', head: true }),
    supabase.from('visitors').select('*', { count: 'exact', head: true }).gte('last_activity', new Date(Date.now() - 5 * 60 * 1000).toISOString()),
    supabase.from('purchases').select('*', { count: 'exact', head: true }).eq('status', 'completed'),
  ]);

  return {
    templates: templates.count || 0,
    subcategories: subcategories.count || 0,
    styles: styles.count || 0,
    features: features.count || 0,
    featuredAuthors: authors.count || 0,
    scrapeJobs: jobs.count || 0,
    activeVisitors: visitors.count || 0,
    completedPurchases: purchases.count || 0,
  };
}

// ============================================
// ALTERNATE HOMEPAGE METRICS
// ============================================

/**
 * Get alternate homepage metrics
 */
export async function getAlternateHomepageMetrics(): Promise<AlternateHomepageMetrics> {
  const [total, alternate] = await Promise.all([
    supabase.from('templates').select('*', { count: 'exact', head: true }),
    supabase.from('templates').select('*', { count: 'exact', head: true }).eq('is_alternate_homepage', true),
  ]);

  // Get top alternate paths - need raw query
  const { data: pathData } = await supabase
    .from('templates')
    .select('alternate_homepage_path')
    .eq('is_alternate_homepage', true)
    .not('alternate_homepage_path', 'is', null);

  const pathCounts: Record<string, number> = {};
  pathData?.forEach(item => {
    const path = item.alternate_homepage_path;
    if (path) {
      pathCounts[path] = (pathCounts[path] || 0) + 1;
    }
  });

  const topPaths = Object.entries(pathCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  const totalCount = total.count || 0;
  const alternateCount = alternate.count || 0;

  return {
    totalTemplates: totalCount,
    alternateHomepageCount: alternateCount,
    indexPageCount: totalCount - alternateCount,
    alternatePercentage: totalCount > 0 ? Math.round((alternateCount / totalCount) * 1000) / 10 : 0,
    topAlternatePaths: topPaths,
  };
}

/**
 * Get templates with alternate homepage
 */
export async function getAlternateHomepageTemplates(limit = 50): Promise<Template[]> {
  const { data } = await supabase
    .from('templates')
    .select('*')
    .eq('is_alternate_homepage', true)
    .order('updated_at', { ascending: false })
    .limit(limit);

  return data || [];
}

// ============================================
// SUPABASE ACTIVITY LOG
// ============================================

/**
 * Get recent activity logs
 */
export async function getRecentActivityLogs(limit = 50): Promise<Array<{
  id: number;
  action_type: string;
  table_name: string;
  record_count: number;
  details: unknown;
  success: boolean;
  error_message: string | null;
  duration_ms: number | null;
  created_at: string;
}>> {
  const { data } = await supabase
    .from('supabase_activity_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  return data || [];
}

/**
 * Get activity statistics
 */
export async function getActivityStats(): Promise<{
  totalOperations: number;
  successfulOperations: number;
  failedOperations: number;
  averageDurationMs: number;
  operationsByTable: Record<string, number>;
}> {
  const { data: logs } = await supabase
    .from('supabase_activity_log')
    .select('*')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (!logs || logs.length === 0) {
    return {
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      averageDurationMs: 0,
      operationsByTable: {},
    };
  }

  const operationsByTable: Record<string, number> = {};
  let totalDuration = 0;
  let durationCount = 0;

  logs.forEach(log => {
    operationsByTable[log.table_name] = (operationsByTable[log.table_name] || 0) + 1;
    if (log.duration_ms) {
      totalDuration += log.duration_ms;
      durationCount++;
    }
  });

  return {
    totalOperations: logs.length,
    successfulOperations: logs.filter(l => l.success).length,
    failedOperations: logs.filter(l => !l.success).length,
    averageDurationMs: durationCount > 0 ? Math.round(totalDuration / durationCount) : 0,
    operationsByTable,
  };
}
