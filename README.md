# Modern Webflow Gallery - Luminous Web Design Agency

A comprehensive NextJS application for Luminous Web Design Agency featuring a Webflow template gallery, automated scraper, and complete client onboarding flow for website migration and redesign services.

## Features

### Template Gallery
- 🎨 Beautiful, responsive template gallery with lazy loading
- 🔍 Real-time search and filtering by subcategories
- 👁️ Live preview modal with desktop/mobile views
- 🎯 Featured authors section
- 🖼️ Auto-scrolling previews on hover
- ⚡ Optimized performance with infinite scroll

### Webflow Template Scraper
- 🤖 Automated scraping from Webflow's sitemap
- 📸 Full-page screenshots with animation handling
- 🗄️ Supabase Postgres for template metadata
- 🔄 Concurrent scraping with configurable speed
- 📊 Progress tracking and error handling
- 🖼️ WebP image optimization for storage efficiency

### Admin Dashboard
- 📈 Real-time statistics and monitoring
- 🎮 Scraper controls (full, update, single URL)
- 👤 Featured authors management
- 👥 Visitor tracking and analytics
- 💳 Purchase history tracking
- 💾 Storage management and metrics
- 🖥️ Console output for debugging

### Client Flow
- 📝 Business details form
- 📄 Digital contract with e-signature
- 💰 Automatic pricing calculation via sitemap analysis
- 💳 Stripe checkout integration (ready for implementation)
- 📧 Email notifications via Resend

## Tech Stack

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API Routes, Supabase (Postgres)
- **Scraping:** Playwright
- **Animations:** Framer Motion
- **Image Processing:** Sharp
- **Email:** Resend
- **Payment:** Stripe (ready for integration)

## Installation

1. Clone the repository:
```bash
git clone [your-repo-url]
cd modern-webflow-gallery
```

2. Install dependencies:
```bash
npm install
```

3. Install Playwright browsers:
```bash
npx playwright install chromium
```

4. Configure environment variables:
Copy `.env.local` and update:
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key

# Resend API Key (get from https://resend.com)
RESEND_API_KEY=your_resend_api_key_here

# Stripe API Keys (get from https://stripe.com)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key_here
STRIPE_SECRET_KEY=your_stripe_secret_key_here

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Where screenshots are served from (VPS)
# This is used even in localhost so images always come from the single source of truth.
NEXT_PUBLIC_ASSET_BASE_URL=https://templates.luminardigital.com

# Admin Password (change this!)
ADMIN_PASSWORD=your_secure_admin_password_here

# Email Settings
ADMIN_EMAIL=developer.luminous@gmail.com

# Scraper Settings
SCRAPER_CONCURRENCY=5
SCRAPER_TIMEOUT=30000
SCREENSHOT_QUALITY=85
```

5. Create required directories (only needed if you run the scraper locally):
```bash
mkdir -p public/screenshots
```

## Usage

### Development

Start the development server:
```bash
npm run dev
```

Visit `http://localhost:3000` to see the template gallery.

### Admin Dashboard

Access the admin dashboard at `http://localhost:3000/admin`

Use the password configured in your `.env.local` file.

### Initial Setup

1. **First Run:**
   - Go to the admin dashboard
   - Start a "Full Scrape" to populate the database with Webflow templates
   - This will take some time depending on your concurrency settings

2. **Featured Authors:**
   - After scraping, go to the "Featured Authors" tab
   - Select authors to feature in the gallery

3. **Monitor Progress:**
   - Use the Fresh Scraper section for progress, logs, and current batch status

### Scraper Modes (Admin)

- **Find updates (incremental):** scrape missing/updated templates from the Webflow sitemap
- **Start from fresh (destructive):** wipe Supabase template data + wipe screenshots, then re-scrape everything
- **Re-screenshot all (non-destructive):** regenerate screenshots for all existing Supabase templates without deleting metadata

### Performance Optimization

- Adjust `SCRAPER_CONCURRENCY` for faster/slower scraping
- Higher values use more resources but complete faster
- Recommended: 5-10 for good balance

## API Endpoints

- `GET /api/templates` - Fetch templates with pagination
- `GET /api/subcategories` - Get all subcategories
- `GET /api/styles` - Get all styles
- `GET /api/admin/stats` - Admin statistics
- `POST /api/admin/fresh-scrape` - Start/update scraper state (admin)
- `POST /api/admin/fresh-scrape/execute` - Execute scraper batches (admin)
- `GET /api/admin/featured-authors` - Manage featured authors
- `POST /api/calculate-pricing` - Calculate website migration cost
- `POST /api/send-inquiry` - Send email for large sites

## Data & Storage

- Template metadata lives in **Supabase**.
- Template screenshots live on the **VPS filesystem** and are served from `https://templates.luminardigital.com/screenshots/...`.
- The UI loads screenshots via `NEXT_PUBLIC_ASSET_BASE_URL` even on localhost.

## Deployment

### Production Build

```bash
npm run build
```

### VPS mount (production)

Ensure your container has a persistent mount:
- `/data/webflow-gallery/screenshots` → `/app/public/screenshots`

### Environment Variables

Ensure all production environment variables are set:
- Use strong passwords
- Configure real API keys
- Update `NEXT_PUBLIC_APP_URL` to your domain

## Maintenance

### Update Templates

Run periodic “Find updates” scrapes to fetch new/updated templates.

### Storage Management

Monitor storage usage in the admin dashboard and clean old screenshots if needed.

## Troubleshooting

### Scraper Issues

- Check console logs in admin dashboard
- Verify Playwright is installed: `npx playwright install`
- Adjust timeout settings if templates fail to load

### Supabase Errors

- Verify `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are set correctly.

### Image Loading

- Verify Next.js image domains in `next.config.ts`
- Verify `NEXT_PUBLIC_ASSET_BASE_URL` points at the VPS domain

## More documentation

- See `knowledge-base/12-18-25-architecture.md` for the canonical architecture and runbook.

## Future Enhancements

- [ ] Webhook support for real-time updates
- [ ] Advanced search with AI-powered recommendations
- [ ] Template comparison tool
- [ ] Automated email campaigns
- [ ] Analytics dashboard
- [ ] Multi-language support

## Support

For issues or questions, contact: developer.luminous@gmail.com

## License

Private - Luminous Web Design Agency
