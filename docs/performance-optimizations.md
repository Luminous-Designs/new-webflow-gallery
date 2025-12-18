# Performance Optimizations

This document describes the server and client adjustments that were introduced to reduce memory pressure and CPU spikes when the gallery runs locally or on VPS installations.

## API Improvements

- `/api/templates`
  - Clamps `limit` to a maximum of 50 and normalises invalid paging input.
  - Projects only the fields consumed by the UI instead of loading entire template rows (specifically removes long HTML blobs such as `long_description`).
  - Keeps ultra-featured lookups lightweight by sharing the same projection.
- `/api/admin/ultra-featured`
  - Reuses the slim projection for both the curated list and the featured author pool to avoid transferring full template payloads to the dashboard.
- `/api/admin/stats`
  - Returns just the visitor columns rendered in the admin table and keeps the aggregate count separately (`activeVisitorsCount`).
  - Recent scrape jobs now load a limited column set.
- `/api/admin/system`
  - Recursively sums media directory sizes only once every 30 seconds and caches the result between calls, keeping disk/stat operations off the hot path.
- `/api/calculate-pricing`
  - Counts sitemap URLs without retaining every entry in memory, preventing the array growth seen on large sitemaps.

## Frontend Updates

- `TemplateGallery` normalises API responses so that only the fields used by the list are stored in component state, keeping the browser heap predictable during infinite scrolling.
- The admin dashboard refresh cadence for stats/system metrics was relaxed to 30 seconds now that the API responses are cheaper, providing headroom during scraping.

## Background Notes

- All adjustments are backwards compatible with the existing database schema; no migrations are required.
- The scraper subsystem relies on Playwright + Supabase writes. If scraper concurrency is increased, prefer tuning `SCRAPER_CONCURRENCY` and screenshot timing controls rather than adding heavier per-template queries.
- `npm run lint` reports pre-existing lint violations (unused imports, `<img>` usage, etc.). They are unchanged by these optimisations but are listed here for awareness.

Feel free to extend this document when new performance work lands so future maintainers can reason about trade-offs that have already been made.
