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
- **Framework**: Next.js 15 with App Router
- **Language**: TypeScript with strict mode
- **Styling**: Tailwind CSS v4 with shadcn/ui components
- **Database**: SQLite3 with custom async wrapper
- **Scraping**: Playwright for automated template collection
- **Images**: Sharp for optimization, WebP format

### Directory Structure
- `/app` - Next.js App Router pages and API routes
  - `/api` - API endpoints for templates, admin, pricing
  - `/admin` - Protected admin dashboard
- `/components` - React components
  - `/ui` - shadcn/ui components
- `/lib` - Core utilities
  - `/db` - SQLite database wrapper and schema
  - `/scraper` - Webflow template scraping logic

### Database Architecture
The SQLite database (`./data/webflow.db`) uses a modular schema with these key tables:
- `templates` - Core template data with relationships
- `subcategories`, `styles`, `features` - Template metadata
- `featured_authors` - Author management
- `scrape_jobs` - Scraping job tracking
- `visitors`, `purchases` - Analytics and transactions

Database wrapper (`lib/db/index.ts`) provides:
- Async/await interface for sqlite3
- Automatic schema initialization
- Transaction support
- Connection pooling

### API Design Patterns
- REST endpoints in `/app/api/*`
- Consistent error handling with try-catch
- JSON responses with proper status codes
- Admin endpoints protected by password verification

### Scraping System
The scraper (`lib/scraper/webflow-scraper.ts`):
- Parses Webflow's sitemap for template URLs
- Uses Playwright for full-page screenshots
- Handles concurrent scraping with configurable workers
- Stores screenshots as WebP for efficiency
- Tracks progress in database

### Environment Configuration
Required environment variables:
```
DATABASE_PATH=./data/webflow.db
RESEND_API_KEY=<for email notifications>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<for payments>
STRIPE_SECRET_KEY=<for payments>
ADMIN_PASSWORD=<admin access>
SCRAPER_CONCURRENCY=5
```

### Component Patterns
- Client components use `"use client"` directive
- Server components fetch data directly
- Real-time updates via React Query
- Animations with Framer Motion
- Form handling with controlled components

### Image Handling
- Remote images from Webflow CDN configured in `next.config.ts`
- Local screenshots stored in `/public/screenshots`
- Thumbnails generated automatically
- Next/Image component for optimization

## Development Workflow

1. **Database Changes**: Modify `lib/db/schema.sql`, then restart app
2. **Component Development**: Use existing shadcn/ui components from `/components/ui`
3. **API Development**: Follow existing patterns in `/app/api`
4. **Scraping**: Test with single URL before full scrape

## Admin Features
Access admin at `/admin` with configured password:
- Real-time scraping controls
- Featured authors management
- Storage and database statistics
- Visitor analytics
- Console output for debugging