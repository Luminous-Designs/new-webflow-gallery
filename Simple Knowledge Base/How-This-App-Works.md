# How This App Works - Simple Guide

## For Non-Technical Users

**What is this?** A simple guide explaining how the Webflow Gallery app is set up, how to deploy updates, and what to do when things go wrong.

---

## Table of Contents

1. [The Big Picture](#the-big-picture)
2. [Where Things Live](#where-things-live)
3. [How to Deploy Changes](#how-to-deploy-changes)
4. [After Scraping New Templates](#after-scraping-new-templates)
5. [Common Questions](#common-questions)
6. [What To Do If Something Breaks](#what-to-do-if-something-breaks)

---

## The Big Picture

Think of this app as having **three parts**:

### 1. The Code (The Recipe)
This is the actual software - the buttons, pages, and logic that makes everything work. It lives on GitHub and gets automatically sent to your server when you push changes.

### 2. The Images (The Photos)
These are the 7,000+ template screenshots. They're BIG (1.6 GB total), so we store them separately and sync them manually using a special tool.

### 3. The Database (The Spreadsheet)
This is a file that stores all the template information - names, prices, categories, etc. It travels with the code.

---

## Where Things Live

```
YOUR COMPUTER                          YOUR SERVER (VPS)
─────────────                          ─────────────────

Code & Database  ──── GitHub ────────▶  Code & Database
(small, ~40MB)                          (runs the website)

     +                                        +

Template Images  ──── rsync ─────────▶  Template Images
(big, 1.6GB)         (direct copy)      (stored permanently)
```

**In plain English:**
- Code goes through GitHub (like Dropbox for code)
- Images go directly to the server (like copying files to a USB drive)

---

## How to Deploy Changes

### When You've Only Changed Code (No New Templates)

Just push to GitHub like normal:

```
git add -A
git commit -m "Your message here"
git push
```

Coolify (the hosting software) will automatically see your changes and update the live website within a few minutes.

### When You've Scraped New Templates

Use the deploy script we created:

```
./deploy.sh
```

**What this does:**
1. Copies new screenshot images to the server
2. Copies new thumbnail images to the server
3. Asks if you want to push code changes to GitHub

**You'll need to enter your server password** when it asks (the password is: `Poicxz12!!`)

---

## After Scraping New Templates

Here's your step-by-step process:

### Step 1: Run the Scraper
1. Start the app locally: `npm run dev`
2. Go to `http://localhost:3000/admin`
3. Click the scrape button (either "Scrape New" for just new templates, or "Full Scrape" for everything)
4. Wait for it to finish (can take a while!)

### Step 2: Deploy to Production
Open your terminal in the project folder and run:

```
./deploy.sh
```

It will show you progress as it copies files. When it asks for a password, type: `Poicxz12!!`

### Step 3: Verify It Worked
Visit your live website and check that new templates appear with their images.

---

## Common Questions

### Q: Why don't we just put images in GitHub like everything else?

**Simple answer:** They're too big.

GitHub has a ~5GB limit, and we have 1.6GB of images. If we kept them in GitHub:
- The repository would be huge and slow
- Every time someone downloads the code, they'd download ALL images
- Deployments would take forever

### Q: What is rsync?

**Simple answer:** It's a copy tool that's smart about what it copies.

Imagine copying 7,000 photos to a USB drive. If you added 10 new photos and tried to copy again, your computer would want to copy all 7,000 again. rsync is smart - it only copies the 10 new ones.

### Q: What happens if I forget to run deploy.sh?

Your code will update on the live site, but new images won't appear. Users might see broken image icons for new templates.

**Fix:** Just run `./deploy.sh` whenever you remember.

### Q: Can I run the scraper on the server instead of locally?

Technically yes, but we don't recommend it. Scraping uses a lot of computer power (it opens thousands of web pages and takes screenshots). Your local computer is better suited for this than the server.

### Q: What's Coolify?

It's the software that runs on your server and manages your website. Think of it like a control panel. When you push code to GitHub, Coolify sees it and automatically updates your website.

### Q: What's a VPS?

VPS stands for "Virtual Private Server." It's basically a computer that lives in a data center somewhere, running 24/7, serving your website to visitors. Your VPS is provided by a company called Hetzner.

---

## What To Do If Something Breaks

### Images Not Showing Up

**What you see:** Template cards show broken image icons or gray boxes

**What to do:**
1. Run `./deploy.sh` to make sure images are synced
2. Wait a few minutes for the sync to complete
3. Hard refresh your browser (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

### Website Not Loading At All

**What you see:** Error page or "cannot connect" message

**What to do:**
1. Wait 5 minutes (might just be redeploying)
2. Check if the server is running by going to your Coolify dashboard
3. If still broken, the server might need to be restarted (contact your developer)

### Changes Not Appearing After Push

**What you see:** You pushed code but the website looks the same

**What to do:**
1. Wait 3-5 minutes for deployment to complete
2. Hard refresh your browser
3. Check the Coolify dashboard to see if deployment is in progress or failed

### Deploy Script Asks for Password Multiple Times

**This is normal!** The script copies two folders (screenshots and thumbnails), and each one asks for the password separately.

The password is: `Poicxz12!!`

---

## Quick Reference Card

### Daily Commands

| What you want to do | Command to run |
|---------------------|----------------|
| Start app locally | `npm run dev` |
| Deploy after scraping | `./deploy.sh` |
| Push code only | `git push` |
| View local site | Open `http://localhost:3000` |
| View admin panel | Open `http://localhost:3000/admin` |

### Important Information

| Thing | Value |
|-------|-------|
| Server IP | 178.156.177.252 |
| Server password | Poicxz12!! |
| GitHub repo | Luminous-Designs/modern-webflow-gallery |
| Local screenshots | `public/screenshots/` folder |
| Local database | `data/webflow.db` file |

### The Deploy Checklist

After scraping new templates:

- [ ] Scraping completed successfully (check admin dashboard)
- [ ] Run `./deploy.sh`
- [ ] Enter password when asked (twice)
- [ ] Wait for "Deployment complete!" message
- [ ] Check live site to verify images appear

---

## Need More Help?

- **Technical details:** See the "Technical Knowledge Base" folder
- **Coolify dashboard:** Access through your server's IP
- **GitHub repository:** Check the README.md file

---

*This guide was created to help non-technical team members understand and work with the Webflow Gallery deployment system. If something isn't clear, ask your developer to update this document!*
