# Screenshot Mechanism Technical Documentation

This document describes the screenshot capture system used for capturing full-page screenshots of Webflow templates.

## Overview

The screenshot mechanism uses a simple, fast approach: load the page, wait for animations, scroll to trigger lazy content, and capture.

## Core Components

- **`lib/screenshot/prepare.ts`** - Main preparation function
- **`lib/scraper/fresh-scraper.ts`** - The supported scraper pipeline
- **`app/api/admin/screenshot-test/route.ts`** - Admin testing endpoint

## Process Flow

```
1. Wait for page load (load + networkidle)
2. Wait 3 seconds for animations
3. Scroll through page (triggers lazy content)
4. Return to top
5. Wait 500ms
6. Remove user-specified elements (if any)
7. Capture screenshot
```

## Configuration

```typescript
interface ScreenshotPreparationOptions {
  loadTimeoutMs?: number;      // Default: 30000 (30s)
  animationWaitMs?: number;    // Default: 3000 (3s)
  scrollDelayMs?: number;      // Default: 150ms
  elementsToRemove?: string[]; // CSS selectors
}
```

## Usage

```typescript
import { preparePageForScreenshot } from '@/lib/screenshot/prepare';

await page.goto(url, { waitUntil: 'domcontentloaded' });

await preparePageForScreenshot(page, {
  loadTimeoutMs: 30000,
  animationWaitMs: 3000,
  scrollDelayMs: 150,
  elementsToRemove: ['.cookie-banner']
});

const buffer = await page.screenshot({ fullPage: true });
```

## Element Exclusions

### Admin Dashboard
Navigate to Admin → Screenshot Tools to:
- Add class names, IDs, or CSS selectors to exclude
- Toggle exclusions on/off
- Test screenshots with any URL

### Storage
Exclusions are stored in Supabase in the `screenshot_exclusions` table.

## Timing

Typical screenshot time: **5-10 seconds** per template
- Navigation: 1-3s
- Animation wait: 3s
- Scroll: 1-3s
- Capture: <1s
