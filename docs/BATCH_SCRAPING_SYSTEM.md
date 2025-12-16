# Batch Scraping System

## Overview

The Batch Scraping System is a modular, resumable template scraping architecture designed for incremental updates and fault tolerance. It organizes template scraping into manageable batches, tracks detailed progress at multiple levels, and provides administrative controls for skipping, blacklisting, and resuming operations.

## Key Features

- **Batch-based Processing**: Templates are organized into configurable batches (default: 10 templates per batch)
- **Real-time Phase Tracking**: Each template's progress is tracked through distinct phases (scraping details, taking screenshot, processing, saving)
- **Skip & Blacklist**: Admins can skip templates during scraping, automatically blacklisting them from future scrapes
- **Resume Capability**: Interrupted sessions can be resumed from the exact point of interruption
- **Sitemap Snapshot**: The sitemap state is captured at session start, ensuring consistency even if the Webflow sitemap changes mid-scrape

## Architecture

### Database Schema

The batch system introduces several new tables:

#### `scrape_sessions`
Tracks overall scraping sessions that can span multiple batches.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| session_type | TEXT | 'full', 'update', 'screenshot_update', 'thumbnail_update' |
| status | TEXT | 'pending', 'running', 'paused', 'completed', 'failed', 'cancelled' |
| total_templates | INTEGER | Total number of templates to process |
| processed_templates | INTEGER | Number of templates processed so far |
| successful_templates | INTEGER | Number of successfully scraped templates |
| failed_templates | INTEGER | Number of failed templates |
| skipped_templates | INTEGER | Number of skipped templates |
| batch_size | INTEGER | Templates per batch (default: 10) |
| total_batches | INTEGER | Total number of batches |
| current_batch_number | INTEGER | Currently processing batch |
| sitemap_snapshot | TEXT | JSON array of all URLs at session start |
| config | TEXT | JSON configuration (concurrency, browser instances, etc.) |

#### `scrape_batches`
Individual batches within a session.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| session_id | INTEGER | Foreign key to scrape_sessions |
| batch_number | INTEGER | Batch number within the session |
| status | TEXT | 'pending', 'running', 'completed', 'failed', 'paused' |
| total_templates | INTEGER | Templates in this batch |
| processed_templates | INTEGER | Processed count |
| successful_templates | INTEGER | Success count |
| failed_templates | INTEGER | Failure count |
| skipped_templates | INTEGER | Skip count |

#### `batch_templates`
Individual templates within a batch with phase tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| batch_id | INTEGER | Foreign key to scrape_batches |
| session_id | INTEGER | Foreign key to scrape_sessions |
| template_url | TEXT | Storefront URL |
| template_slug | TEXT | Template slug |
| template_name | TEXT | Discovered template name |
| live_preview_url | TEXT | Live preview URL |
| status | TEXT | Current phase (see below) |
| phase_started_at | DATETIME | When current phase started |
| phase_duration_seconds | INTEGER | Seconds spent in current phase |
| error_message | TEXT | Error message if failed |

**Template Status Values:**
- `pending` - Waiting to be processed
- `scraping_details` - Extracting template metadata
- `taking_screenshot` - Capturing screenshot from live preview
- `processing_thumbnail` - Generating thumbnail
- `saving` - Saving to database
- `completed` - Successfully finished
- `failed` - Failed with error
- `skipped` - Manually skipped by admin

#### `template_blacklist`
Templates blocked from future scrapes.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Primary key |
| domain_slug | TEXT | Domain slug from live preview URL (unique) |
| storefront_url | TEXT | Optional reference URL |
| reason | TEXT | 'manual_skip', 'error_threshold', 'admin_blocked' |

#### `session_resume_points`
Enables resuming interrupted sessions.

| Column | Type | Description |
|--------|------|-------------|
| session_id | INTEGER | Foreign key to scrape_sessions |
| last_completed_batch_id | INTEGER | Last fully completed batch |
| last_completed_template_id | INTEGER | Last completed template |
| remaining_urls | TEXT | JSON array of unprocessed URLs |
| checkpoint_data | TEXT | Additional state data |

### API Endpoints

#### POST `/api/admin/batch`
Main batch control endpoint.

**Actions:**
- `start` - Start a new batch scrape session
- `pause` - Pause the current session
- `resume` - Resume a paused/interrupted session
- `stop` - Stop and cancel the current session
- `skip` - Skip a specific template

**Start Request:**
```json
{
  "action": "start",
  "urls": ["https://templates.webflow.com/html/..."],
  "sessionType": "update",
  "batchSize": 10,
  "concurrency": 5,
  "browserInstances": 2,
  "pagesPerBrowser": 5
}
```

**Skip Request:**
```json
{
  "action": "skip",
  "templateId": 123
}
```

#### GET `/api/admin/batch`
Returns current batch scraper status.

**Response:**
```json
{
  "isActive": true,
  "currentSessionId": 1,
  "hasInterruptedSession": false,
  "resumableSessions": []
}
```

#### GET `/api/admin/batch/progress/[sessionId]`
Returns detailed progress for a session.

**Response:**
```json
{
  "session": { /* ScrapeSession */ },
  "currentBatch": { /* ScrapeBatch */ },
  "batchTemplates": [ /* BatchTemplate[] */ ],
  "allBatches": [ /* ScrapeBatch[] */ ]
}
```

#### GET `/api/admin/batch/discover`
Discovers new templates without scraping.

**Response:**
```json
{
  "discovery": {
    "totalInSitemap": 500,
    "existingInDb": 450,
    "blacklisted": 5,
    "newCount": 45,
    "newTemplates": [
      { "url": "...", "slug": "...", "displayName": "..." }
    ]
  }
}
```

#### Blacklist API (`/api/admin/blacklist`)
- `GET` - List all blacklisted templates
- `POST` - Add template to blacklist
- `DELETE?domainSlug=xxx` - Remove from blacklist

### BatchScraper Class

The `BatchScraper` class (`lib/scraper/batch-scraper.ts`) extends EventEmitter and provides:

**Events:**
- `session-started` - When a new session begins
- `session-completed` - When session finishes successfully
- `session-paused` - When session is paused
- `session-resumed` - When session resumes
- `session-cancelled` - When session is stopped
- `batch-started` - When a batch begins processing
- `batch-completed` - When a batch finishes
- `template-phase-change` - When a template moves to a new phase
- `template-completed` - When a template finishes successfully
- `template-failed` - When a template fails
- `template-skipped` - When a template is skipped
- `log` - General logging events

**Methods:**
- `init()` - Initialize browser instances
- `close()` - Clean up resources
- `startBatchedScrape(sessionType, urls)` - Start a new session
- `resumeInterruptedSession()` - Resume an interrupted session
- `discoverNewTemplates()` - Discover new templates
- `requestSkip(templateId)` - Request to skip a template
- `pause()` - Pause the session
- `resume()` - Resume a paused session
- `stop()` - Stop the session

## User Interface

### Batch Scraper Section

The main admin dashboard section (`components/admin/sections/batch-scraper-section.tsx`) provides:

1. **Discovery Phase**
   - "Check for Updates" button to scan sitemap
   - Shows counts: sitemap total, database count, blacklisted, new templates
   - Preview list of new templates with external links

2. **Configuration Panel**
   - Batch size selector (5-50 templates)
   - Simple mode: concurrency selector
   - Advanced mode: browser instances + pages per browser

3. **Active Scrape Progress**
   - Overall session progress bar
   - Current batch progress
   - Template cards showing:
     - Template name/slug
     - Current phase with icon
     - Phase duration timer
     - Live preview link
     - Skip button

4. **Batch Overview**
   - Visual grid of all batches
   - Color-coded by status

5. **Controls**
   - Pause/Resume button
   - Stop button

### Blacklist Section

The blacklist management section (`components/admin/sections/blacklist-section.tsx`) provides:

1. **Add to Blacklist**
   - Input field for live preview URL
   - Automatic domain slug extraction

2. **Blacklist Browser**
   - Search/filter capability
   - Shows domain slug, storefront URL, reason, date
   - Remove from blacklist option

## Workflow

### Standard Update Flow

1. Admin clicks "Check for Updates"
2. System fetches Webflow sitemap
3. Compares against database and blacklist
4. Displays new templates for review
5. Admin configures batch size and concurrency
6. Admin clicks "Start Batch Scrape"
7. System creates session with sitemap snapshot
8. Creates batches with template entries
9. Processes batches sequentially
10. For each template:
    - Updates phase to `scraping_details`
    - Navigates to storefront page
    - Extracts template metadata
    - Updates phase to `taking_screenshot`
    - Navigates to live preview
    - Captures full-page screenshot
    - Updates phase to `processing_thumbnail`
    - Generates thumbnail
    - Updates phase to `saving`
    - Saves to database
    - Marks as `completed`
11. Updates batch/session counters after each template
12. Saves resume point after each batch
13. Marks session as completed

### Skip Flow

1. Admin sees unwanted template in progress
2. Clicks skip button on template card
3. System marks template as `skipped`
4. Extracts domain slug from live preview URL
5. Adds to blacklist with reason `manual_skip`
6. Template excluded from future discoveries

### Resume Flow

1. System detects interrupted session on startup
2. Banner displayed in admin dashboard
3. Admin clicks "Resume Session"
4. System finds last completed batch
5. Continues from next pending batch
6. Skips already-completed templates within batch
7. Continues normal processing

## Configuration

### Environment Variables

```env
SCRAPER_CONCURRENCY=5      # Default concurrent operations
SCRAPER_TIMEOUT=30000      # Page load timeout (ms)
SCREENSHOT_QUALITY=85      # WebP quality (0-100)
```

### Recommended Settings

**Local Development:**
- Batch Size: 5-10
- Concurrency: 3-5
- Browser Instances: 1

**Production (VPS):**
- Batch Size: 10-20
- Concurrency: 10-20
- Browser Instances: 2-4
- Pages per Browser: 5-10

## Technical Considerations

### Memory Management
- Browser contexts are recreated every 5 pages to prevent memory leaks
- Minimum 100ms delay between requests per worker

### Error Handling
- 3 retry attempts per template with adaptive wait strategies
- Failed templates don't block batch completion
- Errors logged with full details

### Database Performance
- Indexes on all foreign keys and status fields
- Progress updates batched where possible
- Session snapshots stored as compressed JSON

### Consistency
- Sitemap snapshot ensures consistent view of available templates
- Resume points stored after each batch completion
- Blacklist checked both at discovery and scrape time

## Troubleshooting

### Common Issues

**"A batch scrape is already in progress"**
- Only one batch scrape can run at a time
- Check for interrupted sessions that need resuming

**Templates not appearing in discovery**
- Check if they're blacklisted
- Verify they exist in Webflow sitemap
- Ensure they're not already in database

**Session stuck in "running" state**
- App may have been interrupted
- Use "Resume Session" to continue
- Or manually update session status to 'cancelled'

**High failure rate**
- Reduce concurrency
- Increase timeout
- Check network connectivity
- Verify Webflow isn't rate limiting
