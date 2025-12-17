// Supabase Database Types
// Auto-generated types matching the database schema

export interface Database {
  public: {
    Tables: {
      templates: {
        Row: {
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
          scraped_at: string;
          updated_at: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['templates']['Row'], 'id' | 'scraped_at' | 'updated_at' | 'created_at'> & {
          id?: number;
          scraped_at?: string;
          updated_at?: string;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['templates']['Insert']>;
      };
      subcategories: {
        Row: {
          id: number;
          name: string;
          slug: string;
          display_name: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['subcategories']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['subcategories']['Insert']>;
      };
      template_subcategories: {
        Row: {
          template_id: number;
          subcategory_id: number;
        };
        Insert: Database['public']['Tables']['template_subcategories']['Row'];
        Update: Partial<Database['public']['Tables']['template_subcategories']['Insert']>;
      };
      styles: {
        Row: {
          id: number;
          name: string;
          slug: string;
          display_name: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['styles']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['styles']['Insert']>;
      };
      template_styles: {
        Row: {
          template_id: number;
          style_id: number;
        };
        Insert: Database['public']['Tables']['template_styles']['Row'];
        Update: Partial<Database['public']['Tables']['template_styles']['Insert']>;
      };
      features: {
        Row: {
          id: number;
          name: string;
          slug: string;
          display_name: string;
          description: string | null;
          icon_type: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['features']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['features']['Insert']>;
      };
      template_features: {
        Row: {
          template_id: number;
          feature_id: number;
        };
        Insert: Database['public']['Tables']['template_features']['Row'];
        Update: Partial<Database['public']['Tables']['template_features']['Insert']>;
      };
      featured_authors: {
        Row: {
          id: number;
          author_id: string;
          author_name: string;
          featured_at: string;
          is_active: boolean;
        };
        Insert: Omit<Database['public']['Tables']['featured_authors']['Row'], 'id' | 'featured_at'> & {
          id?: number;
          featured_at?: string;
        };
        Update: Partial<Database['public']['Tables']['featured_authors']['Insert']>;
      };
      ultra_featured_templates: {
        Row: {
          id: number;
          template_id: number;
          position: number;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['ultra_featured_templates']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['ultra_featured_templates']['Insert']>;
      };
      thumbnail_jobs: {
        Row: {
          id: number;
          template_id: number;
          target_url: string;
          status: string;
          attempts: number;
          error_message: string | null;
          screenshot_path: string | null;
          screenshot_thumbnail_path: string | null;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
          requested_by: string | null;
        };
        Insert: Omit<Database['public']['Tables']['thumbnail_jobs']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['thumbnail_jobs']['Insert']>;
      };
      scrape_jobs: {
        Row: {
          id: number;
          job_type: string;
          status: string;
          total_templates: number;
          processed_templates: number;
          successful_templates: number;
          failed_templates: number;
          error_message: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['scrape_jobs']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['scrape_jobs']['Insert']>;
      };
      scrape_logs: {
        Row: {
          id: number;
          job_id: number;
          template_url: string | null;
          status: string;
          message: string | null;
          error_details: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['scrape_logs']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['scrape_logs']['Insert']>;
      };
      template_blacklist: {
        Row: {
          id: number;
          domain_slug: string;
          storefront_url: string | null;
          reason: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['template_blacklist']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['template_blacklist']['Insert']>;
      };
      scrape_sessions: {
        Row: {
          id: number;
          session_type: string;
          status: string;
          total_templates: number;
          processed_templates: number;
          successful_templates: number;
          failed_templates: number;
          skipped_templates: number;
          batch_size: number;
          total_batches: number;
          current_batch_number: number;
          sitemap_snapshot: unknown | null;
          config: unknown | null;
          error_message: string | null;
          started_at: string | null;
          paused_at: string | null;
          resumed_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['scrape_sessions']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['scrape_sessions']['Insert']>;
      };
      scrape_batches: {
        Row: {
          id: number;
          session_id: number;
          batch_number: number;
          status: string;
          total_templates: number;
          processed_templates: number;
          successful_templates: number;
          failed_templates: number;
          skipped_templates: number;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['scrape_batches']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['scrape_batches']['Insert']>;
      };
      batch_templates: {
        Row: {
          id: number;
          batch_id: number;
          session_id: number;
          template_url: string;
          template_slug: string | null;
          template_name: string | null;
          live_preview_url: string | null;
          status: string;
          phase_started_at: string | null;
          phase_duration_seconds: number;
          retry_count: number;
          error_message: string | null;
          result_template_id: number | null;
          created_at: string;
          completed_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['batch_templates']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['batch_templates']['Insert']>;
      };
      session_resume_points: {
        Row: {
          id: number;
          session_id: number;
          last_completed_batch_id: number | null;
          last_completed_template_id: number | null;
          remaining_urls: unknown | null;
          checkpoint_data: unknown | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['session_resume_points']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['session_resume_points']['Insert']>;
      };
      fresh_scrape_state: {
        Row: {
          id: number;
          status: string;
          phase: string;
          total_sitemap_count: number;
          featured_author_ids: unknown | null;
          featured_template_urls: unknown | null;
          regular_template_urls: unknown | null;
          featured_total: number;
          featured_processed: number;
          featured_successful: number;
          featured_failed: number;
          regular_total: number;
          regular_processed: number;
          regular_successful: number;
          regular_failed: number;
          current_batch_index: number;
          current_batch_urls: unknown | null;
          config: unknown | null;
          started_at: string | null;
          paused_at: string | null;
          resumed_at: string | null;
          completed_at: string | null;
          deletion_completed_at: string | null;
          featured_completed_at: string | null;
          last_error: string | null;
          error_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['fresh_scrape_state']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['fresh_scrape_state']['Insert']>;
      };
      fresh_scrape_screenshots: {
        Row: {
          id: number;
          fresh_scrape_id: number;
          template_name: string | null;
          template_slug: string | null;
          screenshot_thumbnail_path: string | null;
          is_featured_author: boolean;
          captured_at: string;
        };
        Insert: Omit<Database['public']['Tables']['fresh_scrape_screenshots']['Row'], 'id' | 'captured_at'> & {
          id?: number;
          captured_at?: string;
        };
        Update: Partial<Database['public']['Tables']['fresh_scrape_screenshots']['Insert']>;
      };
      supabase_activity_log: {
        Row: {
          id: number;
          action_type: string;
          table_name: string;
          record_count: number;
          details: unknown | null;
          success: boolean;
          error_message: string | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['supabase_activity_log']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['supabase_activity_log']['Insert']>;
      };
      visitors: {
        Row: {
          id: number;
          session_id: string;
          ip_address: string | null;
          user_agent: string | null;
          current_step: string | null;
          selected_template_id: number | null;
          form_data: unknown | null;
          first_visit: string;
          last_activity: string;
        };
        Insert: Omit<Database['public']['Tables']['visitors']['Row'], 'id' | 'first_visit' | 'last_activity'> & {
          id?: number;
          first_visit?: string;
          last_activity?: string;
        };
        Update: Partial<Database['public']['Tables']['visitors']['Insert']>;
      };
      purchases: {
        Row: {
          id: number;
          visitor_id: number;
          template_id: number;
          customer_name: string;
          customer_email: string;
          business_details: unknown | null;
          website_url: string | null;
          page_count: number | null;
          amount: number | null;
          stripe_payment_id: string | null;
          stripe_customer_id: string | null;
          status: string;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['purchases']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['purchases']['Insert']>;
      };
      system_metrics: {
        Row: {
          id: number;
          metric_type: string;
          endpoint: string | null;
          response_time_ms: number | null;
          status_code: number | null;
          error_message: string | null;
          metadata: unknown | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['system_metrics']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['system_metrics']['Insert']>;
      };
      preview_metrics: {
        Row: {
          id: number;
          template_id: number | null;
          session_id: string | null;
          load_time_ms: number | null;
          navigation_count: number;
          total_duration_ms: number | null;
          device_type: string | null;
          error_occurred: boolean;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['preview_metrics']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['preview_metrics']['Insert']>;
      };
      api_metrics: {
        Row: {
          id: number;
          endpoint: string;
          method: string;
          response_time_ms: number | null;
          status_code: number | null;
          ip_address: string | null;
          user_agent: string | null;
          payload_size: number | null;
          error_message: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['api_metrics']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['api_metrics']['Insert']>;
      };
      page_views: {
        Row: {
          id: number;
          page_path: string;
          session_id: string | null;
          ip_address: string | null;
          referrer: string | null;
          user_agent: string | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['page_views']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['page_views']['Insert']>;
      };
      system_health: {
        Row: {
          id: number;
          cpu_usage: number | null;
          memory_usage_mb: number | null;
          memory_percentage: number | null;
          disk_usage_gb: number | null;
          disk_percentage: number | null;
          active_connections: number | null;
          database_size_mb: number | null;
          screenshot_count: number | null;
          screenshot_size_gb: number | null;
          uptime_seconds: number | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['system_health']['Row'], 'id' | 'created_at'> & {
          id?: number;
          created_at?: string;
        };
        Update: Partial<Database['public']['Tables']['system_health']['Insert']>;
      };
      screenshot_exclusions: {
        Row: {
          id: number;
          selector: string;
          selector_type: string;
          description: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['screenshot_exclusions']['Row'], 'id' | 'created_at' | 'updated_at'> & {
          id?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database['public']['Tables']['screenshot_exclusions']['Insert']>;
      };
    };
  };
}

// Convenience type exports
export type Template = Database['public']['Tables']['templates']['Row'];
export type TemplateInsert = Database['public']['Tables']['templates']['Insert'];
export type TemplateUpdate = Database['public']['Tables']['templates']['Update'];

export type Subcategory = Database['public']['Tables']['subcategories']['Row'];
export type Style = Database['public']['Tables']['styles']['Row'];
export type Feature = Database['public']['Tables']['features']['Row'];
export type FeaturedAuthor = Database['public']['Tables']['featured_authors']['Row'];
export type UltraFeaturedTemplate = Database['public']['Tables']['ultra_featured_templates']['Row'];

export type ScrapeJob = Database['public']['Tables']['scrape_jobs']['Row'];
export type ScrapeSession = Database['public']['Tables']['scrape_sessions']['Row'];
export type ScrapeBatch = Database['public']['Tables']['scrape_batches']['Row'];
export type BatchTemplate = Database['public']['Tables']['batch_templates']['Row'];
export type FreshScrapeState = Database['public']['Tables']['fresh_scrape_state']['Row'];

export type Visitor = Database['public']['Tables']['visitors']['Row'];
export type Purchase = Database['public']['Tables']['purchases']['Row'];
export type ScreenshotExclusion = Database['public']['Tables']['screenshot_exclusions']['Row'];
export type SupabaseActivityLog = Database['public']['Tables']['supabase_activity_log']['Row'];

// Extended types with joined data
export interface TemplateWithMetadata extends Template {
  subcategories?: string[];
  styles?: string[];
  features?: string[];
  position?: number;
}

// Scraping types
export type ScrapeSessionType = 'full' | 'update' | 'screenshot_update' | 'thumbnail_update';
export type ScrapeSessionStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type BatchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';
export type BatchTemplateStatus = 'pending' | 'scraping_details' | 'taking_screenshot' | 'processing_thumbnail' | 'saving' | 'completed' | 'failed' | 'skipped';
export type BlacklistReason = 'manual_skip' | 'error_threshold' | 'admin_blocked';

export interface ScrapeSessionConfig {
  concurrency: number;
  browserInstances: number;
  pagesPerBrowser: number;
  batchSize: number;
}

export interface AlternateHomepageMetrics {
  totalTemplates: number;
  alternateHomepageCount: number;
  indexPageCount: number;
  alternatePercentage: number;
  topAlternatePaths: Array<{ path: string; count: number }>;
}
