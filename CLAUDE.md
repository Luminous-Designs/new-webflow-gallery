# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture Overview

This is a **Next.js 15 App Router** application - a Webflow template gallery with an integrated Playwright scraper for Luminous Web Design Agency.

**Source of truth documents:**
- `knowledge-base/12-18-25-architecture.md` - Canonical architecture and runbook
- `dynamic-knowledge-base/dynamic-knowledge-base.md` - AI agent institutional memory (update before ending sessions)

### Data Flow

- **Template metadata** → Supabase Postgres
- **Template screenshots** → Cloudflare R2 (stored as full URLs like `https://screenshots.luminardigital.com/slug.webp`)
- **Image URLs** → The scraper stores full R2 URLs directly in `screenshot_path`; `toAssetUrl()` in `lib/assets.ts` handles legacy paths

Screenshots upload directly to R2 during scraping - no local filesystem, no sync needed. Works identically on localhost and production.

## Commands

```bash
npm run dev          # Development server
npm run build        # Production build
npm run start        # Start production server
npm run lint         # ESLint

# Playwright (required for scraping)
npx playwright install chromium
```

## Required Environment Variables

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...    # Required for scraper + admin writes

# Cloudflare R2 Storage
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=webflow-screenshots
R2_PUBLIC_URL=https://screenshots.luminardigital.com

# Admin auth
ADMIN_PASSWORD=...
```

## Project Structure

```
app/
├── page.tsx                      # Public gallery + client onboarding
├── admin/page.tsx                # Admin dashboard
└── api/
    ├── templates/route.ts        # GET templates (cached 60s)
    └── admin/
        ├── fresh-scrape/route.ts          # Scraper planner/state
        └── fresh-scrape/execute/route.ts  # Scraper executor

components/
├── template-gallery.tsx          # Main gallery UI
└── admin/
    ├── admin-context.tsx         # Admin auth + state
    └── sections/                 # Dashboard sections

lib/
├── r2.ts                         # Cloudflare R2 upload utilities
├── assets.ts                     # toAssetUrl() - converts paths to R2 URLs
├── supabase/client.ts            # Supabase clients (supabase, supabaseAdmin)
└── scraper/
    ├── fresh-scraper.ts          # Main Playwright scraper (uploads to R2)
    ├── homepage-detector.ts      # Detect alternate homepages (/home-1)
    └── supabase-template-writer.ts  # Batched upserts
```

## Key Patterns

**Imports**: Use `@/*` alias (e.g., `import { toAssetUrl } from '@/lib/assets'`)

**Client components**: Add `'use client'` directive only for interactive components

**Admin API auth**: Protected via `Authorization: Bearer ${ADMIN_PASSWORD}`

**Supabase clients**:
- `supabase` - Public client (anon key)
- `supabaseAdmin` - Server-only (service role key, required for writes)

**Screenshot storage**:
- Scraper processes images in memory with Sharp
- Uploads directly to R2 via S3-compatible API
- Stores full R2 URL in `screenshot_path` column

## Database Schema (Supabase)

**Core tables:**
- `templates` - Metadata with `screenshot_path` as full R2 URL
- `template_subcategories`, `template_styles`, `template_features` - Junction tables
- `subcategories`, `styles`, `features` - Lookup tables
- `featured_authors`, `ultra_featured_templates` - Featured content

**Scraper state:**
- `fresh_scrape_state` - Job progress/config
- `fresh_scrape_screenshots` - Screenshot feed

## Scraper Modes

All via admin dashboard at `/admin`:

1. **Find updates** (`start_update`) - Incremental, scrapes missing templates
2. **Start from fresh** (`start_fresh`) - Destructive wipe + full re-scrape
3. **Re-screenshot all** (`start_rescreenshot_all`) - Update screenshots only

## Critical Points

1. **R2 configuration required** - Scraper will not start without valid R2 credentials

2. **Full URLs in database** - New screenshots are stored as full URLs (e.g., `https://screenshots.luminardigital.com/slug.webp`). Legacy paths like `/screenshots/slug.webp` are handled by `toAssetUrl()`.

3. **Service role key required** - Admin/scraper operations need `SUPABASE_SERVICE_ROLE_KEY`.

4. **No local filesystem for screenshots** - All screenshots go directly to R2.

5. **Cloudflare edge caching for read-only APIs** - `templates.luminardigital.com` uses Cloudflare Cache Rules to cache read-only endpoints like `/api/templates` and filter endpoints, while bypassing `/api/proxy` and `/api/admin`. See `docs/caching-setup.md` for the exact rules and verification steps.
