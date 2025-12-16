-- Create templates table
CREATE TABLE IF NOT EXISTS templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id TEXT UNIQUE NOT NULL, -- Unique identifier from Webflow
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    author_name TEXT,
    author_id TEXT,
    author_avatar TEXT,
    storefront_url TEXT NOT NULL,
    live_preview_url TEXT NOT NULL,
    designer_preview_url TEXT,
    price TEXT,
    short_description TEXT,
    long_description TEXT,
    screenshot_path TEXT,
    screenshot_thumbnail_path TEXT,
    is_featured BOOLEAN DEFAULT 0,
    is_cms BOOLEAN DEFAULT 0,
    is_ecommerce BOOLEAN DEFAULT 0,
    -- Alternate homepage detection fields
    screenshot_url TEXT, -- The actual URL that was screenshotted (may differ from live_preview_url)
    is_alternate_homepage BOOLEAN DEFAULT 0, -- Whether screenshot was taken from an alternate page (not index)
    alternate_homepage_path TEXT, -- The detected alternate homepage path (e.g., '/home-1', '/homepage-a')
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create subcategories table
CREATE TABLE IF NOT EXISTS subcategories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create template_subcategories junction table
CREATE TABLE IF NOT EXISTS template_subcategories (
    template_id INTEGER NOT NULL,
    subcategory_id INTEGER NOT NULL,
    PRIMARY KEY (template_id, subcategory_id),
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
    FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
);

-- Create styles table
CREATE TABLE IF NOT EXISTS styles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create template_styles junction table
CREATE TABLE IF NOT EXISTS template_styles (
    template_id INTEGER NOT NULL,
    style_id INTEGER NOT NULL,
    PRIMARY KEY (template_id, style_id),
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
    FOREIGN KEY (style_id) REFERENCES styles(id) ON DELETE CASCADE
);

-- Create features table
CREATE TABLE IF NOT EXISTS features (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    display_name TEXT NOT NULL,
    description TEXT,
    icon_type TEXT, -- 'default' or 'cms' or 'ecommerce'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create template_features junction table
CREATE TABLE IF NOT EXISTS template_features (
    template_id INTEGER NOT NULL,
    feature_id INTEGER NOT NULL,
    PRIMARY KEY (template_id, feature_id),
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE,
    FOREIGN KEY (feature_id) REFERENCES features(id) ON DELETE CASCADE
);

-- Create featured_authors table
CREATE TABLE IF NOT EXISTS featured_authors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author_id TEXT UNIQUE NOT NULL,
    author_name TEXT NOT NULL,
    featured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1
);

-- Create ultra featured templates table
CREATE TABLE IF NOT EXISTS ultra_featured_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL UNIQUE,
    position INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ultra_featured_position ON ultra_featured_templates(position);

-- Create thumbnail jobs table
CREATE TABLE IF NOT EXISTS thumbnail_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER NOT NULL,
    target_url TEXT NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed'
    attempts INTEGER DEFAULT 0,
    error_message TEXT,
    screenshot_path TEXT,
    screenshot_thumbnail_path TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    requested_by TEXT,
    FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_status ON thumbnail_jobs(status);
CREATE INDEX IF NOT EXISTS idx_thumbnail_jobs_created ON thumbnail_jobs(created_at);

-- Create scrape_jobs table
CREATE TABLE IF NOT EXISTS scrape_jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT NOT NULL, -- 'full', 'update', 'single'
    status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'cancelled'
    total_templates INTEGER DEFAULT 0,
    processed_templates INTEGER DEFAULT 0,
    successful_templates INTEGER DEFAULT 0,
    failed_templates INTEGER DEFAULT 0,
    error_message TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create scrape_logs table
CREATE TABLE IF NOT EXISTS scrape_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    template_url TEXT,
    status TEXT NOT NULL, -- 'processing', 'success', 'failed'
    message TEXT,
    error_details TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES scrape_jobs(id) ON DELETE CASCADE
);

-- Create visitors table
CREATE TABLE IF NOT EXISTS visitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT UNIQUE NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    current_step TEXT, -- 'gallery', 'details', 'contract', 'pricing', 'checkout'
    selected_template_id INTEGER,
    form_data TEXT, -- JSON string of user's form data
    first_visit DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (selected_template_id) REFERENCES templates(id)
);

-- Create purchases table
CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    visitor_id INTEGER NOT NULL,
    template_id INTEGER NOT NULL,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    business_details TEXT, -- JSON string
    website_url TEXT,
    page_count INTEGER,
    amount DECIMAL(10, 2),
    stripe_payment_id TEXT,
    stripe_customer_id TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (visitor_id) REFERENCES visitors(id),
    FOREIGN KEY (template_id) REFERENCES templates(id)
);

-- Create metrics table for tracking system performance
CREATE TABLE IF NOT EXISTS system_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_type TEXT NOT NULL, -- 'api_response', 'preview_load', 'db_query', 'scrape_speed'
    endpoint TEXT,
    response_time_ms INTEGER,
    status_code INTEGER,
    error_message TEXT,
    metadata TEXT, -- JSON for additional data
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create preview metrics table
CREATE TABLE IF NOT EXISTS preview_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER,
    session_id TEXT,
    load_time_ms INTEGER,
    navigation_count INTEGER DEFAULT 0,
    total_duration_ms INTEGER,
    device_type TEXT, -- 'desktop' or 'mobile'
    error_occurred BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (template_id) REFERENCES templates(id)
);

-- Create api metrics table for tracking API performance
CREATE TABLE IF NOT EXISTS api_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL,
    method TEXT NOT NULL,
    response_time_ms INTEGER,
    status_code INTEGER,
    ip_address TEXT,
    user_agent TEXT,
    payload_size INTEGER,
    error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create page views table
CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_path TEXT NOT NULL,
    session_id TEXT,
    ip_address TEXT,
    referrer TEXT,
    user_agent TEXT,
    duration_ms INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create system health snapshots
CREATE TABLE IF NOT EXISTS system_health (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cpu_usage REAL,
    memory_usage_mb INTEGER,
    memory_percentage REAL,
    disk_usage_gb REAL,
    disk_percentage REAL,
    active_connections INTEGER,
    database_size_mb REAL,
    screenshot_count INTEGER,
    screenshot_size_gb REAL,
    uptime_seconds INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_templates_slug ON templates(slug);
CREATE INDEX IF NOT EXISTS idx_templates_author_id ON templates(author_id);
CREATE INDEX IF NOT EXISTS idx_templates_featured ON templates(is_featured);
CREATE INDEX IF NOT EXISTS idx_template_subcategories_template ON template_subcategories(template_id);
CREATE INDEX IF NOT EXISTS idx_template_subcategories_subcategory ON template_subcategories(subcategory_id);
CREATE INDEX IF NOT EXISTS idx_template_styles_template ON template_styles(template_id);
CREATE INDEX IF NOT EXISTS idx_template_styles_style ON template_styles(style_id);
CREATE INDEX IF NOT EXISTS idx_featured_authors_active ON featured_authors(is_active);
CREATE INDEX IF NOT EXISTS idx_visitors_session ON visitors(session_id);
CREATE INDEX IF NOT EXISTS idx_scrape_jobs_status ON scrape_jobs(status);

-- New indexes for metrics
CREATE INDEX IF NOT EXISTS idx_system_metrics_type ON system_metrics(metric_type);
CREATE INDEX IF NOT EXISTS idx_system_metrics_created ON system_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_preview_metrics_template ON preview_metrics(template_id);
CREATE INDEX IF NOT EXISTS idx_preview_metrics_created ON preview_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_api_metrics_endpoint ON api_metrics(endpoint);
CREATE INDEX IF NOT EXISTS idx_api_metrics_created ON api_metrics(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_path ON page_views(page_path);
CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_system_health_created ON system_health(created_at);

-- Screenshot element exclusions table
-- Stores CSS selectors (class names or IDs) to remove before taking screenshots
CREATE TABLE IF NOT EXISTS screenshot_exclusions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    selector TEXT UNIQUE NOT NULL, -- CSS selector (class name, ID, or complex selector)
    selector_type TEXT DEFAULT 'class', -- 'class', 'id', or 'selector'
    description TEXT, -- Optional description of what this selector targets
    is_active BOOLEAN DEFAULT 1, -- Whether this exclusion is currently active
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_screenshot_exclusions_active ON screenshot_exclusions(is_active);
CREATE INDEX IF NOT EXISTS idx_screenshot_exclusions_type ON screenshot_exclusions(selector_type);

-- ============================================
-- BATCH SCRAPING SYSTEM
-- ============================================

-- Template blacklist - prevents templates from being scraped
CREATE TABLE IF NOT EXISTS template_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_slug TEXT UNIQUE NOT NULL, -- The slug from live_preview_url domain (e.g., 'template-name' from template-name.webflow.io)
    storefront_url TEXT, -- Optional: store the full URL for reference
    reason TEXT DEFAULT 'manual_skip', -- 'manual_skip', 'error_threshold', 'admin_blocked'
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_template_blacklist_slug ON template_blacklist(domain_slug);

-- Scrape sessions - tracks overall scraping sessions that can span multiple batches
CREATE TABLE IF NOT EXISTS scrape_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_type TEXT NOT NULL, -- 'full', 'update', 'screenshot_update', 'thumbnail_update'
    status TEXT DEFAULT 'pending', -- 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled'
    total_templates INTEGER DEFAULT 0,
    processed_templates INTEGER DEFAULT 0,
    successful_templates INTEGER DEFAULT 0,
    failed_templates INTEGER DEFAULT 0,
    skipped_templates INTEGER DEFAULT 0,
    batch_size INTEGER DEFAULT 10,
    total_batches INTEGER DEFAULT 0,
    current_batch_number INTEGER DEFAULT 0,
    sitemap_snapshot TEXT, -- JSON array of all URLs from sitemap at session start
    config TEXT, -- JSON: { concurrency, browserInstances, pagesPerBrowser, etc. }
    error_message TEXT,
    started_at DATETIME,
    paused_at DATETIME,
    resumed_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_scrape_sessions_status ON scrape_sessions(status);
CREATE INDEX IF NOT EXISTS idx_scrape_sessions_type ON scrape_sessions(session_type);

-- Scrape batches - individual batches within a session
CREATE TABLE IF NOT EXISTS scrape_batches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL,
    batch_number INTEGER NOT NULL,
    status TEXT DEFAULT 'pending', -- 'pending', 'running', 'completed', 'failed', 'paused'
    total_templates INTEGER DEFAULT 0,
    processed_templates INTEGER DEFAULT 0,
    successful_templates INTEGER DEFAULT 0,
    failed_templates INTEGER DEFAULT 0,
    skipped_templates INTEGER DEFAULT 0,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE,
    UNIQUE(session_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_scrape_batches_session ON scrape_batches(session_id);
CREATE INDEX IF NOT EXISTS idx_scrape_batches_status ON scrape_batches(status);

-- Batch templates - individual templates within a batch with phase tracking
CREATE TABLE IF NOT EXISTS batch_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    batch_id INTEGER NOT NULL,
    session_id INTEGER NOT NULL,
    template_url TEXT NOT NULL,
    template_slug TEXT,
    template_name TEXT,
    live_preview_url TEXT,
    status TEXT DEFAULT 'pending', -- 'pending', 'scraping_details', 'taking_screenshot', 'processing_thumbnail', 'saving', 'completed', 'failed', 'skipped'
    phase_started_at DATETIME,
    phase_duration_seconds INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    result_template_id INTEGER, -- Reference to templates.id if successful
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (batch_id) REFERENCES scrape_batches(id) ON DELETE CASCADE,
    FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_batch_templates_batch ON batch_templates(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_templates_session ON batch_templates(session_id);
CREATE INDEX IF NOT EXISTS idx_batch_templates_status ON batch_templates(status);
CREATE INDEX IF NOT EXISTS idx_batch_templates_url ON batch_templates(template_url);

-- Session resume points - allows resuming from exact point
CREATE TABLE IF NOT EXISTS session_resume_points (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL UNIQUE,
    last_completed_batch_id INTEGER,
    last_completed_template_id INTEGER,
    remaining_urls TEXT, -- JSON array of URLs not yet processed
    checkpoint_data TEXT, -- JSON: any additional state needed to resume
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES scrape_sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_resume_points_session ON session_resume_points(session_id);

-- ============================================
-- FRESH SCRAPE SYSTEM (Start from Fresh)
-- ============================================

-- Stores persistent state for fresh scrape operations
-- Enables pausing and resuming across system restarts
CREATE TABLE IF NOT EXISTS fresh_scrape_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT DEFAULT 'idle', -- 'idle', 'deleting', 'scraping_featured', 'scraping_regular', 'paused', 'completed', 'failed'
    phase TEXT DEFAULT 'none', -- 'deletion', 'discovery', 'featured_scrape', 'regular_scrape', 'completed'

    -- Discovery stats
    total_sitemap_count INTEGER DEFAULT 0,
    featured_author_ids TEXT, -- JSON array of featured author IDs
    featured_template_urls TEXT, -- JSON array of featured author template URLs
    regular_template_urls TEXT, -- JSON array of remaining template URLs

    -- Progress counters
    featured_total INTEGER DEFAULT 0,
    featured_processed INTEGER DEFAULT 0,
    featured_successful INTEGER DEFAULT 0,
    featured_failed INTEGER DEFAULT 0,

    regular_total INTEGER DEFAULT 0,
    regular_processed INTEGER DEFAULT 0,
    regular_successful INTEGER DEFAULT 0,
    regular_failed INTEGER DEFAULT 0,

    -- Current batch tracking
    current_batch_index INTEGER DEFAULT 0,
    current_batch_urls TEXT, -- JSON array of current batch URLs

    -- Performance config
    config TEXT, -- JSON: { concurrency, browserInstances, pagesPerBrowser, batchSize, timeout }

    -- Timing
    started_at DATETIME,
    paused_at DATETIME,
    resumed_at DATETIME,
    completed_at DATETIME,
    deletion_completed_at DATETIME,
    featured_completed_at DATETIME,

    -- Error tracking
    last_error TEXT,
    error_count INTEGER DEFAULT 0,

    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Screenshot feed table for live screenshot gallery
CREATE TABLE IF NOT EXISTS fresh_scrape_screenshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fresh_scrape_id INTEGER NOT NULL,
    template_name TEXT,
    template_slug TEXT,
    screenshot_thumbnail_path TEXT,
    is_featured_author BOOLEAN DEFAULT 0,
    captured_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (fresh_scrape_id) REFERENCES fresh_scrape_state(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fresh_scrape_screenshots_scrape ON fresh_scrape_screenshots(fresh_scrape_id);
CREATE INDEX IF NOT EXISTS idx_fresh_scrape_screenshots_captured ON fresh_scrape_screenshots(captured_at DESC);
