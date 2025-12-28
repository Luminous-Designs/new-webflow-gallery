# Cloudflare Caching (Coolify VPS)

Cloudflare will not reliably cache JSON/API responses just because DNS is “Proxied”. For `/api/*`, you typically need **Cache Rules** (or Page Rules) to tell Cloudflare to cache, and your origin should send cacheable headers.

This repo already sets CDN-friendly cache headers on safe read-only endpoints:
- `/api/templates` (short TTL, frequently queried, query-string dependent)
- `/api/subcategories`
- `/api/styles`
- `/api/primary-categories`
- `/api/webflow-subcategories`

## Recommended Cache Rules

Create these in **Cloudflare Dashboard → Caching → Cache Rules** for `templates.luminardigital.com`.

### 1) Cache the templates API (edge)

- **If URL matches:** `templates.luminardigital.com/api/templates*`
- **Cache eligibility:** Cache everything
- **Edge TTL:** 60 seconds
- **Browser TTL:** Respect existing headers (or set to 0)
- **Query string:** Include all (the response varies by `page`, filters, etc.)

### 2) Cache filter/metadata APIs (edge)

- **If URL matches:** any of:
  - `templates.luminardigital.com/api/subcategories`
  - `templates.luminardigital.com/api/styles`
  - `templates.luminardigital.com/api/primary-categories`
  - `templates.luminardigital.com/api/webflow-subcategories`
- **Cache eligibility:** Cache everything
- **Edge TTL:** 5 minutes
- **Browser TTL:** Respect existing headers (or set to 0)
- **Query string:** Ignore (these endpoints do not use query params)

### 3) Explicitly bypass non-cacheable APIs

- **If URL matches:** `templates.luminardigital.com/api/admin*`
  - **Cache:** Bypass
- **If URL matches:** `templates.luminardigital.com/api/proxy*`
  - **Cache:** Bypass (do not cache the live preview proxy)
- **If URL matches:** `templates.luminardigital.com/api/metrics*`
  - **Cache:** Bypass
- **If URL matches:** `templates.luminardigital.com/api/visitor*`
  - **Cache:** Bypass
- **If URL matches:** `templates.luminardigital.com/api/health`
  - **Cache:** Bypass

## Notes

- These rules reduce load on your VPS and on Supabase by serving many requests directly from Cloudflare’s edge.
- Because you deploy frequently, prefer **short Edge TTLs** (60s/5m). That minimizes the need to purge cache on deploy.
- If you want instant updates after an admin change, keep TTLs short or add a “purge cache” step in your deploy pipeline (optional).

