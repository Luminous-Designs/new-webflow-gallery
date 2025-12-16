import type { Page } from 'playwright';

export interface ScreenshotPreparationOptions {
  /** Maximum time to wait for page load (default: 30s) */
  loadTimeoutMs?: number;
  /** Time to wait for animations after load (default: 3s) */
  animationWaitMs?: number;
  /** Time to wait at each scroll position (default: 150ms) */
  scrollDelayMs?: number;
  /** CSS selectors of elements to remove before screenshot */
  elementsToRemove?: string[];
  /** Whether to scroll the page to trigger lazy content (default: true) */
  enableScroll?: boolean;
  /** Wait for finite animations to settle before screenshot (default: false) */
  ensureAnimationsSettled?: boolean;
  /** Nudge-scroll down/up to trigger on-scroll animations (default: 0 = off) */
  nudgeScrollRatio?: number;
  /** How long to wait after nudging down (default: 300ms) */
  nudgeWaitMs?: number;
  /** How long to wait after nudging back to top (default: 300ms) */
  nudgeAfterMs?: number;
  /** How long animations/layout must stay stable (default: 700ms) */
  stabilityStableMs?: number;
  /** Max time to wait for stability (default: 4500ms) */
  stabilityMaxWaitMs?: number;
  /** Interval between stability checks (default: 250ms) */
  stabilityCheckIntervalMs?: number;
}

const DEFAULT_LOAD_TIMEOUT = 30000;
const DEFAULT_ANIMATION_WAIT = 3000;
const DEFAULT_SCROLL_DELAY = 150;
const DEFAULT_STABILITY_STABLE_MS = 700;
const DEFAULT_STABILITY_MAX_WAIT_MS = 4500;
const DEFAULT_STABILITY_INTERVAL_MS = 250;
const DEFAULT_NUDGE_WAIT_MS = 300;
const DEFAULT_NUDGE_AFTER_MS = 300;

/**
 * Prepares a page for screenshot capture.
 * Simplified approach: load, wait, scroll, wait, screenshot.
 */
export async function preparePageForScreenshot(
  page: Page,
  options: ScreenshotPreparationOptions = {}
): Promise<void> {
  const loadTimeout = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT;
  const animationWait = options.animationWaitMs ?? DEFAULT_ANIMATION_WAIT;
  const scrollDelay = options.scrollDelayMs ?? DEFAULT_SCROLL_DELAY;
  const elementsToRemove = options.elementsToRemove ?? [];
  const enableScroll = options.enableScroll !== false;
  const ensureAnimationsSettled = options.ensureAnimationsSettled === true;
  const nudgeScrollRatio = options.nudgeScrollRatio ?? 0;
  const nudgeWaitMs = options.nudgeWaitMs ?? DEFAULT_NUDGE_WAIT_MS;
  const nudgeAfterMs = options.nudgeAfterMs ?? DEFAULT_NUDGE_AFTER_MS;
  const stabilityStableMs = options.stabilityStableMs ?? DEFAULT_STABILITY_STABLE_MS;
  const stabilityMaxWaitMs = options.stabilityMaxWaitMs ?? DEFAULT_STABILITY_MAX_WAIT_MS;
  const stabilityCheckIntervalMs = options.stabilityCheckIntervalMs ?? DEFAULT_STABILITY_INTERVAL_MS;

  // Step 1: Wait for page to be fully loaded
  try {
    await page.waitForLoadState('load', { timeout: loadTimeout });
  } catch {
    // Continue even if timeout
  }

  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch {
    // Network idle is optional
  }

  // Step 2: Wait for initial animations and content to appear
  await page.waitForTimeout(animationWait);

  // Step 3: Optional scroll through page to trigger lazy content
  if (enableScroll) {
    await scrollPage(page, scrollDelay);

    // Return to top and trigger header visibility
    await page.evaluate(() => {
      window.scrollTo(0, 100);
    });
    await page.waitForTimeout(100);

    await page.evaluate(() => {
      window.scrollTo(0, 0);
    });

    // Wait for header/nav animations to complete
    await page.waitForTimeout(800);
  } else {
    // Ensure we are at the top for viewport screenshots
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
  }

  // Step 4: Optional small nudge scroll to trigger on-scroll animations
  if (!enableScroll && nudgeScrollRatio > 0) {
    await page.evaluate((ratio) => {
      const y = Math.floor(window.innerHeight * ratio);
      window.scrollTo(0, y);
    }, nudgeScrollRatio);
    await page.waitForTimeout(nudgeWaitMs);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(nudgeAfterMs);
  }

  // Step 5: Remove specified elements (user-configured exclusions only)
  if (elementsToRemove.length > 0) {
    await removeElements(page, elementsToRemove);
  }

  // Step 6: Wait for finite animations/layout to settle if requested
  if (ensureAnimationsSettled) {
    await waitForAnimationsToSettle(page, {
      stableForMs: stabilityStableMs,
      maxWaitMs: stabilityMaxWaitMs,
      checkIntervalMs: stabilityCheckIntervalMs
    });
  }
}

async function scrollPage(page: Page, delayMs: number): Promise<void> {
  await page.evaluate(async (delay) => {
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

    const maxScroll = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight
    ) - window.innerHeight;

    const step = Math.floor(window.innerHeight * 0.7);

    // Scroll down
    for (let pos = 0; pos <= maxScroll; pos += step) {
      window.scrollTo(0, pos);
      await wait(delay);
    }

    // Hit bottom
    window.scrollTo(0, maxScroll);
    await wait(delay);

  }, delayMs);
}

async function removeElements(page: Page, selectors: string[]): Promise<void> {
  await page.evaluate((sels) => {
    for (const sel of sels) {
      try {
        let s = sel.trim();
        if (s && !s.startsWith('.') && !s.startsWith('#') && !s.startsWith('[')) {
          s = `.${s}, #${s}`;
        }
        document.querySelectorAll(s).forEach(el => el.remove());
      } catch { /* ignore */ }
    }
  }, selectors);
}

async function waitForAnimationsToSettle(
  page: Page,
  opts: { stableForMs: number; maxWaitMs: number; checkIntervalMs: number }
): Promise<void> {
  const start = Date.now();
  let stableSince: number | null = null;
  let lastScrollHeight: number | null = null;
  let lastBodyHeight: number | null = null;

  while (Date.now() - start < opts.maxWaitMs) {
	    const state = await page.evaluate(() => {
	      const anims = typeof document.getAnimations === 'function'
	        ? (document.getAnimations as unknown as (options?: { subtree?: boolean }) => Animation[])({ subtree: true })
	        : [];

      let runningFinite = 0;
      for (const a of anims) {
        if (a.playState !== 'running') continue;
        try {
          const timing = a.effect?.getComputedTiming?.();
          if (timing?.iterations === Infinity) continue;
        } catch {
          // ignore timing errors
        }
        runningFinite++;
      }

      const scrollHeight = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
      const bodyHeight = document.body.getBoundingClientRect().height;
      return { runningFinite, scrollHeight, bodyHeight };
    });

    const layoutStable =
      lastScrollHeight === null ||
      (state.scrollHeight === lastScrollHeight &&
        Math.round(state.bodyHeight) === Math.round(lastBodyHeight ?? state.bodyHeight));

    const settledNow = state.runningFinite === 0 && layoutStable;

    if (settledNow) {
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= opts.stableForMs) return;
    } else {
      stableSince = null;
    }

    lastScrollHeight = state.scrollHeight;
    lastBodyHeight = state.bodyHeight;
    await page.waitForTimeout(opts.checkIntervalMs);
  }
}
