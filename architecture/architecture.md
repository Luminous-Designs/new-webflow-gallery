# Dynamic Knowledge Base

> **For AI Agents**: Read this entire file before starting work. Update it before ending your session or when prompted. This is your institutional memory.

---

## Instructions for Agents

### When to Update This File
1. **End of every session** — Before you finish, log what you did and update the architecture snapshot if anything changed
2. **When prompted** — User may paste an update trigger mid-session
3. **After significant changes** — New dependencies, schema changes, new patterns, architectural decisions

### How to Update

**ARCHITECTURE SNAPSHOT (below)**: Keep this current. Replace outdated info, don't append. This should always reflect the *current* state of the project.

**SESSION LOG (bottom section)**: Prepend new entries at the top with timestamp. Never delete old entries.

### What to Log

For the **Architecture Snapshot**, maintain accurate info on:
- Tech stack with versions that matter
- Folder structure and conventions
- Entry points and build/run commands  
- Environment variables required
- Database schema (tables/collections, key relationships)
- API patterns (REST/GraphQL, auth, route conventions)
- Key dependencies and what they do
- Frontend state management (if applicable)
- Deployment/hosting setup

For **Session Logs**, include:
- What you worked on and why
- Files created/modified/deleted
- Decisions made and the reasoning
- Gotchas, bugs, or workarounds discovered
- New dependencies added (and why)
- Breaking changes or migration notes
- Unfinished work or TODOs left behind
- Anything the next agent would waste time rediscovering

---

## Architecture Snapshot

> ⚠️ Keep this section current. Update it, don't append to it.

### Tech Stack
- Next.js 15.5.3 (App Router) + React 19.1.0 + TypeScript 5.9
- Tailwind CSS 4
- Supabase Postgres (`@supabase/supabase-js` 2.88) for template metadata + admin state tables
- Cloudflare R2 (`@aws-sdk/client-s3` 3.x) for screenshot storage
- Playwright 1.55 for scraping/screenshot capture (Chromium)
- Sharp 0.34 for image processing (WebP output)

### Project Structure
```
/
├── app/                          # Next.js routes (pages + API)
│   ├── admin/page.tsx            # Admin dashboard entry
│   └── api/
│       ├── templates/route.ts    # Gallery read API (Supabase)
│       └── admin/
│           ├── fresh-scrape/route.ts          # Scrape planner/state + preflight (R2 check)
│           ├── fresh-scrape/execute/route.ts  # Scrape executor (batch runner)
│           ├── logs/route.ts                  # Logs page API (recent templates)
│           ├── featured-authors/route.ts      # Featured authors admin
│           └── ultra-featured/*               # Ultra-featured templates admin
├── components/
│   ├── template-gallery.tsx      # Public gallery UI
│   └── admin/sections/
│       ├── fresh-scraper-section.tsx          # Scraper UI (preflight + confirmations)
│       ├── logs-section.tsx                   # Admin "Logs" UI
│       ├── authors-section.tsx                # Featured authors UI
│       └── ultra-featured-section.tsx         # Ultra-featured UI (optimized)
├── lib/
│   ├── assets.ts                 # `toAssetUrl()` normalizes paths → R2 public URL
│   ├── r2.ts                     # Cloudflare R2 upload utilities (S3-compatible API)
│   ├── scraper/fresh-scraper.ts  # Playwright scraper + screenshot pipeline (uploads to R2)
│   ├── scraper/supabase-template-writer.ts    # Batched Supabase upserts
│   └── screenshot/
│       └── prepare.ts            # Page prep before screenshot
└── knowledge-base/               # Human docs; see 12-18-25-architecture.md
```

### Entry Points & Commands
- `npm run dev` (local dev)
- `npm run build` / `npm run start` (production build/run)
- Admin dashboard: `/admin` (password-gated via `Authorization: Bearer ${ADMIN_PASSWORD}` to admin APIs)

### Environment Variables
- `NEXT_PUBLIC_SUPABASE_URL` (Supabase project URL)
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public read key)
- `SUPABASE_SERVICE_ROLE_KEY` (server-side admin key; required for scraper + admin writes)
- `ADMIN_PASSWORD` (bearer token for admin API routes)

Cloudflare R2 (required for screenshot storage):
- `R2_ACCOUNT_ID` (Cloudflare account ID)
- `R2_ACCESS_KEY_ID` (R2 API token access key)
- `R2_SECRET_ACCESS_KEY` (R2 API token secret key)
- `R2_BUCKET_NAME` (R2 bucket name, e.g. `webflow-screenshots`)
- `R2_PUBLIC_URL` (public URL for screenshots, e.g. `https://screenshots.luminardigital.com`)

### Database Schema
Core:
- `templates` (template metadata; `screenshot_path` stores full R2 URL like `https://screenshots.luminardigital.com/slug.webp`)
- `featured_authors` (authors marked featured; drives template ordering)
- `ultra_featured_templates` (templates explicitly “Ultra Featured”)

Scraper state:
- `fresh_scrape_state` (job state/progress/config)
- `fresh_scrape_screenshots` (captures for the live feed; naming mismatch: column `screenshot_thumbnail_path` stores screenshot path)
- `screenshot_exclusions` (selectors to remove before capture)

Operational:
- `supabase_activity_log` (admin activity logging)

### API Patterns
- App Router route handlers (`app/api/**/route.ts`)
- Admin APIs are protected via `Authorization: Bearer ${ADMIN_PASSWORD}`
- Scraper is split:
  - Planner/state: `POST /api/admin/fresh-scrape` (+ `GET` for status/progress/screenshots/preflight)
  - Executor: `POST /api/admin/fresh-scrape/execute` (+ `GET ?action=events` for polling)
- Screenshots are uploaded directly to R2 during scraping (no sync needed)

### Key Dependencies
- `playwright`: browser automation + screenshot capture
- `sharp`: image conversion/resizing to WebP; tuned for memory efficiency
- `@supabase/supabase-js`: Supabase reads/writes (service role used server-side)
- `@aws-sdk/client-s3`: R2 uploads via S3-compatible API
- `sonner`: toast notifications in admin UI

### Frontend Architecture
- Public gallery and admin dashboard are client-rendered React components under `components/`
- Admin section routing is internal to the admin UI (sidebar + section switch)
- Scraper UI polls executor events every ~2s and lazily renders screenshot feed/windowed UI to avoid memory spikes

### Deployment
- Production runs on Vercel (or any Node.js host)
- Screenshots are stored in Cloudflare R2 and served via custom domain:
  - `https://screenshots.luminardigital.com/{slug}.webp`
- No filesystem mounts required - all screenshots go directly to R2

### Known Gotchas
- Screenshots are stored in R2 and loaded from the R2 public URL in both localhost and production.
- The scraper uploads directly to R2, so it works identically on localhost and production (no sync needed).
- `fresh_scrape_screenshots.screenshot_thumbnail_path` stores the full R2 URL (legacy column name).
- Legacy `/screenshots/slug.webp` paths in the database are handled by `toAssetUrl()` which converts them to full R2 URLs.

---

## Session Log

> ⚠️ Prepend new entries here. Newest first. Never delete old entries.

### 2025-12-20
- **Major: Migrated screenshot storage from VPS filesystem to Cloudflare R2**
  - Added `lib/r2.ts` with S3-compatible upload utilities using `@aws-sdk/client-s3`
  - Updated `lib/scraper/fresh-scraper.ts` to upload directly to R2 (no more VPS sync)
  - Updated `lib/assets.ts` to use `R2_PUBLIC_URL` as base URL
  - Added R2 write connectivity test to preflight checks
  - Removed all VPS-related sync code and environment variables
- Updated admin UI to show R2 storage status instead of VPS:
  - `fresh-scraper-section.tsx`: Changed preflight tile from "VPS Storage" to "R2 Storage"
  - `admin-overview.tsx`: Shows R2 connection status and bucket info
  - `admin-context.tsx` and `admin-sidebar.tsx`: Changed environment type from 'vps' to 'production'
  - `app/api/admin/system/route.ts`: Returns R2 config instead of filesystem stats
- Ran migration script to transfer ~16,000 screenshots from VPS to R2
- Updated `next.config.ts` to allow images from `screenshots.luminardigital.com`
- Deleted `lib/screenshot/sync.ts` (VPS sync is no longer needed)

### 2025-12-19
- Added scraper preflight + live confirmations UI so admins can validate Supabase/VPS/browser before scraping and track per-template Supabase + screenshot status.
- Fixed production 500s on admin data loads by ensuring admin APIs use `supabaseAdmin` (service role) and improved ultra-featured admin performance via batched metadata loading.
- Added Admin “Logs” page (recently added/updated templates) with actions: delete template + screenshot, mark ultra-featured, mark author featured.
- Fixed localhost scraping causing screenshot 404s: implemented VPS upload API `app/api/admin/screenshots/upload/route.ts` and added optional screenshot sync (localhost → VPS) in `lib/scraper/fresh-scraper.ts`.
- Updated preflight to check remote VPS storage when sync is enabled; added env var docs for `SCREENSHOT_SYNC_BASE_URL` / `SCREENSHOT_SYNC_TOKEN`.

---
```

---

## One-liner to paste mid-session
```
Update dynamic-knowledgebase.md now: Review what you've done this session, update the Architecture Snapshot with any changes to the codebase structure/patterns/dependencies, and prepend a new timestamped entry to the Session Log with what you worked on, decisions made, gotchas found, and anything unfinished.
```

Or a shorter version:
```
Pause and update dynamic-knowledgebase.md with your progress and any architectural changes.
