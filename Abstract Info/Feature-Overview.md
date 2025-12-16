# Modern Webflow Gallery – Feature Overview

## Audience Experience

### Curated Template Discovery
- Visitors arrive in a polished gallery that spotlights curated "ultra" picks, category filters, and trending tags so they can quickly narrow the template list to what fits their brand.【F:components/template-gallery.tsx†L158-L457】
- Each card auto-scrolls through the full screenshot on hover and clearly marks creators the agency wants to promote, making the browsing experience feel premium and guided.【F:components/template-gallery.tsx†L24-L150】

### Immersive Live Preview
- Selecting "Preview" opens a cinematic viewer with desktop/mobile toggles, back/forward controls, home reset, and tracking for load quality, letting prospects explore a template safely within the app before committing.【F:components/template-preview.tsx†L19-L200】

### Guided Project Intake
- Choosing a favorite template launches a multi-step flow: business profile collection, project goals, and other practical details that the team needs to start scoping work.【F:app/page.tsx†L242-L363】
- A digital service agreement spells out scope, turnaround, and revision policy, then captures an e-signature so the team has clear intent before investing effort.【F:app/page.tsx†L369-L447】

### Smart Pricing Assessment
- Prospects submit their existing site URL and the system scans the sitemap to estimate page count, automatically confirming standard pricing or flagging when a bespoke quote is required.【F:app/page.tsx†L136-L186】【F:app/page.tsx†L465-L532】
- When a project is too large for the flat rate, the app packages the intake details and notifies the team via email so a strategist can follow up with a tailored proposal.【F:app/page.tsx†L161-L177】【F:app/api/send-inquiry/route.ts†L1-L58】

### Streamlined Checkout Readiness
- Approved projects see an executive-ready order summary that separates migration and design work, then nudges the client toward Stripe for secure payment once the integration is enabled.【F:app/page.tsx†L540-L595】

### Continuous Journey Tracking
- Every visitor session is tagged and updated as they move from browsing to checkout, giving the team visibility into funnel drop-off points and template interest in real time.【F:app/page.tsx†L87-L210】【F:app/api/admin/stats/route.ts†L12-L61】

## Operations & Automation

### Automated Template Harvesting
- The admin console lets the team run full refreshes, incremental updates, or single URL scrapes from Webflow, adjusting concurrency with simple or advanced controls depending on available server power.【F:app/admin/page.tsx†L1495-L1636】
- Safety prompts prevent accidental data loss, and progress meters keep operators informed about successes, failures, and throughput while jobs run.【F:app/admin/page.tsx†L1650-L1702】
- Console streaming and job history tables give immediate feedback and a searchable paper trail for each scrape.【F:app/admin/page.tsx†L1706-L1760】

### Media & Asset Oversight
- A thumbnail queue tracks pending, running, and failed screenshot jobs so staff can confirm visual assets are ready before pushing updates live.【F:app/admin/page.tsx†L1381-L1481】

### Signature Curation Tools
- Featured author management keeps a short list of creators in rotation while offering a searchable pool of additional talent to spotlight when campaigns change.【F:app/admin/page.tsx†L1926-L1993】
- The "Ultra-Featured" workspace provides drag-and-drop staging, thumbnail previews, and ordering controls so the public gallery always reflects the agency's priorities.【F:app/admin/page.tsx†L1995-L2320】

### Insight-Rich Monitoring
- System health panels summarize CPU, memory, storage, and platform details with recommended scraper settings, helping operators right-size automation without guesswork.【F:app/admin/page.tsx†L1782-L1919】
- Live visitor tables show who is currently in the funnel, which step they occupy, and what template caught their eye, alongside 24-hour journey stats for quick pattern spotting.【F:app/admin/page.tsx†L2430-L2466】
- Purchase logs and storage reports keep finance and operations aligned on revenue events and infrastructure capacity.【F:app/admin/page.tsx†L2468-L2600】

### Data Portability & Safety Nets
- One-click export packages the entire dataset into a downloadable archive, while the guided import flow streams progress updates so migrations between environments stay under control.【F:app/admin/page.tsx†L1201-L1301】
- A dedicated health endpoint confirms database connectivity, app uptime, and inventory counts for external monitors or uptime bots.【F:app/api/health/route.ts†L1-L28】

## Customer Follow-Through

### Concierge Alerts
- When the automated pricing tool escalates a large site, the system crafts a well-formatted email—including selected template, timeline, and notes—so account managers receive everything they need to respond quickly.【F:app/api/send-inquiry/route.ts†L1-L58】

### Performance Telemetry
- Template previews report load quality back to the platform, feeding metrics the team can use to spot sluggish designs before they hurt conversions.【F:components/template-preview.tsx†L156-L179】
- Preview, API, and system metrics roll into the admin stats endpoint, powering dashboards that highlight response times, visitor flow, and template engagement over time.【F:app/api/admin/stats/route.ts†L12-L80】【F:components/admin/metrics-dashboard.tsx†L19-L128】

## Relationship Intelligence

### Visitor History & Attribution
- The platform stores session IDs, chosen templates, and last activity timestamps, allowing sales teams to reconnect with warm leads armed with concrete browsing behavior.【F:app/api/visitor/update/route.ts†L1-L40】【F:app/api/admin/stats/route.ts†L32-L61】

### Purchase & Pipeline Visibility
- Admins can review the latest buyers, payment amounts, and chosen templates in one table, ensuring fulfillment, finance, and onboarding teams stay coordinated without exporting spreadsheets.【F:app/admin/page.tsx†L2468-L2499】

