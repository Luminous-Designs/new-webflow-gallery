# Infrastructure and Deployment Architecture

## Technical Documentation for Developers and LLMs

**Last Updated:** November 2024
**Application:** Modern Webflow Gallery
**Stack:** Next.js 15, SQLite, Playwright, Coolify, Hetzner VPS

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Data Classification](#data-classification)
3. [VPS Infrastructure](#vps-infrastructure)
4. [Image Storage Strategy](#image-storage-strategy)
5. [rsync Configuration](#rsync-configuration)
6. [Coolify Deployment](#coolify-deployment)
7. [Git Repository Structure](#git-repository-structure)
8. [Deployment Pipeline](#deployment-pipeline)
9. [Scraping Workflow](#scraping-workflow)
10. [Troubleshooting](#troubleshooting)

---

## Architecture Overview

### System Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOCAL DEVELOPMENT MACHINE                          │
│                                                                              │
│  ┌────────────────────┐    ┌────────────────────┐    ┌──────────────────┐  │
│  │   Playwright       │    │   SQLite Database   │    │   Next.js App    │  │
│  │   Scraper          │───▶│   ./data/webflow.db │◀───│   localhost:3000 │  │
│  │                    │    │                     │    │                  │  │
│  └────────────────────┘    └────────────────────┘    └──────────────────┘  │
│           │                                                                  │
│           ▼                                                                  │
│  ┌────────────────────────────────────────────┐                             │
│  │   Local Filesystem                          │                             │
│  │   ./public/screenshots/  (7,454 files, 1.5GB)                            │
│  │   ./public/thumbnails/   (7,454 files, 126MB)                            │
│  └────────────────────────────────────────────┘                             │
│           │                           │                                      │
│           │ rsync (SSH)               │ git push                            │
│           ▼                           ▼                                      │
└───────────┼───────────────────────────┼─────────────────────────────────────┘
            │                           │
            │                           │
            ▼                           ▼
┌───────────────────────┐    ┌───────────────────────────────────────────────┐
│   HETZNER VPS         │    │                 GITHUB                         │
│   178.156.177.252     │    │   Luminous-Designs/modern-webflow-gallery     │
│                       │    │                                                │
│  /data/webflow-gallery│    │   - Source code                               │
│    /screenshots/      │    │   - ./data/webflow.db                         │
│    /thumbnails/       │    │   - NO images (in .gitignore)                 │
│                       │    │                                                │
│  Persistent storage   │    └──────────────────┬────────────────────────────┘
│  survives redeploys   │                       │
└───────────┬───────────┘                       │ Webhook trigger
            │                                   │
            │ Docker volume mount               ▼
            │                        ┌───────────────────────────────────────┐
            │                        │            COOLIFY                     │
            │                        │                                        │
            │                        │   Auto-build on push                  │
            │                        │   Docker container deployment         │
            │                        │   Traefik reverse proxy               │
            └───────────────────────▶│                                        │
                                     │   Volume mounts:                      │
                                     │   /data/.../screenshots → /app/public/│
                                     │   /data/.../thumbnails → /app/public/ │
                                     └───────────────────────────────────────┘
```

### Key Design Decisions

1. **Separation of Static and Dynamic Data**: Images (static, large) are synced via rsync; code and database (dynamic, small) go through git.

2. **Local Scraping**: Compute-intensive Playwright scraping runs locally, not on the VPS, to avoid resource constraints.

3. **Persistent Volume Storage**: Images stored outside Docker containers to survive redeployments.

4. **No External Object Storage**: Deliberately avoiding S3/R2 to minimize third-party dependencies and costs.

---

## Data Classification

### Static Data (Scrape-Generated)

| Data Type | Location | Size | Sync Method |
|-----------|----------|------|-------------|
| Template screenshots | `./public/screenshots/*.webp` | ~1.5 GB | rsync |
| Template thumbnails | `./public/thumbnails/*.webp` | ~126 MB | rsync |
| Template metadata | `./data/webflow.db` (templates table) | ~20 MB | git |
| Categories/Styles | `./data/webflow.db` (lookup tables) | ~2 MB | git |

### Dynamic Data (Runtime-Generated)

| Data Type | Location | Generated By |
|-----------|----------|--------------|
| Visitor sessions | `visitors` table | User interactions |
| Purchases | `purchases` table | Checkout flow |
| Metrics | `*_metrics` tables | Application telemetry |
| Featured config | `featured_authors`, `ultra_featured_templates` | Admin dashboard |

**Important**: Dynamic data is currently stored in the same SQLite database as static data. This creates a sync challenge (see [Future Considerations](#future-considerations)).

---

## VPS Infrastructure

### Server Specifications

```
Provider: Hetzner
Hostname: ubuntu-8gb-ash-1
IP Address: 178.156.177.252
OS: Ubuntu (Linux)
RAM: 8 GB
Storage: 150 GB SSD
Available: ~129 GB free
```

### Directory Structure

```
/
├── data/
│   └── coolify/
│       ├── applications/
│       │   └── eokg8cccosgosgwss4wg40o8/    # This project
│       │       ├── docker-compose.yaml
│       │       └── .env
│       ├── proxy/         # Traefik configuration
│       ├── databases/     # PostgreSQL for Coolify
│       └── ...
│
└── data/
    └── webflow-gallery/   # PERSISTENT IMAGE STORAGE
        ├── screenshots/   # 7,454 WebP files, 1.6 GB
        └── thumbnails/    # 7,454 WebP files, 126 MB
```

### Docker Container Details

```yaml
Container Name: eokg8cccosgosgwss4wg40o8-161516463639
Image: eokg8cccosgosgwss4wg40o8:<commit-hash>
Port: 3000 (internal)
Network: coolify (Docker network)
Reverse Proxy: Traefik v3.1
```

### SSH Access

```bash
# Connection details
Host: 178.156.177.252
User: root
Auth: Password (Poicxz12!!)
Port: 22 (default)

# Example connection
ssh root@178.156.177.252
```

---

## Image Storage Strategy

### Why Not Git for Images?

1. **Repository Size**: Git stores full history; 1.7GB of images = multi-GB repo over time
2. **Clone Time**: Every `git clone` downloads all images
3. **GitHub Limits**: Soft limit 5GB, push limit 2GB per push
4. **Deploy Speed**: Coolify rebuilds from git; smaller repo = faster deploys

### Why Not S3/R2?

1. **Simplicity**: No additional service to manage
2. **Cost**: Free (uses existing VPS storage)
3. **Latency**: Images served from same server as app
4. **Scale**: Not needed for expected 10 concurrent users

### Current Solution: rsync + Persistent Volumes

```
Local Machine                    VPS
┌──────────────┐    rsync       ┌──────────────────────────────┐
│ public/      │ ─────────────▶ │ /data/webflow-gallery/       │
│  screenshots/│                │   screenshots/               │
│  thumbnails/ │                │   thumbnails/                │
└──────────────┘                └──────────────┬───────────────┘
                                               │
                                               │ Docker volume mount
                                               ▼
                                ┌──────────────────────────────┐
                                │ Container: /app/public/      │
                                │   screenshots/ (mounted)     │
                                │   thumbnails/  (mounted)     │
                                └──────────────────────────────┘
```

### Image Specifications

| Type | Format | Dimensions | Quality | Avg Size |
|------|--------|------------|---------|----------|
| Screenshot | WebP | ~1000px width, variable height | 85% | ~200 KB |
| Thumbnail | WebP | 500x500px (cropped from top) | 75% | ~17 KB |

---

## rsync Configuration

### What is rsync?

rsync is a file synchronization utility that:
- Transfers only changed/new files (delta sync)
- Compresses data during transfer
- Preserves file attributes
- Works over SSH

### Command Syntax

```bash
rsync [options] source destination
```

### Production Commands

```bash
# Sync screenshots (local → VPS)
rsync -avz --progress \
  public/screenshots/ \
  root@178.156.177.252:/data/webflow-gallery/screenshots/

# Sync thumbnails (local → VPS)
rsync -avz --progress \
  public/thumbnails/ \
  root@178.156.177.252:/data/webflow-gallery/thumbnails/
```

### Flag Explanation

| Flag | Meaning |
|------|---------|
| `-a` | Archive mode: preserves permissions, timestamps, symlinks, etc. |
| `-v` | Verbose: shows files being transferred |
| `-z` | Compress: compresses data during transfer (faster for slow connections) |
| `--progress` | Shows transfer progress for each file |
| `--delete` | (Optional) Delete files on destination that don't exist on source |
| `--dry-run` | (Optional) Preview what would be transferred without actually doing it |

### Important Notes

1. **Trailing Slash Matters**:
   - `public/screenshots/` (with slash) = sync contents of directory
   - `public/screenshots` (no slash) = sync the directory itself

2. **First Sync**: Takes longer as all files are transferred
3. **Subsequent Syncs**: Only new/modified files transferred (fast)

### Dry Run (Preview)

```bash
rsync -avz --dry-run --stats \
  public/screenshots/ \
  root@178.156.177.252:/data/webflow-gallery/screenshots/
```

---

## Coolify Deployment

### Project Identification

```
Project Name: luminous-designsmodern-webflow-gallerymain-eokg8cccosgosgwss4wg40o8
Container ID: eokg8cccosgosgwss4wg40o8-161516463639
Application ID: 1
Environment: production
```

### Volume Mount Configuration

In Coolify dashboard, under the application's **Persistent Storage** settings:

| Volume Name | Source (Host Path) | Destination (Container Path) |
|-------------|-------------------|------------------------------|
| `webflow-screenshots` | `/data/webflow-gallery/screenshots` | `/app/public/screenshots` |
| `webflow-thumbnails` | `/data/webflow-gallery/thumbnails` | `/app/public/thumbnails` |

### How Volume Mounts Work

```yaml
# Equivalent docker-compose configuration
services:
  app:
    image: eokg8cccosgosgwss4wg40o8:latest
    volumes:
      - /data/webflow-gallery/screenshots:/app/public/screenshots
      - /data/webflow-gallery/thumbnails:/app/public/thumbnails
```

When the container starts:
1. Docker mounts the host directories into the container
2. Container sees files at `/app/public/screenshots/`
3. Next.js serves these as static files at `/screenshots/`
4. Files persist even when container is destroyed/recreated

### Environment Variables

Set in Coolify or `.env` file:

```env
DATABASE_PATH=./data/webflow.db
RESEND_API_KEY=<email service key>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<stripe public key>
STRIPE_SECRET_KEY=<stripe secret key>
ADMIN_PASSWORD=<admin dashboard password>
SCRAPER_CONCURRENCY=5
```

---

## Git Repository Structure

### What's Tracked in Git

```
modern-webflow-gallery/
├── app/                    # Next.js app router
├── components/             # React components
├── lib/                    # Utilities, DB wrapper, scraper
├── public/
│   ├── *.svg              # Static assets (tracked)
│   ├── screenshots/       # NOT TRACKED (.gitignore)
│   └── thumbnails/        # NOT TRACKED (.gitignore)
├── data/
│   └── webflow.db         # SQLite database (tracked)
├── .gitignore
├── deploy.sh              # Deployment script
├── package.json
└── ...
```

### .gitignore Configuration

```gitignore
# screenshots and uploads
public/screenshots/
public/thumbnails/

# database (optional - currently tracked)
# data/
# *.db
```

### Repository Size

| Before | After |
|--------|-------|
| ~1.7 GB (with images) | ~40 MB (without images) |

---

## Deployment Pipeline

### Automated Flow (Git Push → Production)

```
1. Developer pushes to main branch
          │
          ▼
2. GitHub receives push
          │
          ▼
3. Webhook triggers Coolify
          │
          ▼
4. Coolify pulls latest code
          │
          ▼
5. Docker builds new image
   - npm install
   - npm run build
   - Creates optimized production build
          │
          ▼
6. Coolify stops old container
          │
          ▼
7. Coolify starts new container
   - Mounts persistent volumes
   - Connects to Docker network
          │
          ▼
8. Traefik routes traffic to new container
          │
          ▼
9. Application live with new code
   - Images served from persistent storage
   - Database file from git
```

### Manual Deploy Script (`deploy.sh`)

```bash
#!/bin/bash

# Configuration
VPS_USER="root"
VPS_HOST="178.156.177.252"
VPS_IMAGE_PATH="/data/webflow-gallery"

# Step 1: Sync screenshots
rsync -avz --progress \
  public/screenshots/ \
  ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/screenshots/

# Step 2: Sync thumbnails
rsync -avz --progress \
  public/thumbnails/ \
  ${VPS_USER}@${VPS_HOST}:${VPS_IMAGE_PATH}/thumbnails/

# Step 3: Git operations (optional, interactive)
git add -A
git commit -m "Update templates"
git push origin main
```

---

## Scraping Workflow

### Process Overview

```
1. Run scraper locally (npm run dev → admin dashboard)
          │
          ▼
2. Playwright fetches Webflow sitemap
   URL: https://templates.webflow.com/sitemap.xml
          │
          ▼
3. For each template URL:
   a. Navigate to template page
   b. Extract metadata (name, price, author, etc.)
   c. Take full-page screenshot
   d. Generate 500x500 thumbnail
   e. Save to database and filesystem
          │
          ▼
4. After scraping completes:
   - ./public/screenshots/ has new images
   - ./data/webflow.db has new records
          │
          ▼
5. Run deploy.sh to sync to production
```

### Scraper Configuration

```typescript
// lib/scraper/webflow-scraper.ts
const config = {
  concurrency: 5,              // Parallel browser pages
  browserInstances: 1,         // Chromium instances
  pagesPerBrowser: 5,          // Pages per browser
  timeout: 30000,              // 30 seconds per page
  screenshotQuality: 85,       // WebP quality (0-100)
};
```

### Screenshot Generation

```typescript
// Simplified flow
1. page.goto(template.live_preview_url)
2. page.waitForLoadState('networkidle')
3. page.screenshot({ type: 'jpeg', quality: 85, fullPage: true })
4. sharp(buffer).webp({ quality: 85 }).toFile(`screenshots/${slug}.webp`)
5. sharp(buffer).resize(500, 500).webp({ quality: 75 }).toFile(`thumbnails/${slug}_thumb.webp`)
```

---

## Troubleshooting

### Images Not Loading After Deploy

**Symptom**: 404 errors for `/screenshots/*.webp`

**Causes & Solutions**:

1. **Volume not mounted**
   ```bash
   # SSH into VPS and check
   docker exec <container_id> ls -la /app/public/screenshots/
   # If empty, volume mount failed
   ```

2. **Wrong volume path**
   - Verify Coolify settings match exactly:
   - Source: `/data/webflow-gallery/screenshots`
   - Destination: `/app/public/screenshots`

3. **Images not synced**
   ```bash
   # Check VPS has images
   ls -la /data/webflow-gallery/screenshots/ | head
   du -sh /data/webflow-gallery/screenshots/
   ```

### rsync Connection Refused

**Symptom**: `ssh: connect to host 178.156.177.252 port 22: Connection refused`

**Solutions**:
1. Check VPS is running
2. Verify SSH service: `systemctl status sshd`
3. Check firewall: `ufw status`

### rsync Permission Denied

**Symptom**: `Permission denied (publickey,password)`

**Solutions**:
1. Verify password is correct
2. Check SSH config allows password auth:
   ```bash
   # On VPS: /etc/ssh/sshd_config
   PasswordAuthentication yes
   ```

### Container Keeps Restarting

**Symptom**: Application deploys but immediately crashes

**Check**:
```bash
# View container logs
docker logs eokg8cccosgosgwss4wg40o8-161516463639 --tail 100

# Check Coolify logs
docker logs coolify --tail 100
```

### Database Sync Issues

**Symptom**: Local and production databases have different data

**This is expected behavior.** The current architecture has a known limitation:
- Static template data syncs via git (local → production)
- Dynamic user data only exists on production

**Workaround**: Don't modify template data on production; always scrape locally and push.

---

## Future Considerations

### Database Separation (Recommended)

Split SQLite into two databases or migrate dynamic data to Supabase:

```
Option A: Two SQLite files
- templates.db (synced via git)
- runtime.db (production only)

Option B: Hybrid approach
- SQLite for template data (static)
- Supabase/PostgreSQL for user data (dynamic)
```

### SSH Key Authentication

Replace password auth with SSH keys for automated deployments:

```bash
# Generate key locally
ssh-keygen -t ed25519 -C "deploy@webflow-gallery"

# Copy to VPS
ssh-copy-id root@178.156.177.252

# Update deploy.sh to use key
rsync -avz -e "ssh -i ~/.ssh/deploy_key" ...
```

### CI/CD Integration

Automate rsync in GitHub Actions:

```yaml
# .github/workflows/deploy.yml
name: Deploy
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Sync images
        run: |
          rsync -avz public/screenshots/ ${{ secrets.VPS_USER }}@${{ secrets.VPS_HOST }}:/data/webflow-gallery/screenshots/
```

---

## Quick Reference

### Essential Commands

```bash
# SSH into VPS
ssh root@178.156.177.252

# Check container status
docker ps | grep eokg8cccosgosgwss4wg40o8

# View container logs
docker logs eokg8cccosgosgwss4wg40o8-161516463639 --tail 50

# Check image storage
du -sh /data/webflow-gallery/*

# Restart container (via Coolify or Docker)
docker restart eokg8cccosgosgwss4wg40o8-161516463639

# Sync images manually
rsync -avz public/screenshots/ root@178.156.177.252:/data/webflow-gallery/screenshots/
rsync -avz public/thumbnails/ root@178.156.177.252:/data/webflow-gallery/thumbnails/
```

### Key Paths

| Description | Local Path | VPS Path |
|-------------|------------|----------|
| Screenshots | `./public/screenshots/` | `/data/webflow-gallery/screenshots/` |
| Thumbnails | `./public/thumbnails/` | `/data/webflow-gallery/thumbnails/` |
| Database | `./data/webflow.db` | `/app/data/webflow.db` (in container) |
| Deploy script | `./deploy.sh` | N/A |
| Coolify config | N/A | `/data/coolify/applications/eokg8cccosgosgwss4wg40o8/` |

### Credentials (Store Securely!)

```
VPS SSH: root@178.156.177.252 (password: Poicxz12!!)
Admin Dashboard: /admin (password in ADMIN_PASSWORD env var)
```

---

*Document maintained by the development team. For questions, refer to the Simple Knowledge Base for non-technical explanations.*
