# 12-18-25 Architecture (Webflow Template Gallery + Scraper)

This repo is a **Webflow template gallery** (Next.js) with an **admin-controlled scraper** (Playwright) that keeps Supabase metadata and VPS-hosted screenshots up to date.

This document is the “source of truth” for future developers and AI agents working on this codebase.

---

## Canonical setup (what “correct” means)

### Source of truth

- **Template metadata**: Supabase Postgres (`templates`, tags/joins, featured authors, etc.).
- **Template images**: **VPS filesystem**, served as static files from:
  - `https://templates.luminardigital.com/screenshots/{slug}.webp`

### Key rule

On both **localhost** and **production**, the UI should:

- Read template rows from Supabase (via server API routes).
- Load screenshots from the **VPS asset domain**, not from local `/public`.

This ensures screenshots live in **exactly one place**.

---

## System components

### 1) Next.js app (gallery + admin)

- App Router: `app/*`
- Gallery page: `app/page.tsx` + `components/template-gallery.tsx`
- Templates API (Supabase read): `app/api/templates/route.ts`
- Admin UI: `app/admin/page.tsx` + `components/admin/*`

### 2) Supabase (metadata)

Supabase holds the template catalog, tagging tables, and scraper state tables.

Env (required):
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (required for scraping/writes and most admin operations)

The code uses:
- `lib/supabase/client.ts` (`supabase`, `supabaseAdmin`)
- `lib/scraper/supabase-template-writer.ts` (batch upserts during scraping)

### 3) VPS filesystem (screenshots)

Production uses a persistent mount so screenshots survive container rebuilds.

The scraper writes screenshots to:
- `process.cwd()/public/screenshots` → `public/screenshots/{slug}.webp`

In production containers, `public/screenshots` should be a mounted volume.

---

## Coolify / VPS volume mounts (required changes)

### Keep (required)

- **Screenshots**
  - VPS host: `/data/webflow-gallery/screenshots`
  - Container: `/app/public/screenshots`

### Remove (deprecated)

This project no longer uses “thumbnails”.

- **Thumbnails** (remove the mount)
  - VPS host: `/data/webflow-gallery/thumbnails`
  - Container: `/app/public/thumbnails`

After removing the mount, you can delete the directory on the VPS host if it exists:
- `/data/webflow-gallery/thumbnails`

---

## “Screenshots” vs “Thumbnails”

### Current decision

- The product uses **one wide screenshot per template**, stored in Supabase as:
  - `templates.screenshot_path` (example: `/screenshots/{slug}.webp`)
- The UI renders **only** `screenshot_path`.

### Legacy columns/tables

Supabase may still contain legacy columns like `templates.screenshot_thumbnail_path`. The app does not use them anymore.

Also, the table `fresh_scrape_screenshots` historically used a column named `screenshot_thumbnail_path`; the current code stores the **screenshot path** there (naming mismatch).

---

## How image URLs work (critical)

Supabase stores `templates.screenshot_path` as a **relative** path like:
- `/screenshots/{slug}.webp`

The UI always normalizes image URLs with:
- `lib/assets.ts` → `toAssetUrl(pathOrUrl)`

Behavior:
- Absolute URLs are returned as-is.
- Paths starting with `/screenshots/` are prefixed with `NEXT_PUBLIC_ASSET_BASE_URL`.
- Default asset base URL is `https://templates.luminardigital.com`.

Env:
- `NEXT_PUBLIC_ASSET_BASE_URL=https://templates.luminardigital.com`

Result:
- Localhost still loads: `https://templates.luminardigital.com/screenshots/{slug}.webp`

---

## Scraper architecture (FreshScraper)

### Primary scraper

- Implementation: `lib/scraper/fresh-scraper.ts`
- Screenshot prep: `lib/screenshot/prepare.ts`
- “Find the real homepage” logic: `lib/scraper/homepage-detector.ts`

FreshScraper does:
1) Fetch storefront URL(s) from the Webflow sitemap or Supabase (mode-dependent).
2) Extract metadata and the best live preview URL.
3) Detect alternate homepages (e.g. `/home-1`) before capturing.
4) Capture a viewport screenshot and write:
   - `public/screenshots/{slug}.webp`
5) Upsert template metadata + `screenshot_path` into Supabase.

### Admin endpoints

- Planner/state: `POST app/api/admin/fresh-scrape/route.ts`
- Executor (Playwright runner): `POST app/api/admin/fresh-scrape/execute/route.ts`
- Admin UI: `components/admin/sections/fresh-scraper-section.tsx`

### Supported modes

All modes are initiated via `POST /api/admin/fresh-scrape` and executed in batches by the admin UI.

1) **Find updates** (incremental)
   - `action: "start_update"` (primary)
   - `action: "start"` (alias)
   - Scrapes only missing/updated templates from sitemap vs Supabase.

2) **Start from fresh** (destructive)
   - `action: "start_fresh"` with `confirm: "DELETE_ALL"`
   - Deletes template data from Supabase (and related tables) and wipes `public/screenshots` on the running server.

3) **Re-screenshot all templates** (no Supabase deletion)
   - `action: "start_rescreenshot_all"`
   - optional wipe: `wipeImages: true` with `confirm: "WIPE_SCREENSHOTS"` (legacy confirm `WIPE_IMAGES` is still accepted)
   - Uses scraper `jobMode: "screenshots_only"` to update screenshot fields only.

---

## Operational guidance

### Production

- Run the scraper on the VPS (inside the deployed app/container).
- Confirm `/app/public/screenshots` is mounted to `/data/webflow-gallery/screenshots` on the host.
- The website serves screenshots at:
  - `https://templates.luminardigital.com/screenshots/...`

### Localhost

- The gallery still loads screenshots from the VPS domain (single source of truth).
- Running the scraper locally will only write to your local `public/screenshots` and will not update the VPS unless you manually sync (not recommended).

---

## What was removed (cleanup performed)

- SQLite database wrapper and schema (`lib/db/*`)
- Legacy scrapers (`lib/scraper/webflow-scraper.ts`, `lib/scraper/batch-scraper.ts`)
- Thumbnail job subsystem (`lib/screenshot/thumbnail-queue.ts`, related admin APIs/UI)
- SQLite→Supabase migration script (`scripts/migrate-to-supabase.ts`)
- Thumbnail generation/config in FreshScraper and admin UI

---

## Remaining tasks (recommended)

### 1) Supabase schema cleanup (optional but recommended)

- Drop `templates.screenshot_thumbnail_path` if truly unused.
- Rename `fresh_scrape_screenshots.screenshot_thumbnail_path` → `screenshot_path` (data + code) to remove naming confusion.
- Remove legacy/unused tables if you’re confident nothing depends on them:
  - `thumbnail_jobs`, `scrape_jobs`, `scrape_logs`, `scrape_sessions`, `scrape_batches`, `batch_templates`, `session_resume_points`

### 2) Screenshot directory hygiene (recommended)

Add a safe “cleanup orphan screenshots” tool that:
- Lists and/or deletes files in `public/screenshots` that don’t correspond to any current `templates.slug`.

### 3) Screenshot fidelity improvements (optional)

- Consider `fullPage: true` screenshots if you want true full-page captures (bigger images + slower).
- Keep tuning `homepage-detector.ts` patterns as Webflow templates evolve.

### 4) Security hygiene (recommended)

- Ensure `SUPABASE_SERVICE_ROLE_KEY` is present only in runtime secrets (never committed).
- Review `deploy.sh` and other scripts for hardcoded infra details if this repo is ever made public.

---

## Glossary

- **Storefront URL**: `https://templates.webflow.com/html/{slug}` (Webflow listing page)
- **Live preview URL**: `https://{domain}.webflow.io` (actual template site)
- **Alternate homepage**: when the real homepage isn’t `/` (e.g. `/home-1`)
- **Gallery image**: `templates.screenshot_path` → `/screenshots/{slug}.webp`

