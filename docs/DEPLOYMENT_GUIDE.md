# 🚀 Deployment Guide for Modern Webflow Gallery

This guide will help you deploy the Modern Webflow Gallery app on your VPS using Coolify or any similar hosting platform. Written in simple terms - no tech degree required!

## 📋 What You'll Need Before Starting

1. **A VPS (Virtual Private Server)** with at least:
   - 2GB RAM (4GB recommended for better performance)
   - 20GB storage space
   - Ubuntu 20.04 or newer (or similar Linux)

2. **Coolify** installed on your VPS (or another deployment platform)

3. **Domain name** (optional but recommended)

4. **API Keys** from:
   - Resend (for sending emails) - Get it at [resend.com](https://resend.com)
   - Stripe (for payments, optional) - Get it at [stripe.com](https://stripe.com)

## 🎯 Quick Overview

Your app needs these things to run:
- Node.js 18 or newer (to run the JavaScript code)
- SQLite (database - comes built-in)
- Playwright (for taking screenshots of templates)
- Storage space for screenshots

## 📦 Step 1: Installation Commands

When Coolify asks for installation/build commands, use these:

### Install Command
```bash
# This installs everything your app needs
npm ci --production=false

# Install Playwright for taking screenshots
npx playwright install chromium
npx playwright install-deps chromium

# Create necessary folders for data storage
mkdir -p data
mkdir -p public/screenshots
mkdir -p public/thumbnails

# Give proper permissions
chmod 755 data
chmod 755 public/screenshots
chmod 755 public/thumbnails
```

### Build Command
```bash
# This prepares your app for production
npm run build
```

### Start Command
```bash
# This starts your app
npm run start
```

## 🔧 Step 2: Environment Variables

In Coolify, you'll need to add these environment variables. Here's what each one does:

```bash
# Database location (keep this as-is)
DATABASE_PATH=./data/webflow.db

# Your website URL (change this to your actual domain)
NEXT_PUBLIC_APP_URL=https://yourdomain.com

# Admin password to access the admin panel (CHANGE THIS!)
ADMIN_PASSWORD=choose-a-very-secure-password-here

# Email service key (get from resend.com)
RESEND_API_KEY=re_actualKeyFromResend

# Admin email (where you'll receive notifications)
ADMIN_EMAIL=your-email@example.com

# Stripe keys (optional - only if you want payments)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_yourkey
STRIPE_SECRET_KEY=sk_live_yourkey

# Scraper settings (these defaults work well)
SCRAPER_CONCURRENCY=5
SCRAPER_TIMEOUT=30000
SCREENSHOT_QUALITY=85
```

### ⚠️ Important Security Notes:
- **NEVER** use "luminous" or any simple password for ADMIN_PASSWORD
- Make it long and complex (example: `MySuper$ecure#Pass2024!`)
- Keep your API keys secret - don't share them

## 🌐 Step 3: Port Configuration

Your app runs on port **3000** by default. In Coolify:
- Set the port to: `3000`
- If you need a different port, add this environment variable:
  ```bash
  PORT=8080  # or whatever port you want
  ```

## 📝 Step 4: Coolify-Specific Settings

In your Coolify application settings:

1. **Application Type**: Select "Node.js"
2. **Node Version**: Choose 18 or higher (20 recommended)
3. **Package Manager**: npm
4. **Port**: 3000
5. **Health Check Path**: `/api/health` (optional)

### Build Pack Settings (if asked):
```yaml
build:
  type: nixpacks  # or dockerfile
  node_version: 20
  install_command: npm ci --production=false && npx playwright install chromium && npx playwright install-deps chromium
  build_command: npm run build
  start_command: npm run start
```

## 🐳 Step 5: If Using Docker (Alternative)

If Coolify asks for a Dockerfile, create one with this content:

```dockerfile
FROM node:20-slim

# Install dependencies for Playwright
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-6 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy and install dependencies
COPY package*.json ./
RUN npm ci --production=false

# Install Playwright
RUN npx playwright install chromium

# Copy app files
COPY . .

# Create necessary directories
RUN mkdir -p data public/screenshots public/thumbnails

# Build the app
RUN npm run build

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
```

## 🏁 Step 6: First-Time Setup (After Deployment)

Once your app is running:

1. **Visit your website**: Go to `https://yourdomain.com`

2. **Access Admin Panel**:
   - Go to `https://yourdomain.com/admin`
   - Enter your admin password

3. **Start Scraping Templates**:
   - In admin panel, click "Scrape" tab
   - Click "Full Scrape" to get all templates
   - This will take 1-2 hours (it's getting thousands of templates!)

4. **Set Featured Authors**:
   - After scraping, go to "Featured Authors" tab
   - Select which template authors to feature

## 🔍 Troubleshooting Common Issues

### "Cannot find module" Error
**Solution**: Run installation command again:
```bash
npm ci --production=false
```

### "Playwright not working" Error
**Solution**: Install browser dependencies:
```bash
npx playwright install-deps chromium
```

### "Database error" or "SQLITE_CANTOPEN"
**Solution**: Create data directory and fix permissions:
```bash
mkdir -p data
chmod 755 data
```

### "Cannot save screenshots"
**Solution**: Create directories and fix permissions:
```bash
mkdir -p public/screenshots public/thumbnails
chmod 755 public/screenshots public/thumbnails
```

### App crashes with "out of memory"
**Solution**: Your VPS needs more RAM. Upgrade to at least 4GB.

## 📊 Resource Requirements

### Minimum (for testing):
- 2GB RAM
- 2 CPU cores
- 20GB storage

### Recommended (for production):
- 4GB RAM
- 4 CPU cores
- 50GB storage (for storing screenshots)

### For High Traffic (100+ concurrent users):
- 8GB RAM
- 8 CPU cores
- 100GB storage
- CDN service (like Cloudflare)

## 🔐 Security Checklist

Before going live:
- [ ] Changed ADMIN_PASSWORD from default
- [ ] Set up HTTPS (SSL certificate)
- [ ] Configured firewall (only allow ports 80, 443, and SSH)
- [ ] Set up regular backups
- [ ] Enabled rate limiting (optional but recommended)

## 🔄 Updating Your App

To update to a new version:

1. **Backup your database**:
   ```bash
   cp data/webflow.db data/webflow.db.backup
   ```

2. **Pull new code** (if using git):
   ```bash
   git pull origin main
   ```

3. **Install new dependencies**:
   ```bash
   npm ci --production=false
   ```

4. **Build the app**:
   ```bash
   npm run build
   ```

5. **Restart the app**:
   ```bash
   npm run start
   ```

## 📂 Important Directories

These folders are created and used by your app:

- `/data` - Stores your SQLite database
- `/public/screenshots` - Stores full template screenshots
- `/public/thumbnails` - Stores smaller preview images
- `/.next` - Built application files (created automatically)

## 🌟 Performance Tips

1. **Use a CDN**: Services like Cloudflare can cache and serve images faster

2. **Regular Cleanup**: Delete old screenshots periodically:
   ```bash
   # Remove screenshots older than 30 days
   find public/screenshots -type f -mtime +30 -delete
   ```

3. **Database Optimization**: Run occasionally:
   ```bash
   sqlite3 data/webflow.db "VACUUM;"
   ```

4. **Monitor Disk Space**: Check regularly:
   ```bash
   df -h
   ```

## 🆘 Getting Help

If something isn't working:

1. **Check the logs** in Coolify dashboard
2. **Look for error messages** in the browser console (F12)
3. **Check disk space**: `df -h`
4. **Check memory usage**: `free -m`
5. **Restart the app** from Coolify dashboard

## ✅ Post-Deployment Checklist

After your app is running:

- [ ] Can access the homepage
- [ ] Can access `/admin` with password
- [ ] Can start a template scrape
- [ ] Can preview templates
- [ ] Images load correctly
- [ ] Search works
- [ ] Lazy loading works when scrolling

## 📝 Notes for Coolify Users

Coolify handles many things automatically:
- SSL certificates (HTTPS)
- Automatic restarts if app crashes
- Log collection
- Resource monitoring

Just make sure to:
1. Set all environment variables
2. Use the correct build/start commands
3. Allocate enough resources
4. Set up backups

## 🎉 Success!

Once everything is set up, your Modern Webflow Gallery will be live and ready to showcase beautiful templates to your visitors!

Remember: The first scrape takes time (1-2 hours), so be patient. After that, updates are much faster.

---

**Need more help?** Check the logs in Coolify or contact support with specific error messages.