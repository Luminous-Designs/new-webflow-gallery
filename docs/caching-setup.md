# Caching Setup (Cloudflare + Next.js)

This project is deployed to a VPS (via Coolify) and served on `templates.luminardigital.com` behind Cloudflare (orange-cloud / proxied DNS). To reduce load on the VPS and improve responsiveness under concurrency, we cache **safe read-only** API responses at Cloudflare’s edge.

## What Is Cached

We cache only endpoints that are:
- `GET` only
- read-only
- safe to serve stale for a short period
- not user/session specific

### Cached at Cloudflare Edge

1) **Templates API** (high traffic, query-string dependent)
- Path: `/api/templates*`
- Notes: response varies by filters and pagination; cache key must include full query string
- Edge TTL: 60 seconds

2) **Filter/metadata APIs** (low churn)
- Paths:
  - `/api/subcategories`
  - `/api/styles`
  - `/api/primary-categories`
  - `/api/webflow-subcategories`
- Edge TTL: 5 minutes

## What Is NOT Cached

We explicitly bypass caching for:
- Admin endpoints: `/api/admin*`
- Live preview proxy: `/api/proxy*`
- Metrics/telemetry: `/api/metrics*`
- Visitor tracking: `/api/visitor*`
- Health checks: `/api/health`

These routes are dynamic, sensitive, or not safe to cache.

## Origin (App) Headers

The cached APIs return cache-friendly headers so that CDNs can store responses:
- `Cache-Control: public, max-age=0, s-maxage=… , stale-while-revalidate=…`
- `CDN-Cache-Control: public, max-age=0, s-maxage=… , stale-while-revalidate=…`

Cloudflare’s Cache Rules are still required to actually cache `/api/*` responses reliably; the headers enable correct TTL behavior and revalidation.

## Cloudflare Cache Rules (Dashboard)

Create these in Cloudflare for the zone that owns `templates.luminardigital.com`:

### Rule A — Bypass dynamic APIs (highest priority)
- If Hostname equals `templates.luminardigital.com` and URI Path matches any:
  - starts with `/api/admin`
  - starts with `/api/proxy`
  - starts with `/api/metrics`
  - starts with `/api/visitor`
  - equals `/api/health`
- Action: **Bypass cache**

### Rule B — Cache templates API
- If Hostname equals `templates.luminardigital.com` and URI Path starts with `/api/templates`
- Action: **Cache everything**
- Edge TTL: **60 seconds**
- Query strings: **Include all**

### Rule C — Cache filters API
- If Hostname equals `templates.luminardigital.com` and URI Path equals one of:
  - `/api/subcategories`
  - `/api/styles`
  - `/api/primary-categories`
  - `/api/webflow-subcategories`
- Action: **Cache everything**
- Edge TTL: **5 minutes**
- Query strings: **Ignore**

## Deployment Notes

- We deploy multiple times per day. Short edge TTLs (60s/5m) minimize the need to purge cache.
- If you ever need instant freshness after a change, you can purge Cloudflare cache for these paths, but it’s usually unnecessary.

## How To Verify Caching

In Chrome DevTools → Network, click a request and inspect response headers:

- First request should often be: `cf-cache-status: MISS`
- Reload should become: `cf-cache-status: HIT`
- You may also see a positive `age: …` header on HIT.

Example URLs to test:
- `https://templates.luminardigital.com/api/templates?page=1&limit=20`
- `https://templates.luminardigital.com/api/styles`

