# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Modern Webflow Gallery - A Next.js 15 application for Luminous Web Design Agency featuring a Webflow template gallery with automated scraping, admin dashboard, and client onboarding flow.

## Key Commands

```bash
# Development
npm run dev          # Start development server on localhost:3000
npm run build        # Build for production
npm run start        # Start production server
npm run lint         # Run ESLint

# Database setup (first run)
mkdir -p data public/screenshots public/thumbnails

# Playwright setup (required for scraper)
npx playwright install chromium
```

## Architecture

### Core Technologies
- **Framework**: Next.js 15 with App Router and Turbopack
- **Language**: TypeScript 5.9
- **Styling**: Tailwind CSS v4 with shadcn/ui components
- **Database**: SQLite3 with WAL mode and custom async wrapper
- **Scraping**: Playwright with multi-browser parallelization
- **Images**: Sharp for WebP optimization
- **State Management**: TanStack React Query

### Directory Structure
- `/app` - Next.js App Router pages and API routes
  - `/api` - API endpoints for templates, admin, pricing
  - `/admin` - Protected admin dashboard
- `/components` - React components
  - `/ui` - shadcn/ui components
- `/lib` - Core utilities
  - `/db` - SQLite database wrapper (`index.ts`) and schema (`schema.sql`)
  - `/scraper` - Webflow template scraping (supports batch, fresh, and single-URL modes)
  - `/screenshot` - Screenshot preparation and thumbnail queue processing
  - `/sync` - Platform synchronization utilities

### Database Architecture
The SQLite database (`./data/webflow.db`) uses WAL mode for concurrent access with:

**Core Tables:**
- `templates` - Template data with alternate homepage detection fields
- `subcategories`, `styles`, `features` - Template metadata (many-to-many via junction tables)
- `featured_authors`, `ultra_featured_templates` - Curation tables

**Scraping Tables:**
- `scrape_jobs`, `scrape_logs` - Simple job tracking
- `scrape_sessions`, `scrape_batches`, `batch_templates` - Batch scraping with pause/resume
- `fresh_scrape_state`, `fresh_scrape_screenshots` - Fresh scrape operations
- `template_blacklist` - Skip problematic templates

**Analytics Tables:**
- `visitors`, `purchases` - User tracking
- `system_metrics`, `api_metrics`, `preview_metrics`, `page_views`, `system_health`

Database wrapper (`lib/db/index.ts`) features:
- Async/await interface with retry logic for SQLITE_BUSY errors
- Write queue serialization to prevent lock contention
- Transactions with savepoint support for nesting
- Automatic schema initialization on startup

### Scraping System
Three scraping modes in `/lib/scraper/`:

1. **WebflowScraper** (`webflow-scraper.ts`) - Main scraper class
   - Fetches sitemap from `templates.webflow.com/sitemap.xml`
   - Only scrapes `/html/` URLs (skips category pages)
   - Multi-browser worker pool with round-robin distribution
   - Automatic retry with adaptive wait strategies (domcontentloaded → load → networkidle)
   - Homepage detection for templates with non-index landing pages

2. **BatchScraper** (`batch-scraper.ts`) - Pausable batch operations
3. **FreshScraper** (`fresh-scraper.ts`) - Full database rebuild with featured author priority

### Environment Configuration
Required variables:
```
DATABASE_PATH=./data/webflow.db
ADMIN_PASSWORD=<admin access>
NEXT_PUBLIC_ADMIN_PASSWORD=<client-side admin check>
RESEND_API_KEY=<for email notifications>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<for payments>
STRIPE_SECRET_KEY=<for payments>
SCRAPER_CONCURRENCY=5
SCRAPER_TIMEOUT=30000
SCREENSHOT_QUALITY=85
```

### API Patterns
- REST endpoints in `/app/api/*`
- Admin routes under `/api/admin/*` require password verification
- Progress streaming via dynamic route params (e.g., `/api/admin/scrape/progress/[jobId]`)
- EventEmitter pattern for real-time scraper progress

### Image Handling
- Remote images from `cdn.prod.website-files.com` and `*.webflow.io` configured in `next.config.ts`
- Screenshots stored as WebP in `/public/screenshots` (1000px width)
- Thumbnails stored as WebP in `/public/thumbnails` (500x500 square crop from top)
- Element exclusions configurable via `screenshot_exclusions` table

## Development Workflow

1. **Database Changes**: Modify `lib/db/schema.sql`, delete `data/webflow.db`, restart app
2. **Adding API Endpoints**: Follow pattern in existing routes, use `db.runAsync`/`db.getAsync`/`db.allAsync`
3. **Scraping**: Test with single URL via admin dashboard before full scrape
4. **Component Development**: Use existing shadcn/ui components from `/components/ui`

## Admin Dashboard (`/admin`)
Password-protected access with tabs for:
- Scraping controls (full, update, single URL, fresh scrape)
- Featured/ultra-featured template management
- Screenshot exclusion rules
- Storage and database statistics
- Template blacklist management
- System metrics and health
- VPS Image Sync management

## VPS Image Sync System

### Overview
The VPS sync system (`/lib/sync/`) enables cross-platform synchronization of screenshots and thumbnails between local development machines and the VPS production server using `rsync` over SSH.

### Platform Support
The system auto-detects the platform and available tools (`lib/sync/platform.ts`):

**Windows:**
- Uses Windows OpenSSH (built-in since Windows 10)
- Supports cwRsync, Git Bash rsync, MSYS2, or Cygwin for rsync
- Automatically handles path conversions (`C:\` → `/cygdrive/c/` for cwRsync)
- SSH key typically at `~/.ssh/id_ed25519` or `C:\Users\<name>\.ssh\id_ed25519`

**macOS/Linux:**
- Uses standard `ssh` and `rsync` commands
- SSH key typically at `~/.ssh/id_ed25519`

### VPS Configuration
Default settings (configurable in admin UI):
```
VPS Host: 178.156.177.252
User: root
Remote Path: /data/webflow-gallery
SSH Key: ~/.ssh/id_ed25519
```

Remote directory structure:
- `/data/webflow-gallery/screenshots/` - Full-size screenshot WebP files
- `/data/webflow-gallery/thumbnails/` - Thumbnail WebP files

### Sync Operations
Three sync directions available:
1. **Push**: Upload local images to VPS (after scraping new templates)
2. **Pull**: Download VPS images to local (for new dev environment setup)
3. **Bidirectional**: Sync both ways with newest-wins conflict resolution

### Delete Excess Files Feature
Cleans up orphaned images on the VPS that have no corresponding template in the SQLite database.

**Source of Truth**: The SQLite database is always the source of truth. Files on VPS are compared against template slugs in the database.

**How it works**:
1. Queries all template slugs from SQLite database
2. Lists all files on VPS via SSH
3. Identifies files on VPS with no matching template (orphaned)
4. Deletes orphaned files in batches of 100 via SSH

**API Endpoints** (`/api/admin/sync`):
- `GET ?action=analyze-excess` - Analyze VPS for excess files
- `GET ?action=delete-excess-status` - Get deletion progress
- `POST action=delete-excess` - Start deletion of excess files
- `POST action=clear-delete-progress` - Clear deletion state

**File naming convention**:
- Screenshots: `{slug}.webp`
- Thumbnails: `{slug}_thumb.webp`

### API Reference (`/api/admin/sync`)
**GET Actions:**
- `status` - Current sync operation status
- `test-connection` - Test VPS SSH connectivity
- `local-stats` - Local file counts and sizes
- `vps-stats` - VPS file counts and sizes
- `compare` - Full comparison with discrepancies
- `platform` - Re-detect platform and tools
- `analyze-excess` - Find orphaned files on VPS

**POST Actions:**
- `start` - Start rsync (requires `direction`: push/pull/bidirectional)
- `pause` - Pause running sync
- `stop` - Stop running sync
- `clear` - Clear sync session
- `delete-excess` - Delete orphaned files from VPS