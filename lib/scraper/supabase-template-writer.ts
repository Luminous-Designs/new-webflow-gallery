import { connectionQueue, supabaseAdmin } from '@/lib/supabase';

export interface SupabaseTemplateUpsertPayload {
  template: {
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
    scraped_at: string;
    updated_at: string;
  };
  subcategories: string[];
  styles: string[];
  features: string[];
}

export interface SupabaseWriteSnapshot {
  queued: number;
  inFlight: boolean;
  successful: number;
  failed: number;
  lastError: string | null;
  recent: Array<{ slug: string; status: 'queued' | 'saved' | 'failed'; error?: string }>;
}

function toSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

function normalizeName(value: string): { name: string; slug: string; display_name: string } | null {
  const display = value.trim();
  if (!display) return null;
  const lower = display.toLowerCase();
  const slug = toSlug(lower);
  if (!slug) return null;
  return { name: lower, slug, display_name: display };
}

function featureIconType(displayName: string): string {
  const name = displayName.toLowerCase();
  if (name.includes('ecommerce') || name.includes('e-commerce')) return 'ecommerce';
  if (name.includes('cms')) return 'cms';
  return 'default';
}

interface PendingItem {
  payload: SupabaseTemplateUpsertPayload;
  resolve: () => void;
  reject: (error: Error) => void;
}

export class SupabaseTemplateBatchWriter {
  private buffer: PendingItem[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private inFlight = false;

  private successful = 0;
  private failed = 0;
  private lastError: string | null = null;
  private recent: Array<{ slug: string; status: 'queued' | 'saved' | 'failed'; error?: string }> = [];

  constructor(
    private opts: {
      batchSize: number;
      flushIntervalMs: number;
      maxRecent: number;
    } = { batchSize: 25, flushIntervalMs: 500, maxRecent: 200 }
  ) {}

  getSnapshot(): SupabaseWriteSnapshot {
    return {
      queued: this.buffer.length,
      inFlight: this.inFlight,
      successful: this.successful,
      failed: this.failed,
      lastError: this.lastError,
      recent: this.recent.slice(0, this.opts.maxRecent),
    };
  }

  enqueue(payload: SupabaseTemplateUpsertPayload): Promise<void> {
    this.recent.unshift({ slug: payload.template.slug, status: 'queued' });
    if (this.recent.length > this.opts.maxRecent) this.recent = this.recent.slice(0, this.opts.maxRecent);

    return new Promise((resolve, reject) => {
      this.buffer.push({ payload, resolve, reject });
      this.scheduleFlush();
    });
  }

  async flushAll(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    while (this.buffer.length > 0) {
      await this.flushOnce();
    }
  }

  private scheduleFlush(): void {
    if (this.inFlight) return;
    if (this.buffer.length >= this.opts.batchSize) {
      void this.flushOnce();
      return;
    }
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushOnce();
    }, this.opts.flushIntervalMs);
  }

  private async flushOnce(): Promise<void> {
    if (this.inFlight) return;
    if (this.buffer.length === 0) return;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    this.inFlight = true;
    const batch = this.buffer.splice(0, this.opts.batchSize);

    try {
      await connectionQueue.enqueue(async () => {
        await this.flushBatch(batch.map((b) => b.payload));
      });

      this.successful += batch.length;
      for (const item of batch) item.resolve();
      this.updateRecent(batch.map((b) => b.payload.template.slug), 'saved');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.lastError = message;
      this.failed += batch.length;

      for (const item of batch) item.reject(error as Error);
      this.updateRecent(batch.map((b) => b.payload.template.slug), 'failed', message);
    } finally {
      this.inFlight = false;
      if (this.buffer.length > 0) this.scheduleFlush();
    }
  }

  private updateRecent(slugs: string[], status: 'saved' | 'failed', error?: string): void {
    for (const slug of slugs) {
      this.recent.unshift(error ? { slug, status, error } : { slug, status });
    }
    if (this.recent.length > this.opts.maxRecent) this.recent = this.recent.slice(0, this.opts.maxRecent);
  }

  private async flushBatch(payloads: SupabaseTemplateUpsertPayload[]): Promise<void> {
    const now = new Date().toISOString();

    const templateRows = payloads.map((p) => ({
      ...p.template,
      scraped_at: p.template.scraped_at || now,
      updated_at: p.template.updated_at || now,
    }));

    const { data: upserted, error: upsertError } = await supabaseAdmin
      .from('templates')
      .upsert(templateRows, { onConflict: 'template_id' })
      .select('id, template_id');

    if (upsertError) throw upsertError;

    const templateIdByTemplateKey = new Map<string, number>();
    for (const row of upserted || []) {
      templateIdByTemplateKey.set(row.template_id as string, row.id as number);
    }

    const subcategoryRows = new Map<string, { name: string; slug: string; display_name: string }>();
    const styleRows = new Map<string, { name: string; slug: string; display_name: string }>();
    const featureRows = new Map<string, { name: string; slug: string; display_name: string; icon_type: string }>();

    for (const p of payloads) {
      for (const raw of p.subcategories) {
        const normalized = normalizeName(raw);
        if (!normalized) continue;
        subcategoryRows.set(normalized.slug, normalized);
      }
      for (const raw of p.styles) {
        const normalized = normalizeName(raw);
        if (!normalized) continue;
        styleRows.set(normalized.slug, normalized);
      }
      for (const raw of p.features) {
        const normalized = normalizeName(raw);
        if (!normalized) continue;
        featureRows.set(normalized.slug, { ...normalized, icon_type: featureIconType(normalized.display_name) });
      }
    }

    const [subcatMap, styleMap, featureMap] = await Promise.all([
      this.upsertLookup('subcategories', Array.from(subcategoryRows.values())),
      this.upsertLookup('styles', Array.from(styleRows.values())),
      this.upsertLookup('features', Array.from(featureRows.values())),
    ]);

    const templateSubcatRows: Array<{ template_id: number; subcategory_id: number }> = [];
    const templateStyleRows: Array<{ template_id: number; style_id: number }> = [];
    const templateFeatureRows: Array<{ template_id: number; feature_id: number }> = [];

    for (const p of payloads) {
      const templateNumericId = templateIdByTemplateKey.get(p.template.template_id);
      if (!templateNumericId) continue;

      for (const raw of p.subcategories) {
        const normalized = normalizeName(raw);
        if (!normalized) continue;
        const subcategoryId = subcatMap.get(normalized.slug);
        if (subcategoryId) templateSubcatRows.push({ template_id: templateNumericId, subcategory_id: subcategoryId });
      }
      for (const raw of p.styles) {
        const normalized = normalizeName(raw);
        if (!normalized) continue;
        const styleId = styleMap.get(normalized.slug);
        if (styleId) templateStyleRows.push({ template_id: templateNumericId, style_id: styleId });
      }
      for (const raw of p.features) {
        const normalized = normalizeName(raw);
        if (!normalized) continue;
        const featureId = featureMap.get(normalized.slug);
        if (featureId) templateFeatureRows.push({ template_id: templateNumericId, feature_id: featureId });
      }
    }

    if (templateSubcatRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('template_subcategories')
        .upsert(templateSubcatRows, { onConflict: 'template_id,subcategory_id', ignoreDuplicates: true });
      if (error) throw error;
    }
    if (templateStyleRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('template_styles')
        .upsert(templateStyleRows, { onConflict: 'template_id,style_id', ignoreDuplicates: true });
      if (error) throw error;
    }
    if (templateFeatureRows.length > 0) {
      const { error } = await supabaseAdmin
        .from('template_features')
        .upsert(templateFeatureRows, { onConflict: 'template_id,feature_id', ignoreDuplicates: true });
      if (error) throw error;
    }
  }

  private async upsertLookup(
    table: 'subcategories' | 'styles' | 'features',
    rows: Array<{ name: string; slug: string; display_name: string } | { name: string; slug: string; display_name: string; icon_type: string }>
  ): Promise<Map<string, number>> {
    if (rows.length === 0) return new Map();

    const { data, error } = await supabaseAdmin
      .from(table)
      .upsert(rows as unknown as never[], { onConflict: 'slug' })
      .select('id, slug');

    if (error) throw error;

    const map = new Map<string, number>();
    for (const row of data || []) {
      map.set(row.slug as string, row.id as number);
    }
    return map;
  }
}
