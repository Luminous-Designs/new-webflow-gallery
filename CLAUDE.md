# CLAUDE.md

Guidance for coding agents working in this repository.

## Canonical architecture

See `knowledge-base/12-18-25-architecture.md` for the source-of-truth architecture and runbook.

Key points:
- Template metadata lives in **Supabase Postgres**.
- Screenshots live on the **VPS filesystem** and are served from `https://templates.luminardigital.com/screenshots/...`.
- The UI loads screenshots via `NEXT_PUBLIC_ASSET_BASE_URL` even on localhost.
- The only supported scraper pipeline is **FreshScraper**.

## Commands

```bash
npm run dev
npm run build
npm run start
npm run lint

# Playwright (required for scraping)
npx playwright install chromium
```

## Required env vars

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Admin auth
ADMIN_PASSWORD=...

# Screenshot asset host (VPS)
NEXT_PUBLIC_ASSET_BASE_URL=https://templates.luminardigital.com
```

